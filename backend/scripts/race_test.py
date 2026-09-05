#!/usr/bin/env python3
"""
Phase 2 — Race-condition test script (A.6).

The logic this proves is already covered by an in-process unit test
(tests/test_executor.py, which hooks the lock to force the interleaving
deterministically). This script is the complement: two *genuinely
concurrent* HTTP requests against a running server, so the row-locking
in app/executor.py is exercised for real, not simulated.

Requires:
  - The API running with DEMO_MODE=false (this is not a demo-mode
    script; it relies on real concurrency, not the simulate_delay_ms
    hook).

Usage:
  python scripts/race_test.py
  python scripts/race_test.py --base-url http://localhost:8000

Sequence:
  1. Create a fresh consent contract with spend_limit=₹500,
     per_txn_max=₹500, scope=["groceries"] — so a single ₹300 purchase
     leaves only ₹200 remaining, and two concurrent ₹300 requests
     together exceed the limit even though each is individually within
     per_txn_max.
  2. Fire both requests at once from two threads, released together via
     a barrier so they hit the server as close to simultaneously as
     possible, each with a distinct idempotency_key.
  3. Assert: exactly one is accepted (status != "denied") and exactly
     one is denied with reason "insufficient_remaining_balance", and a
     race_condition_detected row appears in the audit trail.
"""
import argparse
import hashlib
import hmac
import os
import sys
import threading
import uuid

import httpx
from dotenv import load_dotenv

# Same file the running API reads its secret from (app/config.py's
# `env_file=".env"` is relative to backend/, not to wherever this script
# is invoked from) — loaded explicitly here since a plain os.environ.get()
# only sees vars actually exported into the shell, not ones sitting in a
# .env file. Without this, the script would silently sign with the wrong
# key and every request below would 401.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

USER_ID = "u_race_demo"


def _principal_headers(user_id: str) -> dict:
    # Mirrors app.auth.derive_principal_key exactly. Not imported directly
    # because this script is invoked as a bare file (README §9), not as
    # part of the `app` package, so `app` isn't necessarily importable.
    secret = os.environ.get("AGENTGATE_HMAC_SECRET", "dev-only-change-me")
    key = hmac.new(secret.encode("utf-8"), user_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return {"X-Principal-Id": user_id, "X-AgentGate-Key": key}


def create_consent(client: httpx.Client, base_url: str, spend_limit: float, per_txn_max: float) -> dict:
    resp = client.post(
        f"{base_url}/consent",
        json={
            "user_id": USER_ID,
            "merchant_id": "m_groceries_01",
            "spend_limit": spend_limit,
            "per_txn_max": per_txn_max,
            "scope": ["groceries"],
            "expiry_days": 7,
        },
        headers=_principal_headers(USER_ID),
    )
    resp.raise_for_status()
    return resp.json()


def run_once(base_url: str, amount: float, run_number: int) -> bool:
    print(f"\n=== Race-condition test — run {run_number} ===")
    with httpx.Client(timeout=30) as client:
        # remaining balance (₹500) is less than 2x amount (₹300), so at
        # most one of the two concurrent ₹300 requests can succeed.
        consent = create_consent(client, base_url, spend_limit=500.00, per_txn_max=500.00)
        consent_id = consent["consent_id"]
        print(f"  consent_id = {consent_id}  (spend_limit=500.00, per_txn_max=500.00)")

        barrier = threading.Barrier(2)
        results: list[dict] = [{}, {}]
        errors: list[Exception | None] = [None, None]

        def do_execute(idx: int):
            try:
                barrier.wait()  # release both threads together
                resp = client.post(
                    f"{base_url}/transaction/execute",
                    json={
                        "consent_id": consent_id,
                        "amount": amount,
                        "sku_category": "groceries",
                        "idempotency_key": str(uuid.uuid4()),
                        "simulate_delay_ms": 0,
                    },
                    headers=_principal_headers(USER_ID),
                )
                results[idx] = resp.json()
            except Exception as exc:
                errors[idx] = exc

        threads = [threading.Thread(target=do_execute, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        if any(errors):
            print(f"  FAIL: a request errored: {errors}")
            return False

        for i, r in enumerate(results):
            print(f"  request {i}: status={r.get('status')} reason={r.get('reason')}")

        statuses = [r.get("status") for r in results]
        reasons = [r.get("reason") for r in results]
        accepted = sum(1 for s in statuses if s != "denied")
        denied_correctly = sum(1 for r in reasons if r == "insufficient_remaining_balance")

        audit_resp = client.get(f"{base_url}/audit/{consent_id}")
        audit_resp.raise_for_status()
        trail = audit_resp.json()["entries"]
        race_detected = any(e["action_type"] == "race_condition_detected" for e in trail)

        ok = accepted == 1 and denied_correctly == 1 and race_detected
        if ok:
            print("  PASS: exactly one request accepted, one denied, race_condition_detected logged.")
        else:
            print(
                f"  FAIL: accepted={accepted} denied_correctly={denied_correctly} "
                f"race_detected={race_detected} (expected 1, 1, True). "
                "Is the server running with DEMO_MODE=false?"
            )
        return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--amount", type=float, default=300.00)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()

    print("AgentGate — race-condition test (A.6)")
    print(f"Target: {args.base_url}")

    results = []
    for i in range(1, args.runs + 1):
        try:
            results.append(run_once(args.base_url, args.amount, i))
        except httpx.ConnectError:
            print(f"  FAIL: could not connect to {args.base_url} — is the API running?")
            results.append(False)
        except httpx.HTTPStatusError as exc:
            print(f"  FAIL: HTTP error talking to {args.base_url}: {exc}")
            results.append(False)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} runs closed the race correctly.")
    if passed != len(results):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
