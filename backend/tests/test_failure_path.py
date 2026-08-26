import json
import hashlib
import hmac
from decimal import Decimal

from fastapi.testclient import TestClient

from app import audit as audit_svc
from app.config import get_settings
from app.executor import TransactionExecutor
from app.failure import FailureHandler
from app.main import app
from app.models import ActionType, Transaction, TransactionStatus

settings = get_settings()


def _sign(body: str) -> str:
    return hmac.new(
        key=settings.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        msg=body.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()


def _make_order_via_executor(db, consent_contract, mock_razorpay, idempotency_key="fail-key"):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key=idempotency_key,
    )
    assert resp.status == "pending"
    return resp


def _post_failed_webhook(client, order_id, error="card_declined"):
    payload = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_FAIL_{order_id}",
                    "order_id": order_id,
                    "error_description": error,
                }
            }
        },
    }
    body = json.dumps(payload)
    return client.post(
        "/webhooks/razorpay", content=body, headers={"X-Razorpay-Signature": _sign(body)}
    )


def _override_db(db):
    from app.db import get_db as real_get_db

    def _get_db():
        yield db

    app.dependency_overrides[real_get_db] = _get_db


# --- unit-level: FailureHandler used directly ---------------------------------


def test_first_failure_triggers_one_bounded_retry(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "retry-key-1")
    handler = FailureHandler(db, sleep_fn=lambda _: None)
    result = handler.handle(resp.transaction_id, "card_declined")

    assert result["status"] == "retrying"
    assert result["attempt"] == 2

    txn = db.get(Transaction, resp.transaction_id)
    assert txn.status == TransactionStatus.pending
    assert txn.attempt_count == 2
    assert txn.razorpay_order_id != resp.razorpay_order_id  # a genuinely new order
    assert len(txn.attempts) == 2
    assert txn.attempts[0]["status"] == "failed"
    assert txn.attempts[1]["status"] == "pending"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_types = [e.action_type for e in trail.entries]
    assert ActionType.payment_failed in action_types
    assert ActionType.retry_attempted in action_types


def test_second_failure_hard_stops_and_notifies_merchant_no_third_order(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "retry-key-2")
    handler = FailureHandler(db, sleep_fn=lambda _: None, http_post_fn=lambda *a, **k: None)

    first = handler.handle(resp.transaction_id, "card_declined")
    assert first["status"] == "retrying"

    second = handler.handle(resp.transaction_id, "insufficient_funds")
    assert second["status"] == "failed"
    assert second["attempt_count"] == 2

    txn = db.get(Transaction, resp.transaction_id)
    assert txn.status == TransactionStatus.failed
    assert txn.attempt_count == 2  # never incremented past MAX_ATTEMPTS
    assert len(txn.attempts) == 2  # exactly two attempts total, no third

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_types = [e.action_type for e in trail.entries]
    assert action_types.count(ActionType.payment_failed) == 2
    assert action_types.count(ActionType.retry_attempted) == 1
    assert action_types.count(ActionType.merchant_notified) == 1


def test_hard_stop_is_provably_enforced_no_third_attempt_even_if_handle_called_again(
    db, consent_contract, mock_razorpay
):
    """Explicit regression guard for the plan's acceptance criterion:
    'a test that asserts no 3rd attempt occurs'."""
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "retry-key-3")
    handler = FailureHandler(db, sleep_fn=lambda _: None, http_post_fn=lambda *a, **k: None)

    handler.handle(resp.transaction_id, "card_declined")  # -> retrying, attempt 2
    handler.handle(resp.transaction_id, "insufficient_funds")  # -> failed, hard stop

    # A duplicate/late webhook delivery for the (already-terminal) transaction
    # must be a no-op: no attempt 3, no new order, no extra log rows.
    third = handler.handle(resp.transaction_id, "card_declined")
    assert third == {"status": "failed", "attempt_count": 2}

    txn = db.get(Transaction, resp.transaction_id)
    assert txn.attempt_count == 2
    assert len(txn.attempts) == 2

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_types = [e.action_type for e in trail.entries]
    assert action_types.count(ActionType.payment_failed) == 2  # not 3
    assert action_types.count(ActionType.merchant_notified) == 1  # not 2


