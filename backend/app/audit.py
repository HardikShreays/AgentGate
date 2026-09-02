"""
Phase 3 — Audit Logger (Reasoning Trail).

Rule: if money moved or a consent check happened, there is a log row.
log_action() is the ONLY function anywhere in the codebase that writes to
AuditLog. Every reasoning string is template-generated from the structured
payload — deterministic (same inputs -> same string), never LLM prose.
This is what makes the trail genuinely queryable and testable, not just
readable.
"""
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActionType, AuditLog
from app.schemas import AuditLogEntry, AuditTrailResponse


def _money(v: Any) -> str:
    """Render an amount consistently as ₹ with 2 decimal places."""
    if v is None:
        return "?"
    return f"₹{Decimal(v):.2f}"


# --- deterministic reasoning templates, one per action_type -----------------
# Each function takes the structured_payload dict and returns a string.
# Keep these pure and side-effect-free: same payload in -> same string out.

def _tmpl_consent_check(p: dict) -> str:
    decision = p.get("decision")
    amount = _money(p.get("amount"))
    category = p.get("sku_category", "item")
    limit = _money(p.get("limit"))
    remaining = _money(p.get("remaining"))
    reason = p.get("reason")

    if decision == "approved":
        return f"Approved: {amount} {category} purchase within {limit} limit ({remaining} remaining)."

    reason_text = {
        "per_txn_max_exceeded": f"{amount} exceeds per-transaction cap of {_money(p.get('per_txn_max'))}",
        "insufficient_remaining_balance": f"{amount} exceeds remaining balance of {remaining}",
        "expired": "the consent contract has expired",
        "revoked": "the consent contract has been revoked",
        "revoked_mid_transaction": "the consent contract was revoked mid-transaction",
        "out_of_scope": f"'{category}' is outside the contract's approved scope",
        "invalid_sku_category": f"'{category}' is not a recognized SKU category",
        "unknown_sku": f"'{category}' is not a product in this merchant's catalog",
        "integrity_violation": "the stored contract failed integrity verification",
        "consent_not_found": "no matching consent contract was found",
    }.get(reason, reason or "the request did not satisfy the consent contract")
    return f"Denied: {reason_text}."


def _tmpl_order_created(p: dict) -> str:
    return f"Razorpay order {p.get('razorpay_order_id', '?')} created for {_money(p.get('amount'))}."


def _tmpl_payment_captured(p: dict) -> str:
    base = (
        f"Payment {p.get('razorpay_payment_id', '?')} captured for "
        f"{_money(p.get('amount'))} against order {p.get('razorpay_order_id', '?')}."
    )
    if p.get("reconciled_from") == "expired":
        return base + " Reconciled: this transaction had been expired as abandoned, but Razorpay confirmed the payment did go through."
    return base


def _tmpl_payment_failed(p: dict) -> str:
    attempt = p.get("attempt", 1)
    return f"Payment attempt {attempt} failed for {_money(p.get('amount'))}: {p.get('error_reason', 'unknown error')}."


def _tmpl_retry_attempted(p: dict) -> str:
    return f"Retrying transaction after failure (attempt {p.get('attempt', 2)} of {p.get('max_attempts', 2)})."


def _tmpl_merchant_notified(p: dict) -> str:
    return f"Merchant {p.get('merchant_id', '?')} notified of final status '{p.get('final_status', '?')}' for transaction {p.get('transaction_id', '?')}."


def _tmpl_revocation_processed(p: dict) -> str:
    return f"Consent revoked by {p.get('revoked_by', 'user')} at {p.get('revoked_at', '?')}."


def _tmpl_race_condition_detected(p: dict) -> str:
    return (
        f"Concurrent request for {_money(p.get('amount'))} denied under row lock: "
        f"only {_money(p.get('remaining'))} remained after a competing transaction committed first."
    )


def _tmpl_integrity_violation(p: dict) -> str:
    return f"Integrity check failed: stored hash does not match recomputed hash for consent {p.get('consent_id', '?')}."


def _tmpl_reservation_released(p: dict) -> str:
    return (
        f"Reservation of {_money(p.get('amount'))} released for transaction "
        f"{p.get('transaction_id', '?')}: checkout was never completed within "
        f"{p.get('ttl_seconds', '?')}s, so the hold was returned to the "
        f"contract's available balance."
    )


_TEMPLATES = {
    ActionType.consent_check: _tmpl_consent_check,
    ActionType.order_created: _tmpl_order_created,
    ActionType.payment_captured: _tmpl_payment_captured,
    ActionType.payment_failed: _tmpl_payment_failed,
    ActionType.retry_attempted: _tmpl_retry_attempted,
    ActionType.merchant_notified: _tmpl_merchant_notified,
    ActionType.revocation_processed: _tmpl_revocation_processed,
    ActionType.race_condition_detected: _tmpl_race_condition_detected,
    ActionType.integrity_violation: _tmpl_integrity_violation,
    ActionType.reservation_released: _tmpl_reservation_released,
}


def render_reasoning(action_type: ActionType, structured_payload: dict) -> str:
    template = _TEMPLATES.get(action_type)
    if template is None:
        raise ValueError(f"No reasoning template registered for action_type={action_type}")
    return template(structured_payload)


def log_action(
    db: Session,
    consent_id: str,
    action_type: ActionType,
    structured_payload: dict,
    commit: bool = True,
) -> AuditLog:
    """The single write path for the audit trail. Every Phase 1/2/4/5
    function that checks consent or moves money must call this — no
    silent steps.
    """
    reasoning = render_reasoning(action_type, structured_payload)
    row = AuditLog(
        consent_id=consent_id,
        action_type=action_type,
        reasoning=reasoning,
        structured_payload=structured_payload,
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    return row


def get_audit_trail(db: Session, consent_id: str) -> AuditTrailResponse:
    """GET /audit/{consent_id} — full ordered, human-readable reasoning trail."""
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.consent_id == consent_id)
        .order_by(AuditLog.timestamp.asc(), AuditLog.log_id.asc())
        .all()
    )
    entries = [AuditLogEntry.model_validate(r) for r in rows]
    return AuditTrailResponse(consent_id=consent_id, entry_count=len(entries), entries=entries)
