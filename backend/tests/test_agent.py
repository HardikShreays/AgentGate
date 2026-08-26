"""
Phase 5 — Buyer Agent tests.

These deliberately split into two kinds:

1. Tool-level tests that call check_consent_tool / execute_transaction_tool
   / get_status_tool directly, with NO model involved at all. This is
   what proves the plan's acceptance criterion literally: "Agent refuses
   an over-limit request with the structured reason, with zero
   prompt-engineering to make this happen — the tool call itself returns
   Deny." A real Anthropic model call is not required to prove the
   enforcement lives in the tool, not the prompt.

2. Graph-level tests using a canned fake chat model
   (FakeMessagesListChatModel) instead of a real ChatAnthropic, since
   this sandbox has no ANTHROPIC_API_KEY (see README). These prove the
   LangGraph wiring itself: the tool node executes real tool calls, the
   loop terminates normally when the model stops calling tools, and the
   3-iteration cap forces a final response instead of looping forever
   when the model keeps trying to call tools.
"""
from decimal import Decimal

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel

from app import audit as audit_svc
from app.agent import MAX_ITERATIONS, build_agent, build_tools, run_agent
from app.models import ActionType


class _FakeToolCallingModel(FakeMessagesListChatModel):
    """FakeMessagesListChatModel (langchain-core) raises NotImplementedError
    on bind_tools — it's built for plain canned text responses, not for
    standing in as a tool-calling model. Since this fake already ignores
    its input and returns the next canned message regardless, binding
    tools can safely be a no-op: it doesn't need the tool schema to
    decide what to say next, we've already decided for it."""

    def bind_tools(self, tools, **kwargs):
        return self


# --- 1. Tool-level: enforcement lives in the tool, not the prompt ----------

def test_check_consent_tool_denies_over_per_txn_cap_with_structured_reason(db, consent_contract):
    check_consent_tool, _execute, _status = build_tools(db)

    result = check_consent_tool.invoke(
        {"consent_id": consent_contract.consent_id, "amount": 600.0, "sku_category": "groceries"}
    )

    assert result["allowed"] is False
    assert result["reason"] == "per_txn_max_exceeded"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(
        e.action_type == ActionType.consent_check and e.structured_payload.get("source") == "buyer_agent"
        for e in trail.entries
    )


def test_check_consent_tool_allows_within_limit(db, consent_contract):
    check_consent_tool, _execute, _status = build_tools(db)

    result = check_consent_tool.invoke(
        {"consent_id": consent_contract.consent_id, "amount": 450.0, "sku_category": "groceries"}
    )

    assert result["allowed"] is True
    assert result["reason"] is None
    assert result["remaining"] == 1550.0


def test_execute_transaction_tool_denies_out_of_scope_without_touching_razorpay(db, consent_contract, mock_razorpay):
    _check, execute_transaction_tool, _status = build_tools(db)

    result = execute_transaction_tool.invoke(
        {
            "consent_id": consent_contract.consent_id,
            "amount": 100.0,
            "sku_category": "electronics",  # contract scope is ["groceries"]
            "idempotency_key": "agent-key-1",
        }
    )

    assert result["status"] == "denied"
    assert result["reason"] == "out_of_scope"
    assert result["transaction_id"] is None

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert all(e.action_type != ActionType.order_created for e in trail.entries)


def test_execute_transaction_tool_creates_real_order_when_allowed(db, consent_contract, mock_razorpay):
    _check, execute_transaction_tool, _status = build_tools(db)

    result = execute_transaction_tool.invoke(
        {
            "consent_id": consent_contract.consent_id,
            "amount": 450.0,
            "sku_category": "groceries",
            "idempotency_key": "agent-key-2",
        }
    )

    assert result["status"] == "pending"
    assert result["razorpay_order_id"] is not None
    assert result["transaction_id"] is not None


def test_get_status_tool_returns_error_dict_for_unknown_transaction(db):
    _check, _execute, get_status_tool = build_tools(db)

    result = get_status_tool.invoke({"transaction_id": "does-not-exist"})

    assert result == {"error": "transaction_not_found", "transaction_id": "does-not-exist"}


def test_get_status_tool_returns_attempt_timeline(db, consent_contract, mock_razorpay):
    _check, execute_transaction_tool, get_status_tool = build_tools(db)

    exec_result = execute_transaction_tool.invoke(
        {
            "consent_id": consent_contract.consent_id,
            "amount": 200.0,
            "sku_category": "groceries",
            "idempotency_key": "agent-key-3",
        }
    )
    status = get_status_tool.invoke({"transaction_id": exec_result["transaction_id"]})

    assert status["transaction_id"] == exec_result["transaction_id"]
    assert status["attempt_count"] == 1
    assert len(status["attempts"]) == 1


# --- 2. Graph-level: LangGraph wiring, using a canned fake model ----------

def _tool_call_message(name: str, args: dict, call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def test_agent_graph_runs_check_then_execute_then_summarizes(db, consent_contract, mock_razorpay):
    """Baseline demo per Phase 5 task 3: canned model decides to check
    consent, then execute, then produce a final text summary — proves the
    ToolNode really invokes our real tools (not a mock of the graph
    itself) and that the loop ends normally once the model stops calling
    tools."""
    fake_model = _FakeToolCallingModel(
        responses=[
            _tool_call_message(
                "check_consent_tool",
                {"consent_id": consent_contract.consent_id, "amount": 450.0, "sku_category": "groceries"},
                "call_1",
            ),
            _tool_call_message(
                "execute_transaction_tool",
                {
                    "consent_id": consent_contract.consent_id,
                    "amount": 450.0,
                    "sku_category": "groceries",
                    "idempotency_key": "agent-graph-key-1",
                },
                "call_2",
            ),
            AIMessage(content="Order placed: ₹450 groceries purchase is pending Razorpay confirmation."),
        ]
    )

    result = run_agent(db, "Order ₹450 of groceries from m_groceries_01", model=fake_model)

    assert "pending" in result["final_response"].lower() or "placed" in result["final_response"].lower()
    assert result["iterations"] == 3  # two tool-calling turns + the final text turn

    tool_messages = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 2

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(e.action_type == ActionType.order_created for e in trail.entries)


def test_agent_graph_hard_stops_at_3_iterations_and_forces_final_response(db, consent_contract):
    """A.7: 'On the 3rd iteration without a final answer, force a
    response summarizing what was attempted — never silently loop.' The
    canned model here NEVER stops calling tools on its own; only the
    graph's forced-final step (past MAX_ITERATIONS) should end the run."""
    always_calls_tool = [
        _tool_call_message(
            "check_consent_tool",
            {"consent_id": consent_contract.consent_id, "amount": 1.0, "sku_category": "groceries"},
            f"call_{i}",
        )
        for i in range(1, MAX_ITERATIONS + 1)  # exactly the 3 tool-calling turns the graph allows
    ]
    # After MAX_ITERATIONS is hit, the agent node calls the *unbound*
    # model with FORCE_FINAL_PROMPT for the final turn — same fake model,
    # next response in the list.
    fake_model = _FakeToolCallingModel(
        responses=always_calls_tool + [AIMessage(content="Stopping: used all 3 tool-call turns without a final result.")]
    )

    result = run_agent(db, "Order something", model=fake_model)

    assert result["iterations"] == 3
    final = result["messages"][-1]
    assert not getattr(final, "tool_calls", None)
    assert "stopping" in final.content.lower()

    tool_messages = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 3  # exactly 3 tool-calling rounds, never a 4th
