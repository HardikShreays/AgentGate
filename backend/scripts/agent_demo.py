#!/usr/bin/env python3
"""
Phase 5 — Baseline buyer-agent demo (Phase 5 task 3).

Runs the real LangGraph agent (app.agent.run_agent) against a real
consent contract on DATABASE_URL (same DB as the API / frontend).
No server needs to be running. Requires a real GROQ_API_KEY; this
script does NOT mock the model (see tests/test_agent.py for the
fake-model version).

Usage:
  python scripts/agent_demo.py
  python scripts/agent_demo.py --message "Order ₹450 of groceries from m_groceries_01"
  python scripts/agent_demo.py --over-limit    # also runs a denial demo
"""
import argparse
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import SessionLocal, init_db
from app import consent as consent_svc
from app import audit as audit_svc
from app.agent import run_agent
from app import schemas


def make_demo_consent(db):
    req = schemas.ConsentCreateRequest(
        user_id="u_demo",
        merchant_id="m_groceries_01",
        spend_limit=Decimal("2000.00"),
        per_txn_max=Decimal("500.00"),
        scope=["groceries"],
        expiry_days=7,
    )
    return consent_svc.create_consent(db, req)


def print_trace(result):
    print("\n--- agent message trace ---")
    for m in result["messages"]:
        role = m.__class__.__name__
        tool_calls = getattr(m, "tool_calls", None)
        if tool_calls:
            for tc in tool_calls:
                print(f"  [{role}] tool_call: {tc['name']}({tc['args']})")
        elif role == "ToolMessage":
            print(f"  [{role}] {m.content}")
        elif m.content:
            print(f"  [{role}] {m.content}")
    print(f"\nFinal response: {result['final_response']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--message", default=None, help="Override the default baseline request.")
    parser.add_argument("--over-limit", action="store_true", help="Also run a request that exceeds per_txn_max.")
    args = parser.parse_args()

    from app.config import get_settings

    if not get_settings().GROQ_API_KEY:
        print(
            "GROQ_API_KEY is not set. Put it in backend/.env and re-run:\n"
            "  python scripts/agent_demo.py"
        )
        sys.exit(1)

    init_db()
    db = SessionLocal()
    contract = make_demo_consent(db)
    print(f"Created demo consent {contract.consent_id} — ₹2000 limit, ₹500 per-txn cap, scope=['groceries']")

    message = args.message or "Order ₹450 of groceries from m_groceries_01"
    message = f"{message} Use consent_id {contract.consent_id}."
    print(f"\n=== Baseline demo: \"{message}\" ===")
    result = run_agent(db, message)
    print_trace(result)

    if args.over_limit:
        over_message = f"Order ₹600 of groceries from m_groceries_01 Use consent_id {contract.consent_id}."
        print(f"\n=== Bounded-rejection demo: \"{over_message}\" ===")
        result2 = run_agent(db, over_message)
        print_trace(result2)

    print("\n--- full audit trail for this consent ---")
    trail = audit_svc.get_audit_trail(db, contract.consent_id)
    for entry in trail.entries:
        print(f"  [{entry.action_type.value}] {entry.reasoning}")


if __name__ == "__main__":
    main()
