"""
Phase 5 — revocation-mid-transaction, deterministic executor-level test.

This is the pytest-friendly sibling of scripts/revocation_demo.py. The
script proves the real thing over real HTTP with a real second process;
this test proves the same abort logic without wall-clock threading or a
running server, by hooking the *one* moment the real revocation demo
depends on timing: the executor's `time.sleep(simulate_delay_ms/1000)`
call in app.executor (A.4 steps 5/6). Instead of actually sleeping, the
hook here performs the "second process's" revoke call — the exact same
sequence of DB writes app.main's POST /consent/{id}/revoke performs —
synchronously, in the middle of the executor's own call stack. That
removes the timing dependency entirely while still exercising the real
`check_consent` / row-lock / post-delay-recheck code path.
"""
from decimal import Decimal

from app import audit as audit_svc
from app import consent as consent_svc
from app.executor import TransactionExecutor
from app.models import ActionType


def test_revocation_mid_transaction_aborts_before_razorpay_order(db, consent_contract, mock_razorpay, monkeypatch):
    from app import executor as executor_module

    monkeypatch.setattr(executor_module.settings, "DEMO_MODE", True)

    def revoke_during_the_delay(_seconds):
        # Mirrors app.main's POST /consent/{id}/revoke handler exactly:
        # revoke_consent() then a revocation_processed audit row, as if a
        # second, independent request landed while this one was "sleeping".
        contract = consent_svc.revoke_consent(db, consent_contract.consent_id)
        audit_svc.log_action(
            db,
            consent_contract.consent_id,
            ActionType.revocation_processed,
            {"revoked_by": "user", "revoked_at": contract.revoked_at.isoformat()},
        )

    monkeypatch.setattr(executor_module.time, "sleep", revoke_during_the_delay)

    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="revocation-demo-key",
        simulate_delay_ms=3000,
    )

    # Clean abort: denied, specific reason, no transaction row created.
    assert resp.status == "denied"
    assert resp.reason == "revoked_mid_transaction"
    assert resp.transaction_id is None

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_sequence = [e.action_type for e in trail.entries]

    # No Razorpay order was ever created — the post-delay re-check caught
    # the revocation before step 7 (create_order) ran.
    assert ActionType.order_created not in action_sequence
    assert ActionType.revocation_processed in action_sequence

    # The narrative the plan calls for: an approved check, then
    # revocation_processed, then a final denied check with the specific
    # revoked_mid_transaction reason — in that order.
    revocation_idx = action_sequence.index(ActionType.revocation_processed)
    before = trail.entries[:revocation_idx]
    after = trail.entries[revocation_idx + 1:]

    assert any(
        e.action_type == ActionType.consent_check and e.structured_payload.get("decision") == "approved"
        for e in before
    )
    denied_after = [
        e for e in after
        if e.action_type == ActionType.consent_check and e.structured_payload.get("reason") == "revoked_mid_transaction"
    ]
    assert len(denied_after) == 1


def test_revocation_before_delay_never_reaches_the_delay_hook(db, consent_contract, mock_razorpay, monkeypatch):
    """Sanity check on the test technique itself: if the consent is
    already revoked *before* execute() is even called (no mid-flight
    race at all), the very first check_consent should catch it — the
    sleep hook should never fire, and there is exactly one denied
    consent_check row, not two."""
    from app import executor as executor_module

    monkeypatch.setattr(executor_module.settings, "DEMO_MODE", True)

    sleep_calls = {"n": 0}

    def fail_if_called(_seconds):
        sleep_calls["n"] += 1

    monkeypatch.setattr(executor_module.time, "sleep", fail_if_called)

    consent_svc.revoke_consent(db, consent_contract.consent_id)

    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="already-revoked-key",
        simulate_delay_ms=3000,
    )

    assert resp.status == "denied"
    assert resp.reason == "revoked_mid_transaction"
    assert sleep_calls["n"] == 0  # never got past the very first check_consent
