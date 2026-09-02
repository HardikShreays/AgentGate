"use client";

import { useState } from "react";
import {
  createConsent,
  executeTransaction,
  getAuditTrail,
  simulateFailure,
} from "@/lib/api";
import { ApiError, AuditLogEntry, TransactionStatusResponse } from "@/lib/types";
import { truncateMiddle } from "@/lib/format";
import { Timeline } from "@/components/Timeline";
import { TransactionStatusCard } from "@/components/TransactionStatusStepper";
import { DemoModeNotice } from "@/components/DemoModeNotice";
import { CopyButton } from "@/components/CopyButton";

// Same happy-path numbers as CreateConsentForm / the revocation demo, so a
// cross-check against the README lines up.
const CONSENT_DEFAULTS = {
  user_id: "u_123",
  merchant_id: "m_groceries_01",
  spend_limit: "2000",
  per_txn_max: "500",
  scope: ["groceries"],
  expiry_days: 7,
};
const DEMO_SKU = "sku_rice_5kg";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

interface RunResult {
  consentId: string;
  transactionId: string;
  afterRetry: TransactionStatusResponse;
  afterHardStop: TransactionStatusResponse;
  afterThirdCall: TransactionStatusResponse;
  entries: AuditLogEntry[];
  ok: boolean;
}

// FailureHandler on the backend does the real work: this page only drives
// POST /demo/simulate-failure, which invokes the SAME handler app.webhooks
// calls on a verified payment.failed event — one bounded retry, then a hard
// stop and a merchant notification, and provably no third Razorpay order.
async function runOnce(setPhase: (p: string | null) => void): Promise<RunResult> {
  setPhase("Issuing a fresh consent contract…");
  const consent = await createConsent(CONSENT_DEFAULTS);

  setPhase("Executing a transaction (creates Razorpay order, attempt 1)…");
  const exec = await executeTransaction({
    consent_id: consent.consent_id,
    sku: DEMO_SKU,
    idempotency_key: newIdempotencyKey(),
  });
  if (!exec.transaction_id) {
    throw new ApiError(`Execute did not create a transaction: ${exec.reasoning}`, 0);
  }

  setPhase("Simulating payment.failed on attempt 1 — bounded retry runs…");
  const afterRetry = await simulateFailure({ transaction_id: exec.transaction_id });

  setPhase("Simulating payment.failed on attempt 2 — hard stop + merchant notified…");
  const afterHardStop = await simulateFailure({ transaction_id: exec.transaction_id });

  setPhase("Calling simulate-failure a third time — must be a no-op…");
  const afterThirdCall = await simulateFailure({ transaction_id: exec.transaction_id });

  const trail = await getAuditTrail(consent.consent_id);

  const orderCount = trail.entries.filter(
    (e) => e.action_type === "order_created" || e.action_type === "retry_attempted"
  ).length;
  const ok =
    afterHardStop.status === "failed" &&
    afterHardStop.attempt_count === 2 &&
    afterThirdCall.status === "failed" &&
    afterThirdCall.attempt_count === 2 &&
    orderCount === 2 &&
    trail.entries.some((e) => e.action_type === "merchant_notified");

  setPhase(null);
  return {
    consentId: consent.consent_id,
    transactionId: exec.transaction_id,
    afterRetry,
    afterHardStop,
    afterThirdCall,
    entries: trail.entries,
    ok,
  };
}

export default function FailureDemoPage() {
  const [phase, setPhase] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setLastRun(null);
    try {
      setLastRun(await runOnce(setPhase));
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
          Pitch script · 4:30–5:00 · "one failure handled gracefully"
        </div>
        <h1 className="mt-1 text-xl font-semibold text-navy">Live failure-path demo</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
          Forces a real <code className="font-mono">payment.failed</code> through the same
          FailureHandler a Razorpay webhook would hit. One bounded retry after a real delay,
          then on the second failure the transaction is marked terminal, a merchant
          notification is logged, and a third attempt is provably never created — calling the
          trigger again changes nothing.
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
            Run failure-path demo
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

        {lastRun && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surfaceMuted p-4">
              <div className="text-[11px] font-medium uppercase tracking-label text-faint">
                Transaction
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-sm text-navy">
                <span className="truncate" title={lastRun.transactionId}>
                  {truncateMiddle(lastRun.transactionId, 12, 8)}
                </span>
                <CopyButton value={lastRun.transactionId} label="Transaction ID" />
              </div>
            </div>

            <div
              className={`rounded-lg border p-4 text-sm ${
                lastRun.ok
                  ? "border-danger/30 bg-dangerTint text-danger"
                  : "border-warning/30 bg-warningTint text-warning"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-label">
                {lastRun.ok
                  ? "Terminal after one retry — no third attempt"
                  : "Unexpected result — check DEMO_MODE and the audit trail"}
              </div>
              <p className="mt-1.5 font-mono text-xs opacity-80">
                after retry: {lastRun.afterRetry.status} ({lastRun.afterRetry.attempt_count}/
                {lastRun.afterRetry.max_attempts}) · after hard stop: {lastRun.afterHardStop.status} (
                {lastRun.afterHardStop.attempt_count}/{lastRun.afterHardStop.max_attempts}) · third
                call: {lastRun.afterThirdCall.status} ({lastRun.afterThirdCall.attempt_count}/
                {lastRun.afterThirdCall.max_attempts})
              </p>
            </div>

            <TransactionStatusCard status={lastRun.afterThirdCall} polling={false} />

            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
                Audit trail — GET /audit/{"{consent_id}"}
              </div>
              <Timeline
                entries={lastRun.entries}
                stagger
                highlightActionType="merchant_notified"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
