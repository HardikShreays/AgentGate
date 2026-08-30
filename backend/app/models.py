import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    Numeric,
    DateTime,
    Enum,
    JSON,
    ForeignKey,
    Integer as SAInteger,
)
from sqlalchemy.types import TypeDecorator, CHAR

from app.db import Base


def _now():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class GUID(TypeDecorator):
    """Platform-independent UUID-as-string column (works on sqlite and postgres)."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        return value


class ConsentStatus(str, enum.Enum):
    active = "active"
    expired = "expired"
    revoked = "revoked"
    exhausted = "exhausted"


class TransactionStatus(str, enum.Enum):
    pending = "pending"
    captured = "captured"
    denied = "denied"
    failed = "failed"


class ActionType(str, enum.Enum):
    consent_check = "consent_check"
    order_created = "order_created"
    payment_captured = "payment_captured"
    payment_failed = "payment_failed"
    retry_attempted = "retry_attempted"
    merchant_notified = "merchant_notified"
    revocation_processed = "revocation_processed"
    race_condition_detected = "race_condition_detected"
    integrity_violation = "integrity_violation"


class ConsentContract(Base):
    __tablename__ = "consent_contracts"

    consent_id = Column(GUID(), primary_key=True, default=_uuid)
    user_id = Column(String, nullable=False)
    merchant_id = Column(String, nullable=False)
    spend_limit = Column(Numeric(12, 2), nullable=False)
    spend_used = Column(Numeric(12, 2), nullable=False, default=0)
    # Held under the row lock at execute()-time, before Razorpay/webhook
    # confirmation. spend_used only advances on a confirmed webhook, so
    # without this, two concurrent executes both see the same spend_used
    # and both pass the balance check — this is what the row lock alone
    # does NOT catch. Settled on webhook capture (moved into spend_used)
    # or released on a hard-stop failure / aborted transaction.
    spend_reserved = Column(Numeric(12, 2), nullable=False, default=0)
    per_txn_max = Column(Numeric(12, 2), nullable=False)
    scope = Column(JSON, nullable=False)  # list[str]
    expiry = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ConsentStatus), nullable=False, default=ConsentStatus.active)
    integrity_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id = Column(GUID(), primary_key=True, default=_uuid)
    consent_id = Column(GUID(), ForeignKey("consent_contracts.consent_id"), nullable=False)
    idempotency_key = Column(String, nullable=False, unique=True)
    amount = Column(Numeric(12, 2), nullable=False)
    sku_category = Column(String, nullable=False)
    status = Column(Enum(TransactionStatus), nullable=False, default=TransactionStatus.pending)
    razorpay_order_id = Column(String, nullable=True)
    razorpay_payment_id = Column(String, nullable=True)
    # Phase 4 — bounded-retry state. attempt_count is the number of Razorpay
    # orders created so far for this transaction (1 = only the original
    # attempt, never incremented past MAX_ATTEMPTS). `attempts` is the full
    # per-attempt timeline consumed by GET /transaction/{id}/status and the
    # dashboard's Transaction Timeline page — one dict per attempt with
    # order id, outcome, and timestamp, so the UI never has to reverse-
    # engineer the story from the consent-scoped audit log.
    attempt_number = Column(SAInteger, nullable=False, default=1)
    max_attempts = Column(SAInteger, nullable=False, default=2)
    attempt_count = Column(SAInteger, nullable=False, default=1)
    # Per-attempt timeline (order id, outcome, error reason, timestamps).
    # Written by executor.py (attempt 1) and failure.py (retries); read
    # verbatim by GET /transaction/{id}/status. Was referenced throughout
    # failure.py/webhooks.py but never declared here — attempt_count (an
    # int) was being used in its place, which crashes on the first real
    # payment failure or capture.
    attempts = Column(JSON, nullable=False, default=list)
    deny_reason = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    reasoning = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, nullable=False)


class AuditLog(Base):
    """A.5 — append-only reasoning trail. This is the single write surface
    for every consent-check and money-movement event in the system."""

    __tablename__ = "audit_logs"

    log_id = Column(GUID(), primary_key=True, default=_uuid)
    consent_id = Column(GUID(), ForeignKey("consent_contracts.consent_id"), nullable=False, index=True)
    action_type = Column(Enum(ActionType), nullable=False)
    reasoning = Column(String, nullable=False)
    structured_payload = Column(JSON, nullable=False, default=dict)
    timestamp = Column(DateTime(timezone=True), default=_now, nullable=False, index=True)
