"use client";

import { useState } from "react";
import { createConsent, executeTransaction, getAuditTrail } from "@/lib/api";
import { ApiError, AuditLogEntry, ExecuteTransactionResponse } from "@/lib/types";
import { truncateMiddle } from "@/lib/format";
import { Timeline } from "@/components/Timeline";
import { DemoModeNotice } from "@/components/DemoModeNotice";
import { RaceResultCards } from "@/components/RaceResultCards";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/PageHeader";

// spend_limit === per_txn_max so the *remaining balance* is the binding
// constraint being tested, not the per-transaction cap — matches
// backend/scripts/race_test.py and the pitch script exactly.
const CONSENT_DEFAULTS = {
  user_id: "u_123",
  merchant_id: "m_groceries_01",
  spend_limit: "500",
  per_txn_max: "500",
  scope: ["groceries"],
  expiry_days: 7,
};
const RACE_AMOUNT = "300"; // two of these (₹600) exceed the ₹500 remaining balance

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

interface RunResult {
  consentId: string;
  results: [ExecuteTransactionResponse, ExecuteTransactionResponse];
  entries: AuditLogEntry[];
  ok: boolean;
  anomaly: "both_accepted" | "both_denied" | null;
}

// Client-side rewrite of backend/scripts/race_test.py: two concurrent
// requests against the same fresh consent, amounts that together exceed
// the remaining balance, distinct idempotency keys. Promise.all firing
// both fetch() calls in the same tick won't match a threading.Barrier's
// nanosecond precision, but it exercises the same server-side
// SELECT ... FOR UPDATE path — that's the thing being proven.
async function runOnce(): Promise<RunResult> {
  const consent = await createConsent(CONSENT_DEFAULTS);
  const consentId = consent.consent_id;

  const [settledA, settledB] = await Promise.allSettled([
    executeTransaction({
      consent_id: consentId,
      amount: RACE_AMOUNT,
      sku_category: consent.scope[0] ?? "groceries",
      idempotency_key: newIdempotencyKey(),
    }),
    executeTransaction({
      consent_id: consentId,
      amount: RACE_AMOUNT,
      sku_category: consent.scope[0] ?? "groceries",
      idempotency_key: newIdempotencyKey(),
    }),
  ]);

  if (settledA.status === "rejected") throw settledA.reason;
  if (settledB.status === "rejected") throw settledB.reason;
  const results: [ExecuteTransactionResponse, ExecuteTransactionResponse] = [
    settledA.value,
    settledB.value,
  ];

  const trail = await getAuditTrail(consentId);
  const entries = trail.entries;

  const acceptedCount = results.filter((r) => r.status !== "denied").length;
  const deniedForBalance = results.filter(
    (r) => r.status === "denied" && r.reason === "insufficient_remaining_balance"
  ).length;

  const anomaly = acceptedCount === 2 ? "both_accepted" : acceptedCount === 0 ? "both_denied" : null;
  const ok = acceptedCount === 1 && deniedForBalance === 1;

  return { consentId, results, entries, ok, anomaly };
}

export default function RaceDemoPage() {
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
      const result = await runOnce();
      setLastRun(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
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
        const result = await runOnce();
        results.push(result);
        setRunHistory([...results]);
        setLastRun(result);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <PageHeader title="Race two transactions against one budget">
        Fires two concurrent transactions against a fresh ₹500 consent, ₹300 each — together
        they exceed the remaining balance. The row lock (
        <code className="font-mono text-[12px]">SELECT … FOR UPDATE</code>) serializes them:
        exactly one is accepted, the other is denied with{" "}
        <code className="font-mono text-[12px]">insufficient_remaining_balance</code>, and
        spend never exceeds the limit.
      </PageHeader>

      <div className="space-y-4">
        <DemoModeNotice mode="false" />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
          >
            Run race-condition test
          </button>
          <button
            type="button"
            onClick={handleRun3x}
            disabled={running}
            className="rounded-sm border border-border bg-surface px-4 py-2.5 text-sm font-medium text-navySoft transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
          >
            Run 3×
          </button>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Firing both requests…
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

            {lastRun.anomaly && (
              <div className="rounded-lg border border-danger/30 bg-dangerTint p-4 text-sm text-danger">
                <div className="text-[11px] font-semibold uppercase tracking-label">
                  {lastRun.anomaly === "both_accepted"
                    ? "Failure: both requests were accepted"
                    : "Failure: both requests were denied"}
                </div>
                <p className="mt-1.5 leading-relaxed">
                  {lastRun.anomaly === "both_accepted"
                    ? "The row lock should have serialized these — this would mean a double-spend got through."
                    : "Something denied both sides, which the balance shouldn't require — worth investigating rather than silently re-running."}
                </p>
              </div>
            )}

            <RaceResultCards results={lastRun.results} />

            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
                Audit trail — GET /audit/{"{consent_id}"}
              </div>
              <Timeline
                entries={lastRun.entries}
                stagger
                highlightActionType="race_condition_detected"
              />
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
          3× summary — no double-spend across repeated runs
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
              r.ok
                ? "border-success/25 bg-successTint text-success"
                : "border-danger/30 bg-dangerTint text-danger"
            }`}
          >
            <span className="font-semibold">
              #{i + 1} {r.ok ? "✓" : "✕"}
            </span>
            <span className="font-mono text-faint">{truncateMiddle(r.consentId, 8, 6)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
