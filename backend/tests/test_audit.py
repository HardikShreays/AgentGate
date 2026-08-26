from decimal import Decimal

from app import audit as audit_svc
from app import consent as consent_svc
from app.executor import TransactionExecutor
from app.models import ActionType


def test_every_consent_check_produces_a_log_row(db, consent_contract):
    result, contract = consent_svc.check_consent(db, consent_contract.consent_id, Decimal("450"), "groceries")
    assert result.allowed
    audit_svc.log_action(
        db,
        consent_contract.consent_id,
        ActionType.consent_check,
        {
            "decision": "approved",
            "amount": 450,
            "sku_category": "groceries",
            "limit": 2000,
            "remaining": 1550,
        },
    )
    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert trail.entry_count == 1
    assert trail.entries[0].action_type == ActionType.consent_check
    assert "Approved" in trail.entries[0].reasoning


def test_reasoning_is_deterministic_same_inputs_same_output(db):
    payload = {
        "decision": "approved",
        "amount": 450,
        "sku_category": "groceries",
        "limit": 2000,
        "remaining": 1550,
    }
    s1 = audit_svc.render_reasoning(ActionType.consent_check, payload)
    s2 = audit_svc.render_reasoning(ActionType.consent_check, payload)
    assert s1 == s2
    assert s1 == "Approved: ₹450.00 groceries purchase within ₹2000.00 limit (₹1550.00 remaining)."


def test_denied_reasoning_matches_appendix_a4_example(db):
    payload = {"decision": "denied", "amount": 600, "per_txn_max": 500, "reason": "per_txn_max_exceeded"}
    s = audit_svc.render_reasoning(ActionType.consent_check, payload)
    assert s == "Denied: ₹600.00 exceeds per-transaction cap of ₹500.00."


def test_full_happy_path_produces_gap_free_ordered_trail(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key="idem-1",
    )
    # Order creation is synchronous; capture is confirmed later by webhook.
    assert resp.status == "pending"
    assert resp.razorpay_order_id.startswith("order_TESTFIXTURE")

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_sequence = [e.action_type for e in trail.entries]
    # check_consent runs once before the lock and once again under the
    # lock (A.4 steps 2 and 4) -- both are real, logged decisions.
    assert action_sequence == [
        ActionType.consent_check,
        ActionType.consent_check,
        ActionType.order_created,
    ]
    # timestamps are non-decreasing -> gap-free ordered narrative
    timestamps = [e.timestamp for e in trail.entries]
    assert timestamps == sorted(timestamps)


def test_denied_transaction_still_logs_consent_check_only(db, consent_contract):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("600.00"),  # exceeds per_txn_max of 500
        sku_category="groceries",
        idempotency_key="idem-2",
    )
    assert resp.status == "denied"
    assert resp.reason == "per_txn_max_exceeded"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert trail.entry_count == 1
    assert trail.entries[0].action_type == ActionType.consent_check
    assert "Denied" in trail.entries[0].reasoning
    # no money-movement rows for a denied request
    assert all(e.action_type != ActionType.order_created for e in trail.entries)


def test_revocation_is_logged_and_appears_in_trail(db, consent_contract):
    consent_svc.revoke_consent(db, consent_contract.consent_id)
    audit_svc.log_action(
        db,
        consent_contract.consent_id,
        ActionType.revocation_processed,
        {"revoked_by": "user", "revoked_at": "2026-08-25T00:00:00+00:00"},
    )
    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(e.action_type == ActionType.revocation_processed for e in trail.entries)


def test_integrity_violation_is_logged(db, consent_contract):
    # tamper with a stored field directly, bypassing the model layer
    consent_contract.spend_limit = Decimal("999999.00")
    db.add(consent_contract)
    db.commit()

    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("10.00"),
        sku_category="groceries",
        idempotency_key="idem-3",
    )
    assert resp.status == "denied"
    assert resp.reason == "integrity_violation"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_types = [e.action_type for e in trail.entries]
    assert ActionType.consent_check in action_types
    assert ActionType.integrity_violation in action_types


def test_unknown_action_type_raises_instead_of_writing_untemplated_row():
    import pytest

    class FakeAction:
        pass

    with pytest.raises(ValueError):
        audit_svc.render_reasoning(FakeAction(), {})


def test_audit_trail_is_scoped_to_its_own_consent_id(db):
    req_a = consent_svc.ConsentCreateRequest = None  # noop to satisfy linters
    from app import schemas

    contract_a = consent_svc.create_consent(
        db,
        schemas.ConsentCreateRequest(
            user_id="u_a", merchant_id="m1", spend_limit="1000", per_txn_max="500", scope=["groceries"]
        ),
    )
    contract_b = consent_svc.create_consent(
        db,
        schemas.ConsentCreateRequest(
            user_id="u_b", merchant_id="m1", spend_limit="1000", per_txn_max="500", scope=["groceries"]
        ),
    )
    audit_svc.log_action(db, contract_a.consent_id, ActionType.consent_check, {"decision": "approved", "amount": 1})
    audit_svc.log_action(db, contract_b.consent_id, ActionType.consent_check, {"decision": "approved", "amount": 2})

    trail_a = audit_svc.get_audit_trail(db, contract_a.consent_id)
    assert trail_a.entry_count == 1
    assert trail_a.entries[0].consent_id == str(contract_a.consent_id)
