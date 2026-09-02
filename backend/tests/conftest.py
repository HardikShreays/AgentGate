import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_fixture")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "fixture_secret")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "fixture_webhook_secret")
# Phase 4: real code path retries after a genuine delay (see app/failure.py),
# but the test suite shouldn't take 2+ real seconds per retry test. Set once
# at import time, before app.config's Settings() is ever constructed, so
# every module's module-level `settings = get_settings()` picks it up.
os.environ.setdefault("FAILURE_RETRY_DELAY_SECONDS", "0")

from app.db import Base  # noqa: E402
from app import schemas  # noqa: E402
from app import consent as consent_svc  # noqa: E402


@pytest.fixture()
def db():
    # StaticPool + check_same_thread=False: FastAPI's TestClient runs
    # endpoints in a worker thread. SQLite's :memory: DB is otherwise
    # per-connection, so the default thread-keyed pool would hand the
    # webhook handler a completely separate, empty database. StaticPool
    # pins everyone to the one real connection this fixture created.
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def consent_contract(db):
    req = schemas.ConsentCreateRequest(
        user_id="u_123",
        merchant_id="m_groceries_01",
        spend_limit="2000.00",
        per_txn_max="500.00",
        scope=["groceries"],
        expiry_days=7,
    )
    return consent_svc.create_consent(db, req)


@pytest.fixture()
def mock_razorpay():
    """Mocks the SDK boundary (app.executor.get_client / create_order), not
    our own logic. This is the standard way to test real integration code
    without live network access or real credentials: everything on OUR
    side of the wire — request construction, response handling, logging —
    runs for real; only the actual HTTP call to Razorpay's servers is
    replaced with a canned response shaped exactly like the real SDK's.
    """
    order_counter = {"n": 0}

    def fake_create_order(client, amount, receipt):
        order_counter["n"] += 1
        return {
            "id": f"order_TESTFIXTURE{order_counter['n']:04d}",
            "amount": int(amount * 100),
            "currency": "INR",
            "receipt": receipt,
            "status": "created",
        }

    # The reservation sweep asks Razorpay whether a stale order was actually
    # paid before expiring it. With no live Razorpay, default that lookup to
    # "abandoned" so the sweep's expiry mechanics stay testable; the
    # reconciliation tests patch this to "captured" / "unknown" explicitly.
    def fake_reconcile(db, txn):
        return "abandoned"

    with patch("app.executor.get_client", return_value=MagicMock()), patch(
        "app.executor.create_order", side_effect=fake_create_order
    ), patch("app.executor.reconcile_pending_order", side_effect=fake_reconcile), patch(
        "app.failure.get_client", return_value=MagicMock()
    ), patch("app.failure.create_order", side_effect=fake_create_order):
        yield
