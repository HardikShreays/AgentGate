from datetime import datetime
from decimal import Decimal
from typing import Optional, Any

from pydantic import BaseModel, ConfigDict

from app.models import ActionType, ConsentStatus


# ---- Consent (A.2) ----

class ConsentCreateRequest(BaseModel):
    user_id: str
    merchant_id: str
    spend_limit: Decimal
    per_txn_max: Decimal
    scope: list[str]
    expiry_days: int = 7


class ConsentResponse(BaseModel):
    consent_id: str
    user_id: str
    merchant_id: str
    spend_limit: Decimal
    spend_used: Decimal
    per_txn_max: Decimal
    scope: list[str]
    expiry: datetime
    status: ConsentStatus
    integrity_hash: str
    integrity_valid: bool = True
    created_at: datetime
    revoked_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ConsentRevokeResponse(BaseModel):
    consent_id: str
    status: ConsentStatus
    revoked_at: Optional[datetime]


# ---- check_consent result ----

class ConsentCheckResult(BaseModel):
    allowed: bool
    reason: Optional[str] = None
    remaining: Optional[Decimal] = None


# ---- Transaction (A.4) ----

class ExecuteTransactionRequest(BaseModel):
    consent_id: str
    amount: Decimal
    sku_category: str
    idempotency_key: str
    simulate_delay_ms: int = 0


class ExecuteTransactionResponse(BaseModel):
    transaction_id: Optional[str]
    status: str
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    amount: Optional[Decimal] = None
    reason: Optional[str] = None
    reasoning: str
    consent_remaining: Optional[Decimal] = None


class ConfirmPaymentRequest(BaseModel):
    transaction_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class DemoModeRequest(BaseModel):
    enabled: bool


class DemoModeResponse(BaseModel):
    enabled: bool


# ---- Transaction status / attempt timeline (Phase 4) ----

class TransactionAttempt(BaseModel):
    attempt: int
    razorpay_order_id: Optional[str] = None
    status: str
    error_reason: Optional[str] = None
    created_at: Optional[str] = None
    resolved_at: Optional[str] = None
    razorpay_payment_id: Optional[str] = None


class TransactionStatusResponse(BaseModel):
    transaction_id: str
    consent_id: str
    status: str
    amount: Decimal
    sku_category: str
    attempt_count: int
    max_attempts: int
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    attempts: list[TransactionAttempt]


# ---- Audit (A.5, Phase 3) ----

class AuditLogEntry(BaseModel):
    log_id: str
    consent_id: str
    action_type: ActionType
    reasoning: str
    structured_payload: dict[str, Any]
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditTrailResponse(BaseModel):
    consent_id: str
    entry_count: int
    entries: list[AuditLogEntry]


# ---- Buyer agent (Phase 5) ----

class AgentMessageRequest(BaseModel):
    message: str
