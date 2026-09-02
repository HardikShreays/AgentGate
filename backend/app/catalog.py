"""
Agent-readable merchant catalog (Task 1).

Track 01 asks for a merchant "transactable by an AI buyer end to end". The
consent layer answers "may this spend happen?"; this module answers "what
is there to buy, and what does it cost?" — the half a buyer agent needs
before a consent check is even meaningful.

Prices live here, server-side, and executor.py resolves them from the SKU.
An agent names an item; it never states a price. A hallucinated or
adversarial amount cannot reach Razorpay, because the amount is never taken
from the caller when a sku is supplied.

# ponytail: static list, not a DB table — one synthetic merchant, fixed
# demo data, no admin UI. Move to a table when a second merchant or a
# mutable price exists.
"""
from decimal import Decimal

# category MUST be a member of config.VALID_SKU_CATEGORIES — test_catalog.py
# asserts this, so the catalog can never drift out of the consent taxonomy.
CATALOG = [
    {"sku": "sku_rice_5kg",     "name": "Basmati rice, 5 kg",        "category": "groceries",     "price": Decimal("420.00")},
    {"sku": "sku_atta_10kg",    "name": "Whole wheat atta, 10 kg",   "category": "groceries",     "price": Decimal("380.00")},
    {"sku": "sku_coffee_500g",  "name": "Filter coffee, 500 g",      "category": "groceries",     "price": Decimal("290.00")},
    {"sku": "sku_oil_1l",       "name": "Cold-pressed oil, 1 L",     "category": "groceries",     "price": Decimal("240.00")},
    {"sku": "sku_thali_meal",   "name": "South Indian thali",        "category": "food",          "price": Decimal("180.00")},
    {"sku": "sku_biryani",      "name": "Hyderabadi biryani",        "category": "food",          "price": Decimal("320.00")},
    {"sku": "sku_earbuds",      "name": "Wireless earbuds",          "category": "electronics",   "price": Decimal("1899.00")},
    {"sku": "sku_powerbank",    "name": "10000 mAh power bank",      "category": "electronics",   "price": Decimal("1290.00")},
    {"sku": "sku_music_1m",     "name": "Music streaming, 1 month",  "category": "subscriptions", "price": Decimal("119.00")},
]

_BY_SKU = {p["sku"]: p for p in CATALOG}


def get_product(sku: str) -> dict | None:
    return _BY_SKU.get(sku)


def list_products(category: str | None = None) -> list[dict]:
    if category is None:
        return list(CATALOG)
    return [p for p in CATALOG if p["category"] == category]
