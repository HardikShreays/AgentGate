from contextlib import asynccontextmanager

import razorpay
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app import catalog as catalog_svc
from app import consent as consent_svc
from app import audit as audit_svc
from app.db import get_db, init_db
from app.config import get_settings
from app.executor import TransactionExecutor
from app.executor import get_transaction_status as get_transaction_status_svc
from app.executor import release_stale_reservations
from app.failure import FailureHandler
from app.models import ActionType
from app.models import Transaction
from app.razorpay_client import get_client, verify_payment_signature
from app.webhooks import router as webhooks_router
from app.webhooks import _handle_captured
from app.schemas import (
    CatalogResponse,
    ConfirmPaymentRequest,
    ConsentCreateRequest,
    ConsentResponse,
    ConsentRevokeResponse,
    DemoModeRequest,
    DemoModeResponse,
    ExecuteTransactionRequest,
    ExecuteTransactionResponse,
    Product,
    SimulateFailureRequest,
    AuditTrailResponse,
    TransactionStatusResponse,
    AgentMessageRequest,
    AgentMessageResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AgentGate API", lifespan=lifespan)

# Phase 6 — the Next.js dashboard calls this API from the browser, so it
# needs CORS. Allowed origins come from the CORS_ORIGINS env var (a
# comma-separated list); this is a demo, not a public API, so origins are
# never "*". Frontend origins are only read once at startup — a server
# restart is required after changing CORS_ORIGINS.
settings = get_settings()
cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhooks_router)


def _to_consent_response(contract) -> ConsentResponse:
    """Shared by create/get: ConsentResponse mirrors the stored row (A.1/A.2)
    plus one derived field, `integrity_valid`, computed fresh via
    consent_svc.verify_integrity() rather than stored — the whole point of
    an HMAC integrity check is that it's recomputed on every read, never
    cached or trusted at rest. This is what backs the Consent Inspector's
    "integrity-hash status (valid/tampered)" requirement (Phase 6)."""
    response = ConsentResponse.model_validate(contract)
    return response.model_copy(
        update={
            "integrity_valid": consent_svc.verify_integrity(contract),
            # Display-only: stored status upgraded to `expired` when the clock
            # says so, so the dashboard badge agrees with what check_consent
            # would decide (Task 5). check_consent stays the enforcement path.
            "status": consent_svc.effective_status(contract),
        }
    )


@app.post("/consent", response_model=ConsentResponse, status_code=201)
def create_consent(req: ConsentCreateRequest, db: Session = Depends(get_db)):
    contract = consent_svc.create_consent(db, req)
    return _to_consent_response(contract)


@app.get("/consent/{consent_id}", response_model=ConsentResponse)
def get_consent(consent_id: str, db: Session = Depends(get_db)):
    from app.models import ConsentContract

    # Return any budget held by abandoned checkouts before rendering, so the
    # dashboard never shows a stale `spend_reserved` (Task 2).
    release_stale_reservations(db, consent_id)

    contract = db.get(ConsentContract, consent_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="consent not found")
    return _to_consent_response(contract)


@app.post("/consent/{consent_id}/revoke", response_model=ConsentRevokeResponse)
def revoke_consent(consent_id: str, db: Session = Depends(get_db)):
    contract = consent_svc.revoke_consent(db, consent_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="consent not found")

    audit_svc.log_action(
        db,
        consent_id,
        ActionType.revocation_processed,
        {"revoked_by": "user", "revoked_at": contract.revoked_at.isoformat()},
    )
    return ConsentRevokeResponse(
        consent_id=str(contract.consent_id), status=contract.status, revoked_at=contract.revoked_at
    )


@app.post("/transaction/execute", response_model=ExecuteTransactionResponse)
def execute_transaction(req: ExecuteTransactionRequest, db: Session = Depends(get_db)):
    executor = TransactionExecutor(db)
    return executor.execute(
        consent_id=req.consent_id,
        amount=req.amount,
        sku_category=req.sku_category,
        sku=req.sku,
        idempotency_key=req.idempotency_key,
        simulate_delay_ms=req.simulate_delay_ms,
    )


