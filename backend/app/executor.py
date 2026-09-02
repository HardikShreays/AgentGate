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
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app import catalog
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


def release_stale_reservations(db: Session, consent_id: str) -> Decimal:
    """Return budget held by transactions whose checkout was abandoned.

    spend_reserved is written under the row lock at execute() time and
    settled only by a webhook. If the buyer closes the Razorpay modal no
    webhook ever arrives, so without this sweep the hold is permanent and
    the consent slowly exhausts itself without a rupee moving.

    Called lazily from execute() and GET /consent/{id} rather than from a
    scheduler — the only moments the stale value can actually mislead
    anyone are the next spend decision and the next dashboard read.

    # ponytail: linear scan of one consent's pending rows. Fine at demo
    # scale; add an index on (consent_id, status) if this ever runs against
    # a real transaction volume.
    """
    now = datetime.now(timezone.utc)
    ttl = timedelta(seconds=settings.RESERVATION_TTL_SECONDS)

    pending = (
        db.query(Transaction)
        .filter(Transaction.consent_id == consent_id)
        .filter(Transaction.status == TransactionStatus.pending)
        .all()
    )

    released_total = Decimal("0")
    released_rows: list[Transaction] = []
    for txn in pending:
        created = txn.created_at
        if created.tzinfo is None:
            # SQLite drops tzinfo on round-trip; treat naive as UTC so the
            # comparison is stable across SQLite and Postgres (same idiom as
            # consent.check_consent's expiry handling).
            created = created.replace(tzinfo=timezone.utc)
        if now - created < ttl:
            continue

        contract = db.get(ConsentContract, txn.consent_id)
        txn.status = TransactionStatus.expired
        # New dicts, never in-place mutation — SQLAlchemy's change detection
        # diffs by value and would skip the UPDATE otherwise (see the note in
        # failure.py's _record_attempt_outcome).
        new_attempts = []
        for entry in txn.attempts or []:
            entry = dict(entry)
            if entry.get("status") == "pending":
                entry["status"] = "expired"
                entry["resolved_at"] = _isoformat_now()
            new_attempts.append(entry)
        txn.attempts = new_attempts
        if contract is not None:
            contract.spend_reserved = max(
                Decimal("0"), Decimal(contract.spend_reserved or 0) - Decimal(txn.amount)
            )
            db.add(contract)
        db.add(txn)
        released_total += Decimal(txn.amount)
        released_rows.append(txn)

    if not released_rows:
        return Decimal("0")

    db.commit()
    for txn in released_rows:
        log_action(
            db,
            str(txn.consent_id),
            ActionType.reservation_released,
            {
                "transaction_id": str(txn.transaction_id),
                "amount": float(txn.amount),
                "ttl_seconds": settings.RESERVATION_TTL_SECONDS,
            },
        )
    return released_total


class TransactionExecutor:
    def __init__(self, db: Session):
        self.db = db
        self.client = get_client()

    def execute(
        self,
        consent_id: str,
        idempotency_key: str,
        amount: Decimal | None = None,
        sku_category: str | None = None,
        sku: str | None = None,
        simulate_delay_ms: int = 0,
    ) -> ExecuteTransactionResponse:
        # Catalog resolution (Task 1). When a sku is supplied the price and
        # category come from the server-side catalog, and any caller-supplied
        # amount is DISCARDED. An agent names an item; it never sets a price.
        if sku is not None:
            product = catalog.get_product(sku)
            if product is None:
                return ExecuteTransactionResponse(
                    transaction_id=None,
                    status="denied",
                    reason="unknown_sku",
                    reasoning=f"Denied: '{sku}' is not a product in this merchant's catalog.",
                )
            amount = product["price"]
            sku_category = product["category"]

        if amount is None or sku_category is None:
            return ExecuteTransactionResponse(
                transaction_id=None,
                status="denied",
                reason="invalid_request",
                reasoning="Denied: provide either a sku, or both amount and sku_category.",
            )

        # Return budget held by transactions whose checkout was abandoned
        # (Task 2) before deciding whether this one fits.
        release_stale_reservations(self.db, consent_id)

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
        self._log_check(consent_id, amount, sku_category, contract, result, sku=sku)
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

        self._log_check(consent_id, amount, sku_category, contract, result, under_lock=True, sku=sku)
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
            self._log_check(consent_id, amount, sku_category, contract, result, under_lock=True, sku=sku)
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
            sku=sku,
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

    def _log_check(self, consent_id, amount, sku_category, contract, result, under_lock=False, sku=None):
        payload = {
            "decision": "approved" if result.allowed else "denied",
            "amount": float(amount),
            "sku_category": sku_category,
            "sku": sku,
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
