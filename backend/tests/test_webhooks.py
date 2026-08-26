import hashlib
import hmac
import json
from decimal import Decimal

from fastapi.testclient import TestClient

from app import audit as audit_svc
from app.config import get_settings
from app.executor import TransactionExecutor
from app.main import app
from app.models import ActionType, ConsentContract, Transaction, TransactionStatus

settings = get_settings()


def _sign(body: str) -> str:
    """Computes a REAL HMAC-SHA256 signature the same way Razorpay does,
    using the actual webhook secret from settings. This is not mocked —
    it's the exact algorithm app.razorpay_client.verify_webhook_signature
    checks against, via the real SDK's Utility.verify_signature."""
    return hmac.new(
        key=settings.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        msg=body.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()


def _make_order_via_executor(db, consent_contract, mock_razorpay, idempotency_key="wh-key"):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        amount=Decimal("450.00"),
        sku_category="groceries",
        idempotency_key=idempotency_key,
    )
    assert resp.status == "pending"
    return resp


def _override_db(db):
    from app.db import get_db as real_get_db

    def _get_db():
        yield db

    app.dependency_overrides[real_get_db] = _get_db


def test_webhook_rejects_bad_signature(db, consent_contract, mock_razorpay):
    _make_order_via_executor(db, consent_contract, mock_razorpay)
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            body = json.dumps({"event": "payment.captured", "payload": {}})
            r = client.post(
                "/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": "not-the-real-signature"},
            )
            assert r.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_webhook_captures_payment_with_valid_signature_and_updates_spend_used(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay)
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            payload = {
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {
                            "id": "pay_TESTFIXTURE0001",
                            "order_id": resp.razorpay_order_id,
                        }
                    }
                },
            }
            body = json.dumps(payload)
            r = client.post(
                "/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": _sign(body)},
            )
            assert r.status_code == 200
            assert r.json()["status"] == "ok"

        txn = db.query(Transaction).filter(Transaction.razorpay_order_id == resp.razorpay_order_id).first()
        assert txn.status == TransactionStatus.captured
        assert txn.razorpay_payment_id == "pay_TESTFIXTURE0001"

        contract = db.get(ConsentContract, consent_contract.consent_id)
        assert contract.spend_used == Decimal("450.00")

        trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
        assert any(e.action_type == ActionType.payment_captured for e in trail.entries)
    finally:
        app.dependency_overrides.clear()


def test_webhook_on_first_payment_failure_triggers_bounded_retry_not_immediate_failure(
    db, consent_contract, mock_razorpay
):
    """Updated for Phase 4: a single `payment.failed` webhook is only the
    first of FAILURE_MAX_ATTEMPTS attempts, so it must trigger the bounded
    retry (a new Razorpay order, transaction back to 'pending') rather than
    immediately marking the transaction terminally failed. The terminal
    failed-after-both-attempts case, hard-stop enforcement, and merchant
    notification are covered end-to-end in tests/test_failure_path.py."""
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, idempotency_key="wh-key-fail")
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            payload = {
                "event": "payment.failed",
                "payload": {
                    "payment": {
                        "entity": {
                            "id": "pay_TESTFIXTURE_FAIL",
                            "order_id": resp.razorpay_order_id,
                            "error_description": "card_declined",
                        }
                    }
                },
            }
            body = json.dumps(payload)
            r = client.post(
                "/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": _sign(body)},
            )
            assert r.status_code == 200

        txn = db.query(Transaction).filter(Transaction.transaction_id == resp.transaction_id).first()
        assert txn.status == TransactionStatus.pending  # retried, not yet terminal
        assert txn.attempt_count == 2
        assert txn.razorpay_order_id != resp.razorpay_order_id  # a genuinely new order

        contract = db.get(ConsentContract, consent_contract.consent_id)
        assert contract.spend_used == Decimal("0.00")  # a failed attempt never touches spend_used

        trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
        assert any(e.action_type == ActionType.payment_failed for e in trail.entries)
        assert any(e.action_type == ActionType.retry_attempted for e in trail.entries)
    finally:
        app.dependency_overrides.clear()


def test_webhook_capture_is_idempotent_on_duplicate_delivery(db, consent_contract, mock_razorpay):
    resp = _make_order_via_executor(db, consent_contract, mock_razorpay, idempotency_key="wh-key-dup")
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            payload = {
                "event": "payment.captured",
                "payload": {
                    "payment": {"entity": {"id": "pay_DUP0001", "order_id": resp.razorpay_order_id}}
                },
            }
            body = json.dumps(payload)
            headers = {"X-Razorpay-Signature": _sign(body)}
            client.post("/webhooks/razorpay", content=body, headers=headers)
            client.post("/webhooks/razorpay", content=body, headers=headers)  # Razorpay may retry

        contract = db.get(ConsentContract, consent_contract.consent_id)
        assert contract.spend_used == Decimal("450.00")  # not double-counted

        trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
        captured_rows = [e for e in trail.entries if e.action_type == ActionType.payment_captured]
        assert len(captured_rows) == 1
    finally:
        app.dependency_overrides.clear()
