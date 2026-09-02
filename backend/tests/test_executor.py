from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app import audit as audit_svc
from app import consent as consent_svc
from app.config import get_settings
from app.executor import TransactionExecutor, release_stale_reservations
from app.models import ActionType, ConsentContract, Transaction, TransactionStatus


def test_idempotency_key_reused_returns_existing_transaction_no_new_order(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    first = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="same-key",
    )
    second = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="same-key",
    )
    assert first.transaction_id == second.transaction_id
    assert first.razorpay_order_id == second.razorpay_order_id

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    order_created_rows = [e for e in trail.entries if e.action_type == ActionType.order_created]
    assert len(order_created_rows) == 1  # no double order from the replay


def test_two_requests_exceeding_remaining_balance_only_one_proceeds(db, consent_contract, mock_razorpay, monkeypatch):
    """Simulates the race window A.4 step 4 exists to close: a competing
    transaction commits between the initial check_consent (step 2) and
    the row lock (step 3), consuming the balance out from under this
    request. The re-check under lock (step 4) must catch it."""
    from app import executor as executor_module
    from app.schemas import ConsentCheckResult

    call_count = {"n": 0}
    real_check_consent = executor_module.check_consent

    def racy_check_consent(db_, consent_id, amount, sku_category):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Step 2: looks fine at this instant.
            return ConsentCheckResult(allowed=True, remaining=Decimal("300.00")), consent_contract
        # Step 4 (under lock): a competing transaction landed first and
        # consumed the remaining balance.
        return (
            ConsentCheckResult(allowed=False, reason="insufficient_remaining_balance", remaining=Decimal("0.00")),
            consent_contract,
        )

    monkeypatch.setattr(executor_module, "check_consent", racy_check_consent)

    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("400.00"),
        sku_category="groceries",
        idempotency_key="race-key",
    )
    assert resp.status == "denied"
    assert resp.reason == "insufficient_remaining_balance"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(e.action_type == ActionType.race_condition_detected for e in trail.entries)
    assert all(e.action_type != ActionType.order_created for e in trail.entries)


def test_no_delay_when_demo_mode_off_even_if_simulate_delay_ms_set(db, consent_contract, mock_razorpay, monkeypatch):
    import time as time_module

    from app import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("DEMO_MODE", "false")
    config.get_settings.cache_clear()

    slept = {"called": False}
    monkeypatch.setattr(time_module, "sleep", lambda *_: slept.__setitem__("called", True))

    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("100.00"),
        sku_category="groceries",
        idempotency_key="no-delay-key",
        simulate_delay_ms=3000,
    )
    assert resp.status == "pending"
    assert slept["called"] is False
    config.get_settings.cache_clear()


# --- Task 2: abandoned-checkout reservation sweep ---------------------------

def _backdate(db, idempotency_key, seconds):
    txn = db.query(Transaction).filter(Transaction.idempotency_key == idempotency_key).one()
    txn.created_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    db.add(txn)
    db.commit()


def test_abandoned_checkout_reservation_is_released_after_ttl(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="abandoned-1",
    )
    db.refresh(consent_contract)
    assert consent_contract.spend_reserved == Decimal("450.00")

    _backdate(db, "abandoned-1", get_settings().RESERVATION_TTL_SECONDS + 60)
    released = release_stale_reservations(db, consent_contract.consent_id)

    assert released == Decimal("450.00")
    db.refresh(consent_contract)
    assert consent_contract.spend_reserved == Decimal("0")
    txn = db.query(Transaction).filter(Transaction.idempotency_key == "abandoned-1").one()
    assert txn.status == TransactionStatus.expired

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(e.action_type == ActionType.reservation_released for e in trail.entries)


def test_fresh_reservation_is_not_swept(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="fresh-1",
    )
    released = release_stale_reservations(db, consent_contract.consent_id)
    assert released == Decimal("0")
    db.refresh(consent_contract)
    assert consent_contract.spend_reserved == Decimal("450.00")


