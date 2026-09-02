"""
Phase 5 — Buyer Agent (A.7, A.16).

A single custom-built LangGraph node running a ReAct-style loop, bound to
four tools: browse_catalog_tool, check_consent_tool,
execute_transaction_tool, get_status_tool. This is a hand-built StateGraph
rather than langgraph.prebuilt.create_react_agent, because the plan's
acceptance criteria need something the prebuilt agent doesn't expose out of
the box: a hard, counted stop at MAX_ITERATIONS tool-calling iterations
that forces a summary response on the next turn, rather than an opaque
recursion limit. (MAX_ITERATIONS was raised from 3 to 4 when the catalog
browse step was added — see Task 1.)

The system prompt tells the model it may only act through the three
tools — but that instruction is not the enforcement. The enforcement is
that the tools themselves call straight into app.consent / app.executor,
which do the real Allow/Deny logic. Per A.16: "the tool itself does no
money logic, it only forwards to the already-tested consent.py/
executor.py functions." If the model never calls a tool at all, or
hallucinates a result, there is simply no transaction and no consent
mutation — nothing downstream trusts the model's own words about money.

Tools are built in-process against a single SQLAlchemy Session (per A.16:
"or an in-process function call if agent and API share a runtime" — the
demo's LangGraph process shares app.consent/app.executor's runtime), not
over HTTP, so build_agent(db) takes a Session and closes over it in the
four @tool-decorated functions, along with a per-run idempotency scope and
a result sink (see build_tools).
"""
import uuid
from decimal import Decimal, InvalidOperation
from typing import Annotated, Optional, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, SystemMessage
from langchain_core.tools import tool
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from sqlalchemy.orm import Session

from app import catalog
from app.audit import log_action
from app.config import get_settings, VALID_SKU_CATEGORIES
from app.consent import check_consent
from app.executor import TransactionExecutor, get_transaction_status
from app.models import ActionType

settings = get_settings()

# A.7 — hard, counted stop, then force a final response. Raised from 3 to 4
# (Task 1) because the catalog flow is browse_catalog -> check_consent ->
# execute_transaction, and the model needs a 4th turn to summarize the
# outcome rather than being force-stopped on every successful purchase.
MAX_ITERATIONS = 4

SYSTEM_PROMPT = (
    "You are AgentGate's buyer agent. You act on a human's behalf to make "
    "small, pre-authorized purchases against an existing consent contract.\n\n"
    "You may ONLY act through the four tools available to you: "
    "browse_catalog_tool, check_consent_tool, execute_transaction_tool, "
    "get_status_tool. "
    "You never reason about spend limits, scope, expiry, or revocation "
    "yourself, and you never claim a purchase succeeded or failed unless a "
    "tool told you so — those checks are enforced by the tools, not by "
    "your judgement. If a tool returns denied/allowed=false, report that "
    "denial and its reason plainly; do not retry with a different amount "
    "or category to work around it, and do not argue with the result.\n\n"
    "Typical flow for a purchase request: unless the human gave you an exact "
    "sku string, call browse_catalog_tool FIRST and pick the catalog item "
    "that best matches what they asked for — even if they only named a "
    "category or an amount, choose a concrete product from the list rather "
    "than falling back to a bare amount. Then call check_consent_tool with "
    "that product's price and sku. If it is not allowed, stop and report the "
    "reason. If it is allowed, call execute_transaction_tool with the sku "
    "(omit amount — the server prices it from the catalog). Then summarize "
    "the outcome for the human in one or two sentences, naming the product "
    "you bought, and including the transaction id or denial reason and the "
    "reasoning string the tool returned. Never state a price that did not "
    "come from a tool result. You do not choose or pass an idempotency key — "
    "the system handles that."
)

FORCE_FINAL_PROMPT = (
    "You have used all 4 of your tool-call turns for this request. Do not "
    "call any more tools. Reply now, in plain text, summarizing exactly "
    "what you attempted and what the tools returned so far. If nothing "
    "conclusive happened, say so plainly rather than guessing at an "
    "outcome."
)


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    iterations: int


