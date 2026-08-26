"""
Phase 1 — Consent Engine (minimal, as needed to feed the Phase 3 audit trail).

check_consent() is a pure function w.r.t. business logic: it reads the
consent row, verifies integrity, and returns Allow/Deny. It does NOT write
audit rows itself — the caller (executor / API layer) is responsible for
calling audit.log_action() with the result, keeping "single write path"
(Phase 3 rule) intact.
"""
import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import get_settings, VALID_SKU_CATEGORIES
from app.models import ConsentContract, ConsentStatus
from app.schemas import ConsentCheckResult

settings = get_settings()


def _canonical_json(contract_fields: dict) -> str:
    """A.3 — canonical JSON: sorted keys, no whitespace, Decimal as fixed 2dp strings."""
    normalized = dict(contract_fields)
    for key in ("spend_limit", "per_txn_max"):
        if key in normalized:
            normalized[key] = f"{Decimal(normalized[key]):.2f}"
    for key in ("expiry", "created_at"):
        val = normalized.get(key)
        if isinstance(val, datetime):
            # SQLite drops tzinfo on round-trip; treat naive datetimes as UTC
            # so the hash is stable whether the value just came from Python
            # or was reloaded from the DB.
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            normalized[key] = val.isoformat()
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def compute_integrity_hash(contract_fields: dict) -> str:
    message = _canonical_json(contract_fields)
    digest = hmac.new(
        settings.AGENTGATE_HMAC_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    )
    return digest.hexdigest()


def _fields_for_hash(contract: ConsentContract) -> dict:
    return {
        "consent_id": str(contract.consent_id),
        "user_id": contract.user_id,
        "merchant_id": contract.merchant_id,
        "spend_limit": contract.spend_limit,
        "per_txn_max": contract.per_txn_max,
        "scope": contract.scope,
        "expiry": contract.expiry,
        "created_at": contract.created_at,
    }


def verify_integrity(contract: ConsentContract) -> bool:
    expected = compute_integrity_hash(_fields_for_hash(contract))
    return hmac.compare_digest(expected, contract.integrity_hash)


def create_consent(db: Session, req) -> ConsentContract:
    from datetime import timedelta
    import uuid

    consent_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    expiry = created_at + timedelta(days=req.expiry_days)

    fields = {
        "consent_id": consent_id,
        "user_id": req.user_id,
        "merchant_id": req.merchant_id,
        "spend_limit": req.spend_limit,
        "per_txn_max": req.per_txn_max,
        "scope": req.scope,
        "expiry": expiry,
        "created_at": created_at,
    }
    integrity_hash = compute_integrity_hash(fields)

    contract = ConsentContract(
        consent_id=consent_id,
        user_id=req.user_id,
        merchant_id=req.merchant_id,
        spend_limit=req.spend_limit,
        spend_used=Decimal("0"),
        per_txn_max=req.per_txn_max,
        scope=req.scope,
        expiry=expiry,
        status=ConsentStatus.active,
        integrity_hash=integrity_hash,
        created_at=created_at,
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


def revoke_consent(db: Session, consent_id: str) -> ConsentContract | None:
    contract = db.get(ConsentContract, consent_id)
    if contract is None:
        return None
    contract.status = ConsentStatus.revoked
    contract.revoked_at = datetime.now(timezone.utc)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


def check_consent(
    db: Session, consent_id: str, amount: Decimal, sku_category: str
) -> tuple[ConsentCheckResult, ConsentContract | None]:
    """Pure decision function. Checks, in order:
    existence -> integrity -> status -> expiry -> sku validity/scope
    -> per_txn cap -> remaining balance.
    Returns (result, contract) so the caller can log with full context.
    """
    contract = db.get(ConsentContract, consent_id)
    if contract is None:
        return ConsentCheckResult(allowed=False, reason="consent_not_found"), None

    if not verify_integrity(contract):
        return ConsentCheckResult(allowed=False, reason="integrity_violation"), contract

    if contract.status == ConsentStatus.revoked:
        return ConsentCheckResult(allowed=False, reason="revoked_mid_transaction" if contract.revoked_at else "revoked"), contract

    if contract.status == ConsentStatus.exhausted:
        return ConsentCheckResult(allowed=False, reason="insufficient_remaining_balance"), contract

    now = datetime.now(timezone.utc)
    expiry = contract.expiry
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if now > expiry or contract.status == ConsentStatus.expired:
        return ConsentCheckResult(allowed=False, reason="expired"), contract

    if sku_category not in VALID_SKU_CATEGORIES:
        return ConsentCheckResult(allowed=False, reason="invalid_sku_category"), contract

    if sku_category not in (contract.scope or []):
        return ConsentCheckResult(allowed=False, reason="out_of_scope"), contract

    if amount > contract.per_txn_max:
        return ConsentCheckResult(allowed=False, reason="per_txn_max_exceeded"), contract

    remaining = Decimal(contract.spend_limit) - Decimal(contract.spend_used)
    if amount > remaining:
        return ConsentCheckResult(allowed=False, reason="insufficient_remaining_balance", remaining=remaining), contract

    return ConsentCheckResult(allowed=True, remaining=remaining - amount), contract
