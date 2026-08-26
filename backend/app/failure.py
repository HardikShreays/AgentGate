"""
Phase 4 — Failure Path.

FailureHandler.handle() is the only place that decides what happens after
a Razorpay payment fails. It is invoked from app.webhooks on a verified
`payment.failed` event (never called speculatively, never called from
inside the executor's happy path).

State machine, per the plan (Section "Phase 4"):
    attempt N fails
        -> log `payment_failed` for attempt N
        -> if N < FAILURE_MAX_ATTEMPTS:
               sleep FAILURE_RETRY_DELAY_SECONDS (bounded, real delay —
               not a busy loop), create ONE new Razorpay order, log
               `retry_attempted`, transaction goes back to `pending`
               awaiting the next webhook.
           else:
               mark the transaction `failed` (terminal), log a simulated
               merchant notification (`merchant_notified`), hard stop.
               No 3rd order is ever created — this is the "no loop"
               guarantee and is directly tested in
               tests/test_failure_path.py.

Every attempt (order id, outcome, error reason, timestamp) is appended to
Transaction.attempts, which is what GET /transaction/{id}/status returns
verbatim — the dashboard's Transaction Timeline page reads this, not the
consent-scoped audit trail, so it doesn't need to reverse-engineer a
transaction's story out of another entity's log.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.models import ActionType, Transaction, TransactionStatus
from app.razorpay_client import create_order, get_client

settings = get_settings()


def _isoformat_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FailureHandler:
    def __init__(self, db: Session, sleep_fn=None, http_post_fn=None):
        self.db = db
        self.client = get_client()
        # Injectable for tests: real code paths (time.sleep, httpx.post)
        # stay real by default; tests substitute fast/fake versions rather
        # than monkeypatching global functions.
        self._sleep = sleep_fn or __import__("time").sleep
        self._http_post = http_post_fn or httpx.post

    def handle(self, transaction_id: str, error_reason: str) -> dict:
        txn = self.db.get(Transaction, transaction_id)
        if txn is None:
            raise ValueError(f"transaction not found: {transaction_id}")

        if txn.status in (TransactionStatus.captured, TransactionStatus.failed):
            # Terminal already (e.g. a duplicate/delayed webhook delivery
            # for an attempt we've already resolved) — nothing to do.
            # Never re-open a terminal transaction or create another order.
            return {"status": txn.status.value, "attempt_count": txn.attempt_count}

        current_attempt = txn.attempt_count
        self._record_attempt_outcome(txn, current_attempt, "failed", error_reason)

        log_action(
            self.db,
            str(txn.consent_id),
            ActionType.payment_failed,
            {
                "transaction_id": str(txn.transaction_id),
                "amount": float(txn.amount),
                "attempt": current_attempt,
                "max_attempts": settings.FAILURE_MAX_ATTEMPTS,
                "error_reason": error_reason,
            },
        )

        if current_attempt < settings.FAILURE_MAX_ATTEMPTS:
            return self._retry(txn, current_attempt)
        return self._finalize_failed(txn, current_attempt, error_reason)

    def _retry(self, txn: Transaction, current_attempt: int) -> dict:
        # Bounded, real delay — not a spin loop. Honored unconditionally
        # (unlike the Phase 5 DEMO_MODE-gated delay in the executor): this
        # delay is a genuine "wait before retrying a real payment", not a
        # demo-only hook.
        self._sleep(settings.FAILURE_RETRY_DELAY_SECONDS)

        next_attempt = current_attempt + 1
        order = create_order(self.client, txn.amount, receipt=f"{txn.idempotency_key}-retry{next_attempt}")

        txn.attempt_count = next_attempt
        txn.razorpay_order_id = order["id"]
        txn.status = TransactionStatus.pending
        self._append_attempt(txn, next_attempt, order["id"], "pending", None)
        self.db.add(txn)
        self.db.commit()
        self.db.refresh(txn)

        log_action(
            self.db,
            str(txn.consent_id),
            ActionType.retry_attempted,
            {
                "transaction_id": str(txn.transaction_id),
                "attempt": next_attempt,
                "max_attempts": settings.FAILURE_MAX_ATTEMPTS,
                "razorpay_order_id": order["id"],
                "amount": float(txn.amount),
            },
        )
        return {"status": "retrying", "attempt": next_attempt, "razorpay_order_id": order["id"]}

    def _finalize_failed(self, txn: Transaction, current_attempt: int, error_reason: str) -> dict:
        txn.status = TransactionStatus.failed
        self.db.add(txn)
        self.db.commit()
        self.db.refresh(txn)

        self._notify_merchant(txn, error_reason)

        log_action(
            self.db,
            str(txn.consent_id),
            ActionType.merchant_notified,
            {
                "transaction_id": str(txn.transaction_id),
                "merchant_id": None,  # not denormalized onto Transaction; see README note
                "final_status": "failed",
                "attempts_made": current_attempt,
            },
        )
        return {"status": "failed", "attempt_count": current_attempt}

    def _notify_merchant(self, txn: Transaction, error_reason: str) -> None:
        """A logged call to a dummy webhook endpoint, per the plan — no real
        email/SMS. Best-effort: a merchant notification failing to *send*
        must never crash the failure path or leave the transaction in a
        half-finalized state, so network errors are swallowed here (the
        `merchant_notified` audit row is what actually proves this step
        ran, independent of whether the dummy endpoint was reachable).
        """
        try:
            self._http_post(
                settings.MERCHANT_NOTIFICATION_WEBHOOK_URL,
                json={
                    "transaction_id": str(txn.transaction_id),
                    "consent_id": str(txn.consent_id),
                    "final_status": "failed",
                    "error_reason": error_reason,
                },
                timeout=2.0,
            )
        except Exception:
            pass

    @staticmethod
    def _record_attempt_outcome(txn: Transaction, attempt: int, status: str, error_reason: Optional[str]) -> None:
        # Build entirely new dicts rather than mutating the existing ones
        # in place: `txn.attempts` before this call and the list we hand
        # back are otherwise the *same* dict objects, so SQLAlchemy's
        # change-detection (which diffs old vs. new by value) would see
        # no difference and silently skip the UPDATE on commit.
        new_attempts = []
        for entry in txn.attempt_count or []:
            entry = dict(entry)
            if entry.get("attempt") == attempt:
                entry["status"] = status
                entry["error_reason"] = error_reason
                entry["resolved_at"] = _isoformat_now()
            new_attempts.append(entry)
        txn.attempts = new_attempts

    @staticmethod
    def _append_attempt(txn: Transaction, attempt: int, order_id: str, status: str, error_reason: Optional[str]) -> None:
        new_attempts = [dict(entry) for entry in (txn.attempts or [])]
        new_attempts.append(
            {
                "attempt": attempt,
                "razorpay_order_id": order_id,
                "status": status,
                "error_reason": error_reason,
                "created_at": _isoformat_now(),
            }
        )
        txn.attempts = new_attempts
