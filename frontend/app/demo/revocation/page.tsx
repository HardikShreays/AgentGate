"use client";

import { useState } from "react";
import { createConsent, executeTransaction, revokeConsent, getAuditTrail } from "@/lib/api";
import { ApiError, AuditLogEntry, ExecuteTransactionResponse } from "@/lib/types";
import { truncateMiddle } from "@/lib/format";
import { Timeline } from "@/components/Timeline";
import { DemoModeNotice, DemoModeMismatch } from "@/components/DemoModeNotice";
import { CopyButton } from "@/components/CopyButton";

// Same values CreateConsentForm ships with, so this run lines up with the
// README's happy-path numbers if someone cross-checks it live.
const CONSENT_DEFAULTS = {
  user_id: "u_123",
  merchant_id: "m_groceries_01",
  spend_limit: "2000",
  per_txn_max: "500",
  scope: ["groceries"],
  expiry_days: 7,
};
const DEMO_AMOUNT = "450";
const DELAY_MS = 3000;
const REVOKE_AFTER_MS = 1000;

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RunResult {
  consentId: string;
  execResponse: ExecuteTransactionResponse;
  entries: AuditLogEntry[];
  demoModeMismatch: boolean;
  ok: boolean;
}

// Runs the whole sequence once: fresh consent -> execute with a 3s
// simulated delay (not awaited yet) -> revoke fired independently 1s
// later -> read back what the executor actually did. This is a client-
// side rewrite of backend/scripts/revocation_demo.py's two racing
// requests — genuinely equivalent, since it's still two independent
// HTTP requests racing against real server-side state, not a simulation
// of one.
async function runOnce(setPhase: (p: string | null) => void): Promise<RunResult> {
  setPhase("Issuing a fresh consent contract…");
  const consent = await createConsent(CONSENT_DEFAULTS);
  const consentId = consent.consent_id;

  setPhase("Executor has the row lock, re-checking consent…");
  const execPromise = executeTransaction({
    consent_id: consentId,
    amount: DEMO_AMOUNT,
    sku_category: consent.scope[0] ?? "groceries",
    idempotency_key: newIdempotencyKey(),
    simulate_delay_ms: DELAY_MS,
  });

  await sleep(REVOKE_AFTER_MS);
  setPhase("Revoking mid-flight — a second, independent request landing right now…");
  await revokeConsent(consentId);

  setPhase("Waiting for the executor's post-delay re-check…");
  const execResponse = await execPromise;
  setPhase(null);

  const trail = await getAuditTrail(consentId);
  const entries = trail.entries;

  // A real order appearing means the 3s delay wasn't honored at all —
  // the tell for DEMO_MODE being off, not a genuine race outcome.
  const demoModeMismatch = execResponse.status === "pending" && !!execResponse.razorpay_order_id;

  const ok =
    !demoModeMismatch &&
    execResponse.status === "denied" &&
    execResponse.reason === "revoked_mid_transaction" &&
    !entries.some((e) => e.action_type === "order_created");

  return { consentId, execResponse, entries, demoModeMismatch, ok };
}

export default function RevocationDemoPage() {
  const [phase, setPhase] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunResult[] | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setLastRun(null);
    setRunHistory(null);
    try {
      const result = await runOnce(setPhase);
      setLastRun(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setPhase(null);
      setRunning(false);
    }
  }

  async function handleRun3x() {
    setRunning(true);
    setError(null);
    setLastRun(null);
    setRunHistory([]);
    try {
      const results: RunResult[] = [];
      for (let i = 0; i < 3; i++) {
        setPhase(`Run ${i + 1} of 3 — issuing a fresh consent contract…`);
        const result = await runOnce((p) => setPhase(p ? `Run ${i + 1} of 3 — ${p}` : null));
        results.push(result);
        setRunHistory([...results]);
        setLastRun(result);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setPhase(null);
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-6">
        <div className="text-[11px] font-medium uppercase tracking-label text-faint">
          Pitch script · 3:40–4:30
        </div>
        <h1 className="mt-1 text-xl font-semibold text-navy">Live revocation-mid-transaction demo</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
          Starts an execute call with a 3-second simulated delay, then fires an independent revoke
          request 1 second in. The executor's post-delay re-check sees the revoked status and aborts
          before a Razorpay order is ever created — proving the bound is enforced live, not just
          checked once at the start.
        </p>
      </div>

      <div className="space-y-4">
        <DemoModeNotice mode="true" />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
          >
            Run live revocation demo
          </button>
          <button
            type="button"
            onClick={handleRun3x}
            disabled={running}
            className="rounded-sm border border-border bg-surface px-4 py-2.5 text-sm font-medium text-navySoft transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
          >
            Run 3× (rule out a timing fluke)
          </button>
          {phase && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              {phase}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-sm border border-danger/30 bg-dangerTint px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {runHistory && runHistory.length > 0 && <RunHistoryStrip runs={runHistory} />}

        {lastRun && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surfaceMuted p-4">
              <div className="text-[11px] font-medium uppercase tracking-label text-faint">Consent</div>
              <div className="mt-1 flex items-center gap-1 font-mono text-sm text-navy">
                <span className="truncate" title={lastRun.consentId}>
                  {lastRun.consentId}
                </span>
                <CopyButton value={lastRun.consentId} label="Consent ID" />
              </div>
            </div>

            {lastRun.demoModeMismatch ? (
              <DemoModeMismatch mode="true" />
            ) : (
              <div
                className={`rounded-lg border p-4 text-sm ${
                  lastRun.ok
                    ? "border-revoked/30 bg-revokedTint text-revoked"
                    : "border-danger/30 bg-dangerTint text-danger"
                }`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-label">
                  {lastRun.ok ? "Clean abort — no order created" : "Unexpected result"}
                </div>
                <p className="mt-1.5 leading-relaxed">{lastRun.execResponse.reasoning}</p>
                <p className="mt-1 font-mono text-xs opacity-80">
                  status: {lastRun.execResponse.status} · reason: {lastRun.execResponse.reason ?? "—"}
                </p>
              </div>
            )}

            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
                Audit trail — GET /audit/{"{consent_id}"}
              </div>
              <Timeline entries={lastRun.entries} stagger highlightActionType="revocation_processed" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunHistoryStrip({ runs }: { runs: RunResult[] }) {
  const passCount = runs.filter((r) => r.ok).length;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-label text-faint">
          3× summary — not a timing fluke
        </span>
        <span
          className={`font-mono text-xs font-semibold ${
            passCount === runs.length ? "text-success" : "text-danger"
          }`}
        >
          {passCount}/{runs.length} clean
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {runs.map((r, i) => (
          <div
            key={r.consentId}
            className={`flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs ${
              r.demoModeMismatch
                ? "border-warning/30 bg-warningTint text-warning"
                : r.ok
                  ? "border-success/25 bg-successTint text-success"
                  : "border-danger/30 bg-dangerTint text-danger"
            }`}
          >
            <span className="font-semibold">
              #{i + 1} {r.demoModeMismatch ? "⚠" : r.ok ? "✓" : "✕"}
            </span>
            <span className="font-mono text-faint">{truncateMiddle(r.consentId, 8, 6)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
