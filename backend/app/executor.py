"""
Phase 2 — TransactionExecutor, real integration.

Sequence (A.4), now actually implemented rather than scaffolded:
(1) idempotency check
(2) check_consent
(3) SELECT ... FOR UPDATE on the consent row
(4) re-run check_consent under lock (closes the exhaustion race window)
(5)/(6) simulate_delay_ms + post-delay re-check — Phase 5's revocation
    demo hook. Only honored when DEMO_MODE=true.
(7) create a REAL Razorpay order via the pinned SDK
(8) capture — NOT done here. Capture is confirmed asynchronously by
    Razorpay calling POST /webhooks/razorpay (app/webhooks.py). This
    executor returns with status "pending" and the checkout details the
    frontend needs to open Razorpay Checkout. spend_used is only
    incremented once the webhook confirms capture — never optimistically
    here — so a browser tab closed mid-checkout can't silently consume
    budget.
"""
import time
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.audit import log_action
from app.config import get_settings
from app.consent import check_consent
from app.models import ActionType, ConsentContract, Transaction, TransactionStatus, _now
from app.razorpay_client import create_order, get_client
from app.schemas import ExecuteTransactionResponse, TransactionStatusResponse

settings = get_settings()


def get_transaction_status(db: Session, transaction_id: str) -> TransactionStatusResponse | None:
    """Phase 4/5 shared lookup: the full attempt timeline for a
    transaction. Backs both GET /transaction/{id}/status (app.main) and
    the buyer agent's get_status_tool (app.agent) — one source of truth
    rather than each caller re-deriving the response shape from the ORM
    row. Returns None (not a 404) on a missing id; callers decide how to
    surface that in their own protocol (HTTP 404 vs. a tool-result dict)."""
    txn = db.get(Transaction, transaction_id)
    if txn is None:
        return None

    return TransactionStatusResponse(
        transaction_id=str(txn.transaction_id),
        consent_id=str(txn.consent_id),
        status=txn.status.value,
        amount=txn.amount,
        sku_category=txn.sku_category,
        attempt_count=txn.attempt_count,
        max_attempts=settings.FAILURE_MAX_ATTEMPTS,
        razorpay_order_id=txn.razorpay_order_id,
        razorpay_payment_id=txn.razorpay_payment_id,
        attempts=txn.attempts or [],
    )


