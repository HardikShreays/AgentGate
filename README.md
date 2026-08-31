# AgentGate

**Track 01 — AI Growth & Agentic Commerce (Razorpay AI Buildathon)**

A consent-and-trust layer for agentic commerce: an AI buyer agent can only
spend money through a scoped, expiring, tamper-evident consent contract,
and every check and every rupee moved is logged to a deterministic,
queryable reasoning trail — in real time, enforced live, not just checked
once at the start.

---

## 1. Problem statement

Agentic commerce demos tend to focus on the fun part — an agent that can
browse a catalog, negotiate, and check out. The hard part, and the part
that actually determines whether anyone lets an agent near their money, is
narrower and less flashy: **can the human bound what the agent is allowed
to spend, verify that the bound was actually enforced, and revoke it
mid-flight if something looks wrong?**

That's the entire bet of this project. AgentGate does not build a
marketplace, a negotiation protocol, or a multi-merchant catalog. It
builds one thing deeply: a **Consent Engine** that issues scoped, expiring,
per-transaction-capped spend authorizations with tamper-evident storage; a
**transaction executor** that is race-safe under concurrent load and closes
its consent check as late as physically possible before money moves; an
**audit logger** that produces a gap-free, deterministic reasoning trail for
every decision; and a **live revocation demo** that proves the bound is
enforced *during* a transaction, not just checked at the door.