def test_stale_sweep_frees_budget_for_a_later_transaction(db, consent_contract, mock_razorpay):
    """Behavioural: abandoned checkouts exhaust the contract, the sweep
    returns the budget, and the same transaction then succeeds."""
    executor = TransactionExecutor(db)
    # per_txn_max is 500, limit 2000 — four ₹500 holds exhaust remaining.
    for i in range(4):
        executor.execute(
            consent_id=consent_contract.consent_id,
            amount=Decimal("500.00"),
            sku_category="groceries",
            idempotency_key=f"hold-{i}",
        )

    blocked = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("500.00"),
        sku_category="groceries",
        idempotency_key="wants-in",
    )
    assert blocked.status == "denied"
    assert blocked.reason == "insufficient_remaining_balance"

    for i in range(4):
        _backdate(db, f"hold-{i}", get_settings().RESERVATION_TTL_SECONDS + 60)

    allowed = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("500.00"),
        sku_category="groceries",
        idempotency_key="wants-in-2",
    )
    assert allowed.status == "pending"


def test_late_webhook_for_expired_transaction_does_not_double_count(db, consent_contract, mock_razorpay):
    from app.webhooks import _handle_captured

    executor = TransactionExecutor(db)
    executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="late-webhook-1",
    )
    _backdate(db, "late-webhook-1", get_settings().RESERVATION_TTL_SECONDS + 60)
    release_stale_reservations(db, consent_contract.consent_id)

    txn = db.query(Transaction).filter(Transaction.idempotency_key == "late-webhook-1").one()
    _handle_captured(db, txn, "pay_LATE")

    db.refresh(consent_contract)
    assert consent_contract.spend_used == Decimal("0")
    assert txn.status == TransactionStatus.expired


# --- Task 3: spend_reserved is exposed and consistent ----------------------

def test_reserved_is_exposed_and_matches_check_consent_remaining(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="reserved-consistency",
    )
    db.refresh(consent_contract)

    result, _ = consent_svc.check_consent(
        db, consent_contract.consent_id, Decimal("0.00"), "groceries"
    )
    dashboard_remaining = (
        Decimal(consent_contract.spend_limit)
        - Decimal(consent_contract.spend_used)
        - Decimal(consent_contract.spend_reserved)
    )
    assert dashboard_remaining == result.remaining


# --- Task 5: exhausted / expired status become reachable -------------------

def test_contract_reports_exhausted_once_limit_is_consumed(db, mock_razorpay):
    from app.schemas import ConsentCreateRequest
    from app.webhooks import _handle_captured
    from app.models import ConsentStatus

    contract = consent_svc.create_consent(
        db,
        ConsentCreateRequest(
            user_id="u_x", merchant_id="m_groceries_01",
            spend_limit="500.00", per_txn_max="500.00",
            scope=["groceries"], expiry_days=7,
        ),
    )
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=contract.consent_id,
        amount=Decimal("500.00"),
        sku_category="groceries",
        idempotency_key="exhaust-1",
    )
    txn = db.query(Transaction).filter(Transaction.idempotency_key == "exhaust-1").one()
    _handle_captured(db, txn, "pay_FULL")

    db.refresh(contract)
    assert contract.status == ConsentStatus.exhausted


def test_expired_contract_reports_expired_status(db):
    from app.schemas import ConsentCreateRequest
    from app.models import ConsentStatus

    contract = consent_svc.create_consent(
        db,
        ConsentCreateRequest(
            user_id="u_y", merchant_id="m_groceries_01",
            spend_limit="500.00", per_txn_max="500.00",
            scope=["groceries"], expiry_days=7,
        ),
    )
    contract.expiry = datetime.now(timezone.utc) - timedelta(days=1)
    db.add(contract)
    db.commit()
    db.refresh(contract)

    assert consent_svc.effective_status(contract) == ConsentStatus.expired
