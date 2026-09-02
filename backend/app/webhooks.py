"""
POST /webhooks/razorpay — the only place a transaction moves from
'pending' to 'captured' or 'failed'. Real signature verification against
RAZORPAY_WEBHOOK_SECRET; a bad signature is a hard 400 and gets logged
as an integrity-style event, never silently accepted.

Razorpay sends the signature in the `X-Razorpay-Signature` header, and
the check must run against the *raw* request body bytes (not the parsed
JSON — re-serializing can change byte-for-byte formatting and break the
HMAC comparison), so this reads request.body() directly rather than
request.json().
"""
from decimal import Decimal

import razorpay
from fastapi import APIRouter, Request, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.failure import FailureHandler
from app.models import ActionType, ConsentContract, ConsentStatus, Transaction, TransactionStatus, _now
from app.razorpay_client import get_client, verify_webhook_signature

router = APIRouter()


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    client = get_client()
    try:
        verify_webhook_signature(client, raw_body.decode("utf-8"), signature)
    except razorpay.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="invalid webhook signature")

    payload = await request.json()
    event = payload.get("event")
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    order_id = entity.get("order_id")
    payment_id = entity.get("id")

    if not order_id:
        raise HTTPException(status_code=400, detail="missing order_id in webhook payload")

    txn = db.query(Transaction).filter(Transaction.razorpay_order_id == order_id).first()
    if txn is None:
        # Nothing to reconcile against — ack so Razorpay doesn't retry
        # forever, but don't fabricate a log row for a transaction we
        # don't have.
        return {"status": "ignored", "reason": "unknown_order_id"}

    if event == "payment.captured":
        _handle_captured(db, txn, payment_id)
    elif event == "payment.failed":
        error_reason = entity.get("error_description") or entity.get("error_reason") or "unknown"
        _handle_failed(db, txn, error_reason)
    else:
        return {"status": "ignored", "reason": f"unhandled_event:{event}"}

    return {"status": "ok"}


def _handle_captured(db: Session, txn: Transaction, payment_id: str):
    if txn.status in (TransactionStatus.captured, TransactionStatus.failed, TransactionStatus.expired):
        # Idempotent / terminal: a retried webhook, or a late capture for a
        # transaction the reservation sweep already expired (Task 2) — never
        # reopen it or double-count spend_used.
        return

    contract = db.get(ConsentContract, txn.consent_id)
    txn.status = TransactionStatus.captured
    txn.razorpay_payment_id = payment_id
    txn.updated_at = _now()
    # New dicts, not in-place mutation of the existing ones — see the note
    # in app/failure.py's _record_attempt_outcome for why in-place mutation
    # here would silently fail to persist (SQLAlchemy's old/new diff would
    # see identical objects and skip the UPDATE).
    new_attempts = []
    for entry in txn.attempts or []:
        entry = dict(entry)
        if entry.get("attempt") == txn.attempt_count:
            entry["status"] = "captured"
            entry["razorpay_payment_id"] = payment_id
        new_attempts.append(entry)
    txn.attempts = new_attempts
    contract.spend_used = Decimal(contract.spend_used) + Decimal(txn.amount)
    # Settle the hold placed under lock in executor.execute(): the amount
    # is no longer "in flight, unconfirmed" — it's confirmed, so it moves
    # out of spend_reserved and into spend_used rather than being double-
    # counted against remaining balance.
    contract.spend_reserved = max(Decimal("0"), Decimal(contract.spend_reserved or 0) - Decimal(txn.amount))
    # Task 5 — once the limit is fully committed (spent + still held), the
    # contract is exhausted. Makes that ConsentStatus branch reachable and
    # the dashboard badge honest instead of stuck on "active".
    if Decimal(contract.spend_used) + Decimal(contract.spend_reserved or 0) >= Decimal(contract.spend_limit):
        contract.status = ConsentStatus.exhausted
    db.add(txn)
    db.add(contract)
    db.commit()

    log_action(
        db,
        str(txn.consent_id),
        ActionType.payment_captured,
        {
            "transaction_id": str(txn.transaction_id),
            "razorpay_order_id": txn.razorpay_order_id,
            "razorpay_payment_id": payment_id,
            "amount": float(txn.amount),
            "attempt": txn.attempt_count,
        },
    )


def _handle_failed(db: Session, txn: Transaction, error_reason: str):
    if txn.status in (TransactionStatus.captured, TransactionStatus.failed, TransactionStatus.expired):
        return  # idempotent: terminal already (captured, hard-failed, or
        # expired by the reservation sweep) — never reopen.

    # Phase 4 (FailureHandler) owns everything from here: logging this
    # attempt's failure, the bounded retry-or-finalize decision, and the
    # merchant notification on hard stop.
    FailureHandler(db).handle(str(txn.transaction_id), error_reason)