def test_merchant_notification_failure_to_send_does_not_break_finalization(db, consent_contract, mock_razorpay):
    """The dummy notification endpoint won't exist in most environments —
    that must never leave the transaction half-finalized."""
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "retry-key-4")

    def _boom(*a, **k):
        raise ConnectionError("dummy endpoint unreachable")

    handler = FailureHandler(db, sleep_fn=lambda _: None, http_post_fn=_boom)
    handler.handle(resp.transaction_id, "card_declined")
    result = handler.handle(resp.transaction_id, "insufficient_funds")

    assert result["status"] == "failed"
    txn = db.get(Transaction, resp.transaction_id)
    assert txn.status == TransactionStatus.failed

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert any(e.action_type == ActionType.merchant_notified for e in trail.entries)


# --- integration-level: through the real webhook endpoint ---------------------


def test_failure_path_end_to_end_through_webhook_initial_retry_final(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "wh-fail-key")
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r1 = _post_failed_webhook(client, resp.razorpay_order_id)
            assert r1.status_code == 200

            txn = db.get(Transaction, resp.transaction_id)
            assert txn.status == TransactionStatus.pending  # retried
            retried_order_id = txn.razorpay_order_id
            assert retried_order_id != resp.razorpay_order_id

            r2 = _post_failed_webhook(client, retried_order_id)
            assert r2.status_code == 200
    finally:
        app.dependency_overrides.clear()

    txn = db.get(Transaction, resp.transaction_id)
    assert txn.status == TransactionStatus.failed
    assert txn.attempt_count == 2

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    action_types = [e.action_type for e in trail.entries]
    assert ActionType.retry_attempted in action_types
    assert ActionType.merchant_notified in action_types
    assert action_types.count(ActionType.payment_failed) == 2


def test_transaction_status_endpoint_returns_full_attempt_timeline(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "status-key")
    handler = FailureHandler(db, sleep_fn=lambda _: None, http_post_fn=lambda *a, **k: None)
    handler.handle(resp.transaction_id, "card_declined")
    handler.handle(resp.transaction_id, "insufficient_funds")

    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.get(f"/transaction/{resp.transaction_id}/status")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "failed"
            assert body["attempt_count"] == 2
            assert body["max_attempts"] == 2
            assert len(body["attempts"]) == 2
            assert body["attempts"][0]["status"] == "failed"
            assert body["attempts"][1]["status"] == "failed"
    finally:
        app.dependency_overrides.clear()


def test_transaction_status_endpoint_404_for_unknown_transaction(db):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.get("/transaction/does-not-exist/status")
            assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_capture_after_a_retry_is_recorded_against_the_current_attempt(db, consent_contract, mock_razorpay):
    """Happy-path-after-retry: attempt 1 fails, attempt 2 succeeds. spend_used
    must reflect a single successful capture, and the attempt timeline must
    show attempt 1 as failed and attempt 2 as captured."""
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, "recover-key")
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            _post_failed_webhook(client, resp.razorpay_order_id)

            txn = db.get(Transaction, resp.transaction_id)
            retried_order_id = txn.razorpay_order_id

            payload = {
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {"id": "pay_RECOVERED", "order_id": retried_order_id}
                    }
                },
            }
            body = json.dumps(payload)
            r = client.post(
                "/webhooks/razorpay", content=body, headers={"X-Razorpay-Signature": _sign(body)}
            )
            assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()

    txn = db.get(Transaction, resp.transaction_id)
    assert txn.status == TransactionStatus.captured
    assert txn.attempts[0]["status"] == "failed"
    assert txn.attempts[1]["status"] == "captured"

    from app.models import ConsentContract

    contract = db.get(ConsentContract, consent_contract.consent_id)
    assert contract.spend_used == Decimal("450.00")  # exactly one capture counted
