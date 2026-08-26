from decimal import Decimal

from app import audit as audit_svc
from app.executor import TransactionExecutor
from app.models import ActionType


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
