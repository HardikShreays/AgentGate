#!/usr/bin/env python3
"""
Phase 5 — Revocation-mid-transaction demo (A.4/Phase 5, the "wow" moment).

Unlike tests/test_revocation.py (which hooks time.sleep in-process to make
the same abort deterministic without wall-clock timing), this script is
the real thing: it talks to a running AgentGate API over real HTTP and
uses a genuinely separate thread to send the revoke request while the
execute request is actually sleeping server-side.

Requires:
  - The API running with DEMO_MODE=true (see .env.example / README —
    flip it back to false afterwards; DEMO_MODE must be false for the
    race-condition test and any real submission run).

Usage:
  python scripts/revocation_demo.py
  python scripts/revocation_demo.py --base-url http://localhost:8000 --runs 3

Sequence per run:
  1. Create a fresh consent contract (spend_limit ₹2000, per_txn_max ₹500,
     scope ["groceries"]) so runs don't interfere with each other.
  2. Kick off POST /transaction/execute with simulate_delay_ms=3000 on a
     background thread. The executor sleeps for 3s *after* acquiring the
     row lock and re-checking consent, but *before* calling Razorpay
     (app/executor.py, A.4 steps 5-6).
  3. On the main thread, sleep 1s, then call POST /consent/{id}/revoke —
     a genuinely separate HTTP request landing mid-flight.
  4. Wait for the execute call to return, then fetch the full audit trail
     and verify: no Razorpay order was created, and the execute response
     is a clean denial with reason "revoked_mid_transaction".

Run 3x by default (--runs) per the plan's "run it 3 times to confirm
it's not a timing fluke" acceptance criterion.
"""
import argparse
import hashlib
import hmac
import os
import sys
import threading
import time
import uuid

import httpx

USER_ID = "u_demo"


def _principal_headers(user_id: str) -> dict:
    # Mirrors app.auth.derive_principal_key exactly — duplicated rather than
    # imported since this script runs as a bare file, not inside the `app`
    # package (see race_test.py's identical helper).
    secret = os.environ.get("AGENTGATE_HMAC_SECRET", "dev-only-change-me")
    key = hmac.new(secret.encode("utf-8"), user_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return {"X-Principal-Id": user_id, "X-AgentGate-Key": key}


def create_consent(client: httpx.Client, base_url: str) -> dict:
    resp = client.post(
        f"{base_url}/consent",
        json={
            "user_id": USER_ID,
            "merchant_id": "m_groceries_01",
            "spend_limit": 2000.00,
            "per_txn_max": 500.00,
            "scope": ["groceries"],
            "expiry_days": 7,
        },
        headers=_principal_headers(USER_ID),
    )
    resp.raise_for_status()
    return resp.json()


def run_once(base_url: str, amount: float, delay_ms: int, revoke_after_s: float, run_number: int) -> bool:
    print(f"\n=== Revocation demo — run {run_number} ===")
    with httpx.Client(timeout=delay_ms / 1000 + 10) as client:
        consent = create_consent(client, base_url)
        consent_id = consent["consent_id"]
        print(f"  consent_id = {consent_id}")

        execute_result: dict = {}
        execute_error: dict = {}

        def do_execute():
            try:
                resp = client.post(
                    f"{base_url}/transaction/execute",
                    json={
                        "consent_id": consent_id,
                        "amount": amount,
                        "sku_category": "groceries",
                        "idempotency_key": str(uuid.uuid4()),
                        "simulate_delay_ms": delay_ms,
                    },
                    headers=_principal_headers(USER_ID),
                )
                execute_result["status_code"] = resp.status_code
                execute_result["body"] = resp.json()
            except Exception as exc:  # surfaced on the main thread below
                execute_error["exc"] = exc

        t = threading.Thread(target=do_execute)
        t.start()

        time.sleep(revoke_after_s)
        print(f"  revoking consent {revoke_after_s}s into the delayed execute call...")
        revoke_resp = client.post(f"{base_url}/consent/{consent_id}/revoke", headers=_principal_headers(USER_ID))
        revoke_resp.raise_for_status()
        print(f"  revoke response: {revoke_resp.json()}")

        t.join()

        if execute_error:
            print(f"  FAIL: execute request raised an error: {execute_error['exc']}")
            return False

        exec_body = execute_result.get("body", {})
        print(f"  execute response: {exec_body}")

        audit_resp = client.get(f"{base_url}/audit/{consent_id}")
        audit_resp.raise_for_status()
        trail = audit_resp.json()["entries"]

        print("  --- audit trail ---")
        for entry in trail:
            print(f"    [{entry['action_type']}] {entry['reasoning']}")

        action_sequence = [e["action_type"] for e in trail]
        order_created = "order_created" in action_sequence
        aborted_correctly = (
            exec_body.get("status") == "denied"
            and exec_body.get("reason") == "revoked_mid_transaction"
            and not order_created
        )

        if aborted_correctly:
            print("  PASS: aborted before any Razorpay order was created.")
        else:
            print(
                "  FAIL: expected a clean abort with reason='revoked_mid_transaction' "
                "and no order_created row. Is the server running with DEMO_MODE=true?"
            )
        return aborted_correctly


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--amount", type=float, default=450.00)
    parser.add_argument("--delay-ms", type=int, default=3000)
    parser.add_argument("--revoke-after-s", type=float, default=1.0)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()

    print("AgentGate — revocation-mid-transaction demo")
    print(f"Target: {args.base_url}  (requires DEMO_MODE=true on the server)")

    results = []
    for i in range(1, args.runs + 1):
        try:
            results.append(run_once(args.base_url, args.amount, args.delay_ms, args.revoke_after_s, i))
        except httpx.ConnectError:
            print(f"  FAIL: could not connect to {args.base_url} — is the API running?")
            results.append(False)
        except httpx.HTTPStatusError as exc:
            print(f"  FAIL: HTTP error talking to {args.base_url}: {exc}")
            results.append(False)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} runs aborted cleanly.")
    if passed != len(results):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
