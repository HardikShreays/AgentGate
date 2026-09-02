"""
Tiny forward-only migration runner for an EXISTING database.

There is no Alembic here (see README §8). `init_db()` runs
`Base.metadata.create_all()`, which creates missing *tables* but never adds
a column to a table that already exists, and never adds a value to a
Postgres ENUM type that already exists. So when the models gain a column or
an enum value and you are pointing at a database with data you want to
keep, run this instead of `docker compose down -v`.

Every statement is idempotent (`IF NOT EXISTS` / `ADD VALUE IF NOT
EXISTS`), so re-running is safe. Append new deltas to MIGRATIONS as the
models change.

    python -m scripts.migrate        # from backend/, with .env pointing at the DB
"""
from sqlalchemy import text

from app.db import engine

# (description, SQL). Postgres-only syntax; SQLite reached this state via a
# fresh create_all() and doesn't need any of it.
MIGRATIONS = [
    ("transactions.sku column",
     "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sku VARCHAR"),
    ("consent_contracts.spend_reserved column",
     "ALTER TABLE consent_contracts ADD COLUMN IF NOT EXISTS spend_reserved NUMERIC(12,2) NOT NULL DEFAULT 0"),
    ("transactionstatus enum: expired",
     "ALTER TYPE transactionstatus ADD VALUE IF NOT EXISTS 'expired'"),
    ("actiontype enum: reservation_released",
     "ALTER TYPE actiontype ADD VALUE IF NOT EXISTS 'reservation_released'"),
]


def main() -> None:
    if engine.dialect.name != "postgresql":
        print(f"dialect is {engine.dialect.name!r}, nothing to do — create_all() covers SQLite.")
        return
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        for desc, sql in MIGRATIONS:
            conn.execute(text(sql))
            print(f"ok  {desc}")
    print("done.")


if __name__ == "__main__":
    main()
