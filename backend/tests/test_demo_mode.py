from fastapi.testclient import TestClient

from app import executor as executor_module
from app.config import get_settings
from app.main import app


def test_demo_mode_can_be_toggled_at_runtime():
    settings = get_settings()
    original = settings.DEMO_MODE
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            r = client.post("/demo-mode", json={"enabled": True})
            assert r.status_code == 200
            assert r.json() == {"enabled": True}
            assert settings.DEMO_MODE is True
            assert executor_module.settings.DEMO_MODE is True

            r = client.get("/demo-mode")
            assert r.status_code == 200
            assert r.json() == {"enabled": True}

            r = client.post("/demo-mode", json={"enabled": False})
            assert r.status_code == 200
            assert r.json() == {"enabled": False}
            assert executor_module.settings.DEMO_MODE is False
    finally:
        settings.DEMO_MODE = original


def test_simulate_delay_ms_is_bounded():
    """Task 4 — a caller cannot request an unbounded delay and hold a consent
    row lock open. The schema caps it at 5000ms."""
    with TestClient(app, raise_server_exceptions=True) as client:
        r = client.post(
            "/transaction/execute",
            json={
                "consent_id": "does-not-matter",
                "amount": "100.00",
                "sku_category": "groceries",
                "idempotency_key": "bound-check",
                "simulate_delay_ms": 999999,
            },
        )
        assert r.status_code == 422


def test_execute_request_requires_sku_or_amount_plus_category():
    """Task 1 — a request with neither a sku nor (amount + sku_category) is
    meaningless and must fail at the schema boundary."""
    with TestClient(app, raise_server_exceptions=True) as client:
        r = client.post(
            "/transaction/execute",
            json={"consent_id": "x", "idempotency_key": "k"},
        )
        assert r.status_code == 422