Everything else — multi-merchant catalogs, negotiation, velocity limiting,
circuit breakers — is real, interesting, and deliberately out of scope.
See [Future Work](#7-future-work).

---

## 2. Architecture

```
┌──────────────────┐      NL request       ┌────────────────────┐
│   Buyer Agent     │──────────────────────▶│   AgentGate API     │
│ (LangGraph, 3     │◀──────────────────────│   (FastAPI)         │
│  tools, ReAct loop)│  structured response  │                     │
└──────────────────┘                        │  ┌───────────────┐  │
                                             │  │ Consent Engine │  │
                                             │  └───────┬───────┘  │
                                             │          │          │
                                             │  ┌───────▼───────┐  │
                                             │  │ Tx Executor    │──┼───▶ Razorpay Test Mode API
                                             │  │ (row-locked)   │  │      (orders, capture, webhooks)
                                             │  └───────┬───────┘  │
                                             │          │          │
                                             │  ┌───────▼───────┐  │
                                             │  │ Audit Logger   │  │
                                             │  │ (reasoning +   │  │
                                             │  │  structured    │  │
                                             │  │  JSON per row) │  │
                                             │  └───────────────┘  │
                                             └──────────┬──────────┘
                                                         │
                                             ┌───────────▼──────────┐
                                             │  Merchant Dashboard   │
                                             │  (Next.js) — consent  │
                                             │  inspector + tx       │
                                             │  timeline (2 pages)   │
                                             └───────────────────────┘
```

**Stack:** FastAPI (Python 3.11+) · PostgreSQL · LangGraph (single ReAct
node, 3 bound tools) · Razorpay Test Mode API · Next.js + TypeScript ·
Docker Compose.

Money decisions are never made by an LLM. The agent's system prompt is
explicit that it may only act through three tools, but the prompt is not
the enforcement — the tools call directly into `app/consent.py` and
`app/executor.py`, the same functions the plain HTTP API uses, so a
hallucinated "sure, that worked" from the model has no way to actually
move money.

---

## 3. What's built, by phase

| Phase | Status | Where |
|---|---|---|
| 1 — Consent Engine | Done | `backend/app/consent.py`, `backend/app/schemas.py` |
| 2 — Executor + Razorpay integration | Done | `backend/app/executor.py`, `backend/app/razorpay_client.py`, `backend/app/webhooks.py` |
| 3 — Audit Logger | Done | `backend/app/audit.py` |
| 4 — Failure path | Done | `backend/app/failure.py` |
| 5 — Buyer agent + revocation demo | Done | `backend/app/agent.py`, `backend/scripts/revocation_demo.py` |
| 6 — Merchant dashboard | Done | `frontend/app/consent/[id]`, `frontend/app/transactions/[id]` |
| 7 — Packaging | This document + `docker-compose.yml` + `scripts/race_test.py` |

**One real design correction made during Phase 2, worth calling out
explicitly:** Razorpay's actual flow is *create order → checkout on
Razorpay's page → webhook confirms the result*; a backend never
synchronously "captures" a payment itself. So `execute_transaction`
returns `status: "pending"` with the order ID, and `spend_used` is
incremented only once `POST /webhooks/razorpay` receives and verifies a
`payment.captured` event — never optimistically in the executor. This is
safer than a synchronous-capture design and matches how Razorpay actually
works; it's a deliberate deviation from a literal reading of Appendix A.4
step 8, not an oversight.

---

## 4. API contract

### Consent

`POST /consent` — create a contract.
```json
{"user_id": "u_123", "merchant_id": "m_groceries_01",
 "spend_limit": 2000.00, "per_txn_max": 500.00,
 "scope": ["groceries"], "expiry_days": 7}
```
→ `201`, full contract including `integrity_hash` and a freshly-recomputed
`integrity_valid` flag (never trusted from storage — recomputed on every
read).

`GET /consent/{id}` — same shape, plus `revoked_at`.

`POST /consent/{id}/revoke` → `{"consent_id": "...", "status": "revoked", "revoked_at": "..."}`.

### Transactions

`POST /transaction/execute`
```json
{"consent_id": "c_...", "amount": 450.00, "sku_category": "groceries",
 "idempotency_key": "client-generated-uuid", "simulate_delay_ms": 0}
```
Sequence: idempotency lookup → `check_consent` → `SELECT ... FOR UPDATE`
row lock → re-check under lock (closes the exhaustion race window) →
(if `DEMO_MODE=true` and `simulate_delay_ms>0`) sleep, then re-check once
more (this is what catches mid-flight revocation) → create the real
Razorpay order. Capture is confirmed later, asynchronously, by the
webhook — see the design note above.

Denied response shape:
```json
{"transaction_id": null, "status": "denied", "reason": "per_txn_max_exceeded",
 "reasoning": "Denied: ₹600 exceeds per-transaction cap of ₹500."}
```

`GET /transaction/{id}/status` — full per-attempt timeline (original
attempt, any bounded retry, final outcome), independent of the
consent-scoped audit trail; this is what the dashboard's Transaction
Timeline page reads directly.

`POST /webhooks/razorpay` — `payment.captured` / `payment.failed`, HMAC
signature verified via the pinned SDK's
`client.utility.verify_webhook_signature()`; a bad signature is rejected
with `400` before anything is written.

### Audit

`GET /audit/{consent_id}` — the full, ordered, gap-free reasoning trail
for a consent contract. Every row pairs a deterministic, template-generated
human-readable `reasoning` string with a `structured_payload` JSON blob,
so the trail is both readable and queryable — never LLM-generated prose.

### Agent

`POST /agent/message` — `{"message": "..."}` → runs the LangGraph buyer
agent once and returns its final text response. A thin HTTP entry point
over the same agent used by `scripts/agent_demo.py`; not part of the
non-negotiable scope, kept intentionally minimal (no streaming, no
session persistence).

---

## 5. Consent contract schema

```python
consent_id: UUID (PK)
user_id: str
merchant_id: str
spend_limit: Decimal
spend_used: Decimal (default 0)
per_txn_max: Decimal
scope: list[str]              # e.g. ["groceries", "food"]
expiry: datetime              # UTC
status: Enum["active","expired","revoked","exhausted"]
integrity_hash: str           # hex HMAC-SHA256 over the contract's
                               # immutable fields, sorted-key canonical JSON
created_at: datetime
revoked_at: datetime | None
```

Real example (`POST /consent` response):
```json
{"consent_id": "c_3f9a2e...", "user_id": "u_123", "merchant_id": "m_groceries_01",
 "spend_limit": 2000.00, "spend_used": 0.00, "per_txn_max": 500.00,
 "scope": ["groceries"], "expiry": "2026-09-03T00:00:00Z",
 "status": "active", "integrity_hash": "a3f9c1e0b8...",
 "created_at": "2026-08-27T00:00:00Z", "revoked_at": null}
```

`check_consent()` is a pure function checking, in order: existence →
integrity hash → status (revoked/exhausted) → expiry → SKU validity and
scope match → per-transaction cap → remaining balance. A tampered stored
field fails the integrity check and hard-denies with
`integrity_violation` — it is never silently corrected.

---

## 6. Agent reasoning flow

```
 user message
      │
      ▼
 ┌──────────┐   tool_calls?  ┌────────────────────────┐
 │  agent    │───────yes────▶│ ToolNode                │
 │ (ReAct)   │                │ check_consent_tool      │
 │           │◀───tool result─│ execute_transaction_tool│
 └────┬──────┘                │ get_status_tool         │
      │no tool_calls          └────────────────────────┘
      ▼
 final response
```

Max 3 tool-call iterations (`MAX_ITERATIONS=3`). On what would be a 4th
round, the graph forces a final plain-text response summarizing what was
attempted — any tool calls the model tries to sneak into that forced turn
are stripped before the message is emitted, so the hard stop is a property
of the graph, not of the model's cooperation.

**The tools do no money logic themselves.** `check_consent_tool` and
`execute_transaction_tool` call straight into `app.consent.check_consent`
and `app.executor.TransactionExecutor.execute` — the exact same functions
the plain REST API uses. If the model never calls a tool, or claims a
purchase succeeded without a tool result saying so, there is simply no
transaction and no consent mutation. Every `check_consent_tool` call also
writes its own `consent_check` audit row (Phase 3's rule: if a consent
check happened, there is a log row), independent of whatever the executor
logs a moment later — an agent asking "is this allowed?" and the executor
re-verifying it under a row lock are two distinct, both-real events.

---

## 7. Protocol narrative

`ConsentContract` is deliberately shaped to be a recognizable stand-in for
an NPCI UAP-style mandate: `spend_limit` and `per_txn_max` map to the
mandate's authorized amount fields, `expiry` maps to mandate validity, and
`scope` maps to a purpose code restricting what the mandate can be used
for — while `check_consent()` and `execute_transaction()` mirror MCP
tool-call semantics (a structured, typed, allow/deny-decided call rather
than free-form agent prose), which is exactly how the buyer agent invokes
them in Phase 5. AgentGate doesn't implement NPCI's UAP or MCP directly —
that's a real protocol integration effort, not a buildathon-week task —
but the data model and call shape are chosen so that swapping in a real
mandate issuer or a real MCP transport later is a mapping exercise, not a
redesign.

---

## 8. Running it

### Quick start (Docker Compose)

```bash
git clone <this-repo>
cd agentgate
cp .env.example .env
# fill in real RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
# and GROQ_API_KEY if you want to exercise the buyer agent
docker compose up --build
```
- API: `http://localhost:8000`
- Dashboard: `http://localhost:3000`

`db`, `api`, and `web` are three services; `api` waits on Postgres's
`pg_isready` healthcheck, `web` waits on `api`. Nothing is mounted as a
dev volume — this is a demo build, not a hot-reload dev setup.

### Local dev (without Docker)

```bash
# backend
cd backend
cp .env.example .env   # edit with real keys
pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload

# frontend, in a second terminal
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

You'll need `NEXT_PUBLIC_RAZORPAY_KEY_ID` in `frontend/.env.local` for
local Next.js dev. If you run through Docker Compose, the web image gets
that public key from the root `.env` at build time.

For pure webhook testing, Razorpay's servers must be able to reach
`/webhooks/razorpay` (e.g. `ngrok` during local dev), and that URL plus
the webhook secret must be registered in the Razorpay dashboard. The
dashboard also has a verified `/transaction/confirm` fallback: after
Checkout.js returns success, the browser sends Razorpay's signed
`order_id/payment_id/signature` tuple to the API, and the API verifies it
server-side before marking the transaction captured. This keeps local dev
usable when no public webhook tunnel is configured.

---

## 9. Testing

```bash
cd backend
pip install -r requirements.txt --break-system-packages
python -m pytest tests/ -v
```

34 tests across `test_audit.py`, `test_executor.py`, `test_webhooks.py`,
`test_failure_path.py`, `test_revocation.py`, and `test_agent.py`. The
`mock_razorpay` fixture in `tests/conftest.py` patches exactly the network
boundary (`app.executor.get_client` / `app.executor.create_order`) —
row locking, audit logging, idempotency, and webhook signature
verification all run for real, unmocked.

### Happy path
```bash
curl -X POST localhost:8000/consent -H 'content-type: application/json' -d '{
  "user_id": "u_1", "merchant_id": "m_groceries_01",
  "spend_limit": 2000, "per_txn_max": 500,
  "scope": ["groceries"], "expiry_days": 7}'
