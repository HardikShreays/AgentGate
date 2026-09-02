"""
Task 1 — agent-readable catalog.

The load-bearing property under test: an agent names an item, the server
prices it. A caller-supplied amount is discarded when a sku is present, so a
hallucinated or adversarial price cannot reach Razorpay.
"""
from decimal import Decimal

from app import audit as audit_svc
from app.catalog import CATALOG, get_product, list_products
from app.config import VALID_SKU_CATEGORIES
from app.executor import TransactionExecutor
from app.models import ActionType, Transaction, TransactionStatus


def test_every_catalog_category_is_a_valid_consent_scope_category():
    """Drift guard: the catalog can never reference a category the consent
    engine's taxonomy doesn't know about, or an out_of_scope check becomes
    unreachable for that product."""
    for product in CATALOG:
        assert product["category"] in VALID_SKU_CATEGORIES, product["sku"]


def test_supplied_amount_is_ignored_when_sku_is_given(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        sku="sku_rice_5kg",
        amount=Decimal("1.00"),  # a lie — must not be honored
        idempotency_key="catalog-price-key",
    )
    assert resp.status == "pending"

    txn = db.query(Transaction).filter(Transaction.idempotency_key == "catalog-price-key").one()
    assert txn.amount == Decimal("420.00")
    assert txn.sku == "sku_rice_5kg"
    assert txn.sku_category == "groceries"


def test_unknown_sku_is_denied_and_creates_no_order(db, consent_contract, mock_razorpay):
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        sku="sku_does_not_exist",
        idempotency_key="unknown-sku-key",
    )
    assert resp.status == "denied"
    assert resp.reason == "unknown_sku"

    trail = audit_svc.get_audit_trail(db, consent_contract.consent_id)
    assert all(e.action_type != ActionType.order_created for e in trail.entries)


def test_out_of_scope_catalog_item_is_denied(db, consent_contract, mock_razorpay):
    """consent_contract's scope is ["groceries"]; earbuds are electronics."""
    executor = TransactionExecutor(db)
    resp = executor.execute(
        consent_id=consent_contract.consent_id,
        sku="sku_earbuds",
        idempotency_key="oos-key",
    )
    assert resp.status == "denied"
    assert resp.reason == "out_of_scope"


def test_list_products_filters_by_category():
    food = list_products("groceries")
    assert food and all(p["category"] == "groceries" for p in food)
    assert get_product("sku_biryani")["price"] == Decimal("320.00")
    assert get_product("nope") is None
