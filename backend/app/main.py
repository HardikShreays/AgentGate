from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app import consent as consent_svc
from app import audit as audit_svc
from app.db import get_db, init_db
from app.config import get_settings
from app.executor import TransactionExecutor
from app.executor import get_transaction_status as get_transaction_status_svc
from app.models import ActionType
from app.webhooks import router as webhooks_router
from app.schemas import (
    ConsentCreateRequest,
    ConsentResponse,
    ConsentRevokeResponse,
    ExecuteTransactionRequest,
    ExecuteTransactionResponse,
    AuditTrailResponse,
    TransactionStatusResponse,
    AgentMessageRequest,
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
    return response.model_copy(update={"integrity_valid": consent_svc.verify_integrity(contract)})


@app.post("/consent", response_model=ConsentResponse, status_code=201)
def create_consent(req: ConsentCreateRequest, db: Session = Depends(get_db)):
    contract = consent_svc.create_consent(db, req)
    return _to_consent_response(contract)


@app.get("/consent/{consent_id}", response_model=ConsentResponse)
def get_consent(consent_id: str, db: Session = Depends(get_db)):
    from app.models import ConsentContract

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
        idempotency_key=req.idempotency_key,
        simulate_delay_ms=req.simulate_delay_ms,
    )


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


@app.post("/agent/message")
def agent_message(req: AgentMessageRequest, db: Session = Depends(get_db)):
    """Phase 5 — a minimal HTTP entry point for the buyer agent, so the
    dashboard or a demo script can drive it without importing app.agent
    directly. Not part of the non-negotiable scope (Section 0 lists
    exactly 2 dashboard pages and doesn't mention a chat UI), so this is
    intentionally thin: one endpoint, no streaming, no session/thread
    persistence across calls."""
    from app.agent import run_agent

    result = run_agent(db, req.message)
    return {"response": result["final_response"]}
