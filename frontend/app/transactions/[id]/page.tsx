"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAuditTrail, getConsent } from "@/lib/api";
import { ApiError, AuditLogEntry, ConsentStatus } from "@/lib/types";
import { formatDateTime, formatTime } from "@/lib/format";
import { colorForEntry, COLOR_CLASSES, ACTION_LABELS, TimelineColor } from "@/lib/auditColor";
import { TopBar } from "@/components/TopBar";
import { JsonPanel } from "@/components/JsonPanel";

const LEGEND: { color: TimelineColor; label: string }[] = [
  { color: "success", label: "Success" },
  { color: "retry", label: "Retry" },
  { color: "danger", label: "Failed / notified" },
  { color: "revoked", label: "Revoked mid-transaction" },
];

export default function TransactionTimelinePage() {
  const params = useParams<{ id: string }>();
  const consentId = decodeURIComponent(params.id);

  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [status, setStatus] = useState<ConsentStatus | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trail, consent] = await Promise.all([
        getAuditTrail(consentId),
        getConsent(consentId).catch(() => null),
      ]);
      setEntries(trail.entries);
      setStatus(consent?.status);
      window.localStorage.setItem("agentgate:last_consent_id", consentId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setEntries(null);
    } finally {
      setLoading(false);
    }
  }, [consentId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <TopBar consentId={consentId} status={status} page="transactions" onRefresh={load} />

      <div className="mx-auto max-w-4xl px-8 py-8">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && entries && entries.length === 0 && <EmptyState />}
        {!loading && !error && entries && entries.length > 0 && <Timeline entries={entries} />}
      </div>
    </>
  );
}

function Timeline({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surfaceMuted px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-label text-faint">Legend</span>
        {LEGEND.map(({ color, label }) => (
          <span key={color} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-2 w-2 rounded-full ${COLOR_CLASSES[color].dot}`} />
            {label}
          </span>
        ))}
        <span className="ml-auto font-mono text-xs text-faint">{entries.length} entries</span>
      </div>

      <ol className="relative space-y-3 border-l border-border pl-6">
        {entries.map((entry, i) => (
          <TimelineRow key={entry.log_id} entry={entry} index={i + 1} />
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({ entry, index }: { entry: AuditLogEntry; index: number }) {
  const color = colorForEntry(entry);
  const classes = COLOR_CLASSES[color];

  return (
    <li className="relative">
      <span
        className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-canvas ${classes.dot}`}
      />
      <div className={`rounded-lg border bg-surface p-4 shadow-card ${classes.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-faint tabular">
              {String(index).padStart(3, "0")}
            </span>
            <span className={`text-xs font-semibold uppercase tracking-label ${classes.text}`}>
              {ACTION_LABELS[entry.action_type] ?? entry.action_type}
            </span>
          </div>
          <span className="font-mono text-xs text-faint tabular" title={formatDateTime(entry.timestamp)}>
            {formatTime(entry.timestamp)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-navy">{entry.reasoning}</p>
        <div className="mt-3">
          <JsonPanel data={entry.structured_payload} label="Structured payload" />
        </div>
      </div>
    </li>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-lg border border-border bg-surface" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-dangerTint p-6 text-center">
      <div className="text-sm font-medium text-danger">Couldn't load this transaction timeline</div>
      <p className="mt-1.5 text-xs text-muted">{message}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
      <div className="text-sm font-medium text-navy">Nothing logged yet</div>
      <p className="mt-1.5 text-xs text-muted">
        This consent exists but no consent checks or transactions have touched it. Try
        executing a transaction against it first.
      </p>
    </div>
  );
}