def _log_agent_consent_check(db: Session, consent_id: str, amount: Decimal, sku_category: str, contract, result, sku: Optional[str] = None) -> None:
    """check_consent_tool performs a real consent check (Phase 3 rule:
    if a consent check happened, there is a log row) independently of
    whatever execute_transaction_tool logs later — an agent asking "is
    this allowed?" and then a separate executor re-verifying it under a
    row lock are two distinct, both-real events worth two audit rows.
    Payload shape matches app.executor._log_check so the same
    audit.render_reasoning template renders it correctly."""
    payload = {
        "decision": "approved" if result.allowed else "denied",
        "amount": float(amount),
        "sku_category": sku_category,
        "limit": float(contract.spend_limit) if contract else None,
        "used": float(contract.spend_used) if contract else None,
        "per_txn_max": float(contract.per_txn_max) if contract else None,
        "remaining": float(result.remaining) if result.remaining is not None else None,
        "reason": result.reason,
        "sku": sku,
        "source": "buyer_agent",
    }
    log_action(db, consent_id, ActionType.consent_check, payload)
    if result.reason == "integrity_violation":
        log_action(db, consent_id, ActionType.integrity_violation, {"consent_id": consent_id})


def build_tools(db: Session, run_id: str, sink: dict) -> list:
    """A.16 — the four tools bound to the agent. Each is a thin wrapper:
    no money logic lives here, only argument parsing and a call straight
    into the already-tested service layer.

    `run_id` scopes the idempotency key: the LLM never sees or chooses it
    (at temperature=0 it invents the same literal every run, which silently
    replays the first transaction forever). The key is
    `{run_id}:{sku or category:amount}`, so a retry *within* one agent run
    dedups correctly while every new run genuinely transacts.

    `sink` is a mutable dict the execute tool writes its last result into,
    so run_agent() can surface the transaction id / Razorpay order id to the
    HTTP caller without re-parsing the message trace."""

    @tool
    def browse_catalog_tool(category: Optional[str] = None) -> dict:
        """List what this merchant sells, optionally filtered to one category
        ("groceries", "food", "electronics", "subscriptions"). Call this FIRST
        when the human names a product in words rather than giving you a sku,
        so you can find the matching sku and its real price. Returns
        {"products": [{"sku", "name", "category", "price"}]}. Never invent a
        sku or a price that did not come from this tool."""
        products = catalog.list_products(category)
        return {"products": [{**p, "price": float(p["price"])} for p in products]}

    @tool
    def check_consent_tool(consent_id: str, amount: float, sku_category: str, sku: Optional[str] = None) -> dict:
        """Check whether a purchase is allowed under a consent contract,
        without spending anything. Always call this before
        execute_transaction_tool. Pass `sku` too when the purchase is a
        catalog item, so the audit trail records which item was checked.
        Returns
        {"allowed": bool, "reason": str | None, "remaining": float | None}.
        `reason` is only present when allowed is false, and is a stable
        machine-readable code such as "per_txn_max_exceeded",
        "insufficient_remaining_balance", "expired", "revoked",
        "out_of_scope", or "invalid_sku_category" — report it verbatim,
        don't paraphrase it into a guess."""
        try:
            decimal_amount = Decimal(str(amount))
        except InvalidOperation:
            return {"allowed": False, "reason": "invalid_amount", "remaining": None}

        result, contract = check_consent(db, consent_id, decimal_amount, sku_category)
        _log_agent_consent_check(db, consent_id, decimal_amount, sku_category, contract, result, sku=sku)
        return {
            "allowed": result.allowed,
            "reason": result.reason,
            "remaining": float(result.remaining) if result.remaining is not None else None,
        }

    @tool
    def execute_transaction_tool(
        consent_id: str,
        sku: Optional[str] = None,
        amount: Optional[float] = None,
        sku_category: Optional[str] = None,
    ) -> dict:
        """Attempt to actually execute a purchase against a consent
        contract. This is the only tool that can move money or create a
        Razorpay order — it re-checks the consent contract itself (under
        a row lock) before doing anything, so calling this without first
        calling check_consent_tool is safe, just less informative if it
        gets denied.

        When buying a catalog item, pass `sku` and omit `amount` — the
        server prices it from the catalog and ignores any amount you send.
        Only pass `amount` + `sku_category` for a non-catalog purchase.

        You do NOT pass an idempotency key — the system scopes one to this
        run automatically. Returns the same shape as POST /transaction/execute:
        transaction_id, status ("pending" — Razorpay confirms capture
        asynchronously via webhook, not synchronously here — "denied", or
        "failed"), reason (only on denial), and a human-readable reasoning
        string."""
        decimal_amount = None
        if amount is not None:
            try:
                decimal_amount = Decimal(str(amount))
            except InvalidOperation:
                return {
                    "transaction_id": None,
                    "status": "denied",
                    "reason": "invalid_amount",
                    "reasoning": f"Denied: '{amount}' is not a valid amount.",
                }

        purchase_id = sku or f"{sku_category}:{decimal_amount}"
        idempotency_key = f"{run_id}:{purchase_id}"

        executor = TransactionExecutor(db)
        response = executor.execute(
            consent_id=consent_id,
            amount=decimal_amount,
            sku_category=sku_category,
            sku=sku,
            idempotency_key=idempotency_key,
        )
        payload = response.model_dump(mode="json")
        sink["execute_result"] = {**payload, "consent_id": consent_id, "sku": sku}
        return payload

    @tool
    def get_status_tool(transaction_id: str) -> dict:
        """Look up the full attempt timeline for a previously created
        transaction — original attempt, any bounded retry, and final
        status. Use this to check on a transaction rather than assuming
        an outcome, e.g. after a failure or when asked "did that go
        through?" later in the conversation."""
        status = get_transaction_status(db, transaction_id)
        if status is None:
            return {"error": "transaction_not_found", "transaction_id": transaction_id}
        return status.model_dump(mode="json")

    return [browse_catalog_tool, check_consent_tool, execute_transaction_tool, get_status_tool]