@app.post("/transaction/confirm", response_model=TransactionStatusResponse)
def confirm_payment(req: ConfirmPaymentRequest, db: Session = Depends(get_db)):
    """Verified Checkout.js fallback for local/dev runs.

    Razorpay webhooks remain the preferred asynchronous source of truth.
    This endpoint covers environments where Razorpay cannot reach the
    local backend (for example, no ngrok tunnel). It only settles a row
    after verifying Razorpay's checkout signature server-side.
    """
    client = get_client()
    try:
        verify_payment_signature(
            client,
            req.razorpay_order_id,
            req.razorpay_payment_id,
            req.razorpay_signature,
        )
    except razorpay.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="invalid payment signature")

    txn = db.get(Transaction, req.transaction_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    if txn.razorpay_order_id != req.razorpay_order_id:
        raise HTTPException(status_code=409, detail="payment order does not match transaction")

    _handle_captured(db, txn, req.razorpay_payment_id)
    status = get_transaction_status_svc(db, req.transaction_id)
    if status is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return status


@app.get("/demo-mode", response_model=DemoModeResponse)
def get_demo_mode():
    return DemoModeResponse(enabled=settings.DEMO_MODE)


@app.post("/demo-mode", response_model=DemoModeResponse)
def set_demo_mode(req: DemoModeRequest):
    """Runtime DEMO_MODE toggle for the dashboard's demo pages.

    Intentionally unauthenticated: this whole API is a test-mode demo with no
    auth layer (see README §10). The blast radius is bounded regardless —
    `simulate_delay_ms` is capped at 5000ms in the schema, so even with demo
    mode on a caller cannot hold a consent row lock open indefinitely.

    This mutates the process-local `@lru_cache`d Settings singleton, so it only
    affects the worker that handled the request — it will desync under
    multi-worker uvicorn. Fine for the single-process demo; noted so it isn't
    discovered the hard way.
    """
    settings.DEMO_MODE = req.enabled
    return DemoModeResponse(enabled=settings.DEMO_MODE)


@app.get("/catalog", response_model=CatalogResponse)
def get_catalog(category: str | None = None):
    """Agent-readable merchant catalog (Task 1). The buyer agent reads this to
    decide WHAT to buy; the consent engine decides whether it MAY. Prices are
    served from here and re-resolved server-side at execute time — a caller
    cannot name its own price."""
    products = catalog_svc.list_products(category)
    return CatalogResponse(
        merchant_id="m_groceries_01",
        product_count=len(products),
        products=[Product(**p) for p in products],
    )


@app.post("/demo/simulate-failure", response_model=TransactionStatusResponse)
def simulate_failure(req: SimulateFailureRequest, db: Session = Depends(get_db)):
    """Invoke the REAL FailureHandler on an existing pending transaction,
    exactly as app.webhooks does on a verified payment.failed event (Task 6).

    This does not fake a timeline: it is the same handler, the same bounded
    retry, the same hard stop and merchant notification. It only removes the
    need to drive Razorpay's hosted mock-bank UI twice to see it.

    Returns 404 when DEMO_MODE is off so the endpoint doesn't advertise itself
    in a non-demo deployment.
    """
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="not found")

    txn = db.get(Transaction, req.transaction_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="transaction not found")

    FailureHandler(db).handle(req.transaction_id, req.error_reason)
    status = get_transaction_status_svc(db, req.transaction_id)
    if status is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return status


@app.get("/audit/{consent_id}", response_model=AuditTrailResponse)
def get_audit_trail(consent_id: str, db: Session = Depends(get_db)):
    return audit_svc.get_audit_trail(db, consent_id)


@app.get("/transaction/{transaction_id}/status", response_model=TransactionStatusResponse)
def get_transaction_status(transaction_id: str, db: Session = Depends(get_db)):
    """Phase 4 — full attempt timeline for a single transaction: original
    attempt, any bounded retry, and the final outcome. This is what the
    dashboard's Transaction Timeline page (Phase 6) reads; it does not
    need to reverse-engineer a transaction's story out of the
    consent-scoped audit trail at GET /audit/{consent_id}."""
    status = get_transaction_status_svc(db, transaction_id)
    if status is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return status


@app.post("/agent/message", response_model=AgentMessageResponse)
def agent_message(req: AgentMessageRequest, db: Session = Depends(get_db)):
    """Phase 5 — a minimal HTTP entry point for the buyer agent, so the
    dashboard or a demo script can drive it without importing app.agent
    directly. No streaming, no session/thread persistence across calls.

    When the agent's run created a real Razorpay order, the response also
    carries the transaction id / order id so the chat UI can open Checkout
    and complete the purchase — otherwise the agent flow dead-ends at
    `pending` and the reservation sweep expires it 15 minutes later."""
    from app.agent import run_agent

    result = run_agent(db, req.message)
    ex = result.get("execute_result") or {}
    return AgentMessageResponse(
        response=result["final_response"],
        consent_id=ex.get("consent_id"),
        transaction_id=ex.get("transaction_id"),
        razorpay_order_id=ex.get("razorpay_order_id"),
        status=ex.get("status"),
        reason=ex.get("reason"),
    )