# take the returned consent_id, then:
curl -X POST localhost:8000/transaction/execute -H 'content-type: application/json' -d '{
  "consent_id": "<id>", "amount": 450, "sku_category": "groceries",
  "idempotency_key": "demo-1"}'
```

### Bounded rejection (per-txn cap)
Same consent, `"amount": 600` → `status: "denied"`,
`"reason": "per_txn_max_exceeded"`, even with budget remaining.

### Race-condition test (A.6)
Requires the API running with `DEMO_MODE=false`.
```bash
python backend/scripts/race_test.py --base-url http://localhost:8000
```
Fires two concurrent `execute_transaction` requests that together exceed
remaining balance; asserts exactly one is accepted, one is denied with
`insufficient_remaining_balance`, and `race_condition_detected` is logged.
Runs 3x by default.

### Failure path
Force a real failure in Razorpay's test-mode checkout by choosing
**Failure** on the mock bank page, or by using one of Razorpay's
documented error-simulation test cards (check
`razorpay.com/docs/payments/payments/test-card-details/` at build/run
time — these change). `FailureHandler` then: retries once after
`FAILURE_RETRY_DELAY_SECONDS` → on a second failure, marks the
transaction terminal, logs a simulated merchant notification, and hard
stops — a 3rd attempt is provably never created, even if the handler is
invoked again on an already-terminal transaction
(`test_failure_path.py::test_hard_stop_is_provably_enforced_no_third_attempt_even_if_handle_called_again`).

### Revocation-mid-transaction demo (the "wow" moment)
Requires the API running with `DEMO_MODE=true`.
```bash
python backend/scripts/revocation_demo.py --base-url http://localhost:8000 --runs 3
```
Kicks off `execute_transaction` with `simulate_delay_ms=3000` on a
background thread; 1 second in, revokes the same consent from a second,
genuinely separate HTTP request; the executor's post-delay re-check sees
`revoked_mid_transaction` and aborts *before* calling Razorpay. Audit
trail shows `consent_check` (approved) → `revocation_processed` →
`consent_check` (denied) → no `order_created` row. Runs 3x by default to
rule out a timing fluke.

**Remember:** flip `DEMO_MODE` back to `false` before running the
race-condition test or recording the happy-path/failure-path parts of the
pitch video — `simulate_delay_ms` must never be honored outside a demo.

---

## 10. Future work

Deliberately **not** built, and deliberately not folded into the four
things above:

- **Velocity / rate limiting** — a real idea (cap requests per minute,
  not just per rupee), just not this build's job.
- **Circuit breakers / timeout degradation** — graceful backend
  degradation under load; orthogonal to consent and trust.
- **Multi-merchant catalog federation** — AgentGate authorizes spend
  against *a* merchant; it doesn't decide *which* merchant.
- **Bundle negotiation / multi-agent buyer-vs-merchant negotiation** —
  a different, harder problem (mechanism design, not consent
  enforcement) that would have diluted the depth of the core bet.
- **A real NPCI UAP / MCP transport implementation** — see the protocol
  narrative above; the data model is shaped to make this a mapping
  exercise later, not attempted here.

---

## 11. Repo layout

See `backend/app/*.py` for one module per concern (`consent.py`,
`executor.py`, `failure.py`, `audit.py`, `webhooks.py`, `agent.py`,
`razorpay_client.py`), `backend/scripts/` for the three demo/test
scripts (`revocation_demo.py`, `race_test.py`, `agent_demo.py`),
`backend/tests/` for the pytest suite, and `frontend/app/` for the two
dashboard pages.

`.env` is git-ignored everywhere in this repo — `.env.example` (root, for
Docker Compose) and `backend/.env.example` / `frontend/.env.local.example`
(for local dev) contain placeholder values only. Never commit real
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AGENTGATE_HMAC_SECRET`,
`GROQ_API_KEY`, or a real `DATABASE_URL`.