def _isoformat_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TransactionExecutor:
    def __init__(self, db: Session):
        self.db = db
        self.client = get_client()

    def execute(
        self,
        consent_id: str,
        amount: Decimal,
        sku_category: str,
        idempotency_key: str,
        simulate_delay_ms: int = 0,
    ) -> ExecuteTransactionResponse:
        # (1) idempotency short-circuit
        existing = (
            self.db.query(Transaction)
            .filter(Transaction.idempotency_key == idempotency_key)
            .first()
        )
        if existing:
            return ExecuteTransactionResponse(
                transaction_id=str(existing.transaction_id),
                status=existing.status.value,
                razorpay_order_id=existing.razorpay_order_id,
                razorpay_payment_id=existing.razorpay_payment_id,
                amount=existing.amount,
                reasoning="Idempotent replay: an identical request already produced this result.",
            )

        # (2) initial check_consent, outside the lock — cheap early exit
        result, contract = check_consent(self.db, consent_id, amount, sku_category)
        self._log_check(consent_id, amount, sku_category, contract, result)
        if not result.allowed:
            return self._denied_response(result)

        # (3) row lock on the consent row
        locked_contract = (
            self.db.query(ConsentContract)
            .filter(ConsentContract.consent_id == consent_id)
            .with_for_update()
            .first()
        )

        # (4) re-check under lock — closes the exhaustion race window
        result, contract = check_consent(self.db, consent_id, amount, sku_category)

        if result.allowed:
            # Reserve now, in the SAME transaction as the check above —
            # audit.log_action() commits by default, and that commit is
            # what releases the FOR UPDATE lock (see _log_check below).
            # If the reservation didn't land before that commit, a second
            # request could acquire the lock right after and still see an
            # un-held balance. spend_used only advances on webhook
            # confirmation, so without this hold, two concurrent requests
            # would both pass this check — the lock alone doesn't stop
            # that, only a written hold does.
            locked_contract.spend_reserved = Decimal(locked_contract.spend_reserved or 0) + amount
            self.db.add(locked_contract)

        self._log_check(consent_id, amount, sku_category, contract, result, under_lock=True)
        if not result.allowed:
            reason = result.reason
            if reason == "insufficient_remaining_balance":
                log_action(
                    self.db,
                    consent_id,
                    ActionType.race_condition_detected,
                    {"amount": float(amount), "remaining": float(result.remaining or 0)},
                )
            return self._denied_response(result)

        # (5) demo-only delay, honored strictly behind DEMO_MODE
        if settings.DEMO_MODE and simulate_delay_ms > 0:
            time.sleep(simulate_delay_ms / 1000)

            # (6) post-delay re-check — catches revocation mid-transaction
            result, contract = check_consent(self.db, consent_id, amount, sku_category)
            self._log_check(consent_id, amount, sku_category, contract, result, under_lock=True)
            if not result.allowed:
                # Abandoning before an order is created — release the hold
                # placed above so a revoked/aborted transaction doesn't
                # permanently lock up budget it never actually spent.
                self._release_reservation(consent_id, amount)
                return self._denied_response(result)

        # (7) create the real Razorpay order
        order = create_order(self.client, amount, receipt=idempotency_key)

        txn = Transaction(
            consent_id=consent_id,
            idempotency_key=idempotency_key,
            amount=amount,
            sku_category=sku_category,
            status=TransactionStatus.pending,
            razorpay_order_id=order["id"],
            attempt_number=1,
            max_attempts=settings.FAILURE_MAX_ATTEMPTS,
            attempt_count=1,
            attempts=[
                {
                    "attempt": 1,
                    "razorpay_order_id": order["id"],
                    "status": "pending",
                    "error_reason": None,
                    "created_at": _isoformat_now(),
                }
            ],
            updated_at=_now(),
        )
        self.db.add(txn)
        self.db.flush()  # assigns txn.transaction_id without ending the transaction,
        # so the order_created log row below can carry it for Phase 4's
        # GET /transaction/{id}/status to filter on.

        log_action(
            self.db,
            consent_id,
            ActionType.order_created,
            {
                "transaction_id": str(txn.transaction_id),
                "razorpay_order_id": order["id"],
                "amount": float(amount),
                "attempt": 1,
            },
        )

        self.db.commit()
        self.db.refresh(txn)

        # (8) capture happens via webhook, not here.
        return ExecuteTransactionResponse(
            transaction_id=str(txn.transaction_id),
            status="pending",
            razorpay_order_id=order["id"],
            amount=amount,
            reasoning=(
                f"Order {order['id']} created for ₹{amount:.2f}. "
                "Awaiting checkout completion and webhook confirmation."
            ),
        )

    def _release_reservation(self, consent_id: str, amount: Decimal) -> None:
        """Undo the hold placed under lock in execute() when a later check
        aborts before an order is created (currently: the Phase 5
        post-delay revocation re-check)."""
        contract = self.db.get(ConsentContract, consent_id)
        if contract is not None:
            contract.spend_reserved = max(Decimal("0"), Decimal(contract.spend_reserved or 0) - amount)
            self.db.add(contract)
            self.db.commit()

    def _log_check(self, consent_id, amount, sku_category, contract, result, under_lock=False):
        payload = {
            "decision": "approved" if result.allowed else "denied",
            "amount": float(amount),
            "sku_category": sku_category,
            "limit": float(contract.spend_limit) if contract else None,
            "used": float(contract.spend_used) if contract else None,
            "per_txn_max": float(contract.per_txn_max) if contract else None,
            "remaining": float(result.remaining) if result.remaining is not None else None,
            "reason": result.reason,
            "under_lock": under_lock,
        }
        log_action(self.db, consent_id, ActionType.consent_check, payload)
        if result.reason == "integrity_violation":
            log_action(self.db, consent_id, ActionType.integrity_violation, {"consent_id": consent_id})

    def _denied_response(self, result) -> ExecuteTransactionResponse:
        return ExecuteTransactionResponse(
            transaction_id=None,
            status="denied",
            reason=result.reason,
            reasoning=f"Denied: {result.reason}.",
        )
