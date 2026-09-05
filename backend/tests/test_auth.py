"""
Principal auth (app/auth.py) — the fix for README §1's "no authentication
at all". Every mutating consent/spend/revoke endpoint now requires a valid
(X-Principal-Id, X-AgentGate-Key) pair, and the principal must own the
resource it's acting on. These tests hit the real FastAPI endpoints over
TestClient, not the service functions directly, since the enforcement
lives in the HTTP layer (main.py), not in consent.py/executor.py.
"""
from fastapi.testclient import TestClient

from app.auth import derive_principal_key
from app.main import app


def _override_db(db):
    from app.db import get_db as real_get_db

    def _get_db():
        yield db

    app.dependency_overrides[real_get_db] = _get_db


def _headers(user_id: str) -> dict:
    return {"X-Principal-Id": user_id, "X-AgentGate-Key": derive_principal_key(user_id)}


def test_create_consent_requires_principal_headers(db):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/consent",
                json={
                    "user_id": "u_123",
                    "merchant_id": "m_groceries_01",
                    "spend_limit": "2000.00",
                    "per_txn_max": "500.00",
                    "scope": ["groceries"],
                    "expiry_days": 7,
                },
            )
        assert r.status_code == 422  # missing required headers
    finally:
        app.dependency_overrides.clear()


def test_create_consent_rejects_wrong_key(db):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/consent",
                json={
                    "user_id": "u_123",
                    "merchant_id": "m_groceries_01",
                    "spend_limit": "2000.00",
                    "per_txn_max": "500.00",
                    "scope": ["groceries"],
                    "expiry_days": 7,
                },
                headers={"X-Principal-Id": "u_123", "X-AgentGate-Key": "not-the-real-key"},
            )
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_create_consent_rejects_creating_for_another_principal(db):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/consent",
                json={
                    "user_id": "u_someone_else",
                    "merchant_id": "m_groceries_01",
                    "spend_limit": "2000.00",
                    "per_txn_max": "500.00",
                    "scope": ["groceries"],
                    "expiry_days": 7,
                },
                headers=_headers("u_123"),
            )
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_create_consent_succeeds_for_the_matching_principal(db):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/consent",
                json={
                    "user_id": "u_123",
                    "merchant_id": "m_groceries_01",
                    "spend_limit": "2000.00",
                    "per_txn_max": "500.00",
                    "scope": ["groceries"],
                    "expiry_days": 7,
                },
                headers=_headers("u_123"),
            )
        assert r.status_code == 201
        assert r.json()["user_id"] == "u_123"
    finally:
        app.dependency_overrides.clear()


def test_revoke_rejects_a_different_principal_than_the_owner(db, consent_contract):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                f"/consent/{consent_contract.consent_id}/revoke",
                headers=_headers("u_not_the_owner"),
            )
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_revoke_succeeds_for_the_owning_principal(db, consent_contract):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                f"/consent/{consent_contract.consent_id}/revoke",
                headers=_headers(consent_contract.user_id),
            )
        assert r.status_code == 200
        assert r.json()["status"] == "revoked"
    finally:
        app.dependency_overrides.clear()


def test_execute_transaction_rejects_a_different_principal_than_the_owner(db, consent_contract, mock_razorpay):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/transaction/execute",
                json={
                    "consent_id": consent_contract.consent_id,
                    "amount": "100.00",
                    "sku_category": "groceries",
                    "idempotency_key": "auth-test-key",
                },
                headers=_headers("u_not_the_owner"),
            )
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_execute_transaction_succeeds_for_the_owning_principal(db, consent_contract, mock_razorpay):
    _override_db(db)
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post(
                "/transaction/execute",
                json={
                    "consent_id": consent_contract.consent_id,
                    "amount": "100.00",
                    "sku_category": "groceries",
                    "idempotency_key": "auth-test-key-2",
                },
                headers=_headers(consent_contract.user_id),
            )
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
    finally:
        app.dependency_overrides.clear()
