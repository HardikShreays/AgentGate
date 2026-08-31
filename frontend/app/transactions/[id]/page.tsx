"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getAuditTrail, getConsent } from "@/lib/api";
import { ApiError, AuditLogEntry, ConsentStatus } from "@/lib/types";
import { TopBar } from "@/components/TopBar";
import { Timeline } from "@/components/Timeline";

export default function TransactionTimelinePage() {
  const params = useParams<{ id: string }>();
  const consentId = decodeURIComponent(params.id);

  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [status, setStatus] = useState<ConsentStatus | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // P2-1 — live polling so a revocation or transaction fired elsewhere
  // (the demo panels, another tab, the buyer agent) shows up here
  // without a manual refresh click.
  const [live, setLive] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, [consentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 2.5s while "Live" is on and the tab is focused.
  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (!live) return;
    pollTimer.current = setInterval(() => {
      if (document.hidden) return;
      load(true);
    }, 2500);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [live, load]);

  return (
    <>
      <TopBar
        consentId={consentId}
        status={status}
        page="transactions"
        onRefresh={load}
        live={live}
        onLiveChange={setLive}
      />

      <div className="mx-auto max-w-4xl px-8 py-8">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && entries && entries.length === 0 && <EmptyState />}
        {!loading && !error && entries && entries.length > 0 && <Timeline entries={entries} />}
      </div>
    </>
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
