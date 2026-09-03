"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getTransactionStatus } from "@/lib/api";
import { ApiError, TransactionStatusResponse } from "@/lib/types";
import { formatInr } from "@/lib/format";
import { TransactionStatusCard } from "@/components/TransactionStatusStepper";
import { JsonPanel } from "@/components/JsonPanel";
import { CopyButton } from "@/components/CopyButton";

// P1-3 — `GET /transaction/{id}/status` was fully built on the backend
// and unused by the frontend until now. This is the transaction-level
// view of the "one bounded retry, then hard stop" claim from the
// failure-path segment, rather than reconstructing it from the
// consent-scoped audit trail at /transactions/[consentId]. Fed from
// P0-2's post-checkout "View full attempt history" link, so it doesn't
// need to be discovered any other way.
export default function TransactionStatusPage() {
  const params = useParams<{ id: string }>();
  const transactionId = decodeURIComponent(params.id);

  const [status, setStatus] = useState<TransactionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getTransactionStatus(transactionId);
      setStatus(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setStatus(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    load();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [load]);

  // While the transaction is still "pending" (a bounded retry may still
  // be in flight), quietly re-poll every 2s so the stepper fills in
  // without a manual click — same P2-style live-polling idea, scoped to
  // just this page since it's the one place a user would sit and watch.
  useEffect(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (!autoRefresh || !status || status.status !== "pending") return;
    pollTimer.current = setTimeout(() => load(true), 2000);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [autoRefresh, status, load]);

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-surface/85 px-8 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-faint">Transaction</div>
            <h1 className="mt-1 flex min-w-0 items-center gap-1 truncate font-mono text-sm text-navySoft">
              <span className="truncate" title={transactionId}>
                {transactionId}
              </span>
              <CopyButton value={transactionId} label="Transaction ID" />
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-brand"
              />
              Live
            </label>
            <button
              onClick={() => load()}
              className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-8 py-8">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && status && <Loaded status={status} />}
      </div>
    </>
  );
}

function Loaded({ status }: { status: TransactionStatusResponse }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-[13px]">
        <Link
          href={`/consent/${encodeURIComponent(status.consent_id)}`}
          className="rounded-sm px-2.5 py-1 font-medium text-faint transition hover:text-navySoft"
        >
          ← Consent Inspector
        </Link>
        <Link
          href={`/transactions/${encodeURIComponent(status.consent_id)}`}
          className="rounded-sm px-2.5 py-1 font-medium text-faint transition hover:text-navySoft"
        >
          Consent-level Timeline
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Amount" value={formatInr(status.amount)} accent />
        <StatCard label="SKU category" value={status.sku_category} />
        <StatCard label="Attempts" value={`${status.attempt_count}/${status.max_attempts}`} />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
          Attempt-by-attempt
        </div>
        <TransactionStatusCard status={status} polling={status.status === "pending"} />
      </div>

      <JsonPanel data={status} label="Raw JSON — GET /transaction/{id}/status" />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-label text-faint">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm ${accent ? "text-brand" : "text-navy"}`}>
        {value}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-16 rounded-lg border border-border bg-surface" />
      <div className="h-32 rounded-lg border border-border bg-surface" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-dangerTint p-6 text-center">
      <div className="text-sm font-medium text-danger">Couldn't load this transaction</div>
      <p className="mt-1.5 text-xs text-muted">{message}</p>
    </div>
  );
}