def build_agent(db: Session, model=None, run_id: Optional[str] = None, sink: Optional[dict] = None):
    """Compile the Phase 5 buyer-agent graph. `model` is injectable so
    tests can swap in a canned/fake chat model instead of making a real
    Groq API call; defaults to ChatGroq using GROQ_API_KEY / GROQ_MODEL.

    `run_id` / `sink` are normally supplied by run_agent(); defaulted here
    so a test that builds the graph directly still gets a usable agent."""
    run_id = run_id or str(uuid.uuid4())
    sink = sink if sink is not None else {}
    tools = build_tools(db, run_id, sink)

    if model is None:
        model = ChatGroq(
            model=settings.GROQ_MODEL,
            temperature=0,
            api_key=settings.GROQ_API_KEY or None,
        )
    model_with_tools = model.bind_tools(tools)

    def agent_node(state: AgentState) -> dict:
        iterations = state.get("iterations", 0)
        messages = state["messages"]

        if iterations >= MAX_ITERATIONS:
            # A.7 — forced final response, never a 4th tool-call round.
            forced = [SystemMessage(content=SYSTEM_PROMPT), SystemMessage(content=FORCE_FINAL_PROMPT)] + list(messages)
            response = model.invoke(forced)
            if not isinstance(response, AIMessage):
                response = AIMessage(content=str(response))
            # Defensively strip any tool_calls the model tried to sneak in
            # despite being asked not to — this node's job is to guarantee
            # a hard stop, not to trust the model's compliance.
            response.tool_calls = []
            return {"messages": [response], "iterations": iterations}

        full_messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)
        response = model_with_tools.invoke(full_messages)
        return {"messages": [response], "iterations": iterations + 1}

    def route_after_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", route_after_agent, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile()


def run_agent(db: Session, user_message: str, model=None) -> dict:
    """Convenience entry point for scripts/API use: run the agent once on
    a single natural-language request and return the final text plus the
    full message trace, so a caller can print/log either.

    `execute_result` is the raw response of the last execute_transaction_tool
    call this run made (or None) — the HTTP layer uses it to hand the
    frontend a transaction id / Razorpay order id so the agent flow can be
    completed through Checkout, exactly like the dashboard's execute panel."""
    from langchain_core.messages import HumanMessage

    run_id = str(uuid.uuid4())
    sink: dict = {}
    agent = build_agent(db, model=model, run_id=run_id, sink=sink)
    result = agent.invoke(
        {"messages": [HumanMessage(content=user_message)], "iterations": 0},
        config={"recursion_limit": 50},
    )
    final_message = result["messages"][-1]
    return {
        "final_response": final_message.content,
        "messages": result["messages"],
        "iterations": result.get("iterations", 0),
        "execute_result": sink.get("execute_result"),
    }
