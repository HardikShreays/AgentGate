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
