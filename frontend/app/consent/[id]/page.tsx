"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getConsent, revokeConsent } from "@/lib/api";
import { ApiError, ConsentResponse } from "@/lib/types";
import { formatInr, formatDateTime, relativeExpiry } from "@/lib/format";
import { summarizeConsent } from "@/lib/summary";
import { TopBar } from "@/components/TopBar";
import { JsonPanel } from "@/components/JsonPanel";
import { StatCard, SpendMeter, ScopeTags, IntegrityStrip } from "@/components/ConsentWidgets";
import { ExecuteTransactionPanel } from "@/components/ExecuteTransactionPanel";

export default function ConsentInspectorPage() {
  const params = useParams<{ id: string }>();
  const consentId = decodeURIComponent(params.id);

  const [consent, setConsent] = useState<ConsentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  // P2-1 — live polling so a revocation fired elsewhere (the demo panel,
  // another tab, the buyer agent) shows up here without a manual click.
  const [live, setLive] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getConsent(consentId);
      setConsent(data);
      window.localStorage.setItem("agentgate:last_consent_id", consentId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setConsent(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [consentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 2.5s while "Live" is on and the tab is focused. Skipped
  // silently (no spinner) so it doesn't interrupt reading the page.
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

  async function handleRevoke() {
    if (!confirm(`Revoke consent ${consentId}? This cannot be undone.`)) return;
    setRevoking(true);
    try {
      await revokeConsent(consentId);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Revoke failed.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <TopBar
        consentId={consentId}
        status={consent?.status}
        page="consent"
        onRefresh={load}
        onRevoke={handleRevoke}
        revoking={revoking}
        live={live}
        onLiveChange={setLive}
      />

      <div className="mx-auto max-w-4xl px-8 py-8">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && consent && <Loaded consent={consent} />}
      </div>
    </>
  );
}

function Loaded({ consent }: { consent: ConsentResponse }) {
  const spendLimit = parseFloat(consent.spend_limit);
  const spendUsed = parseFloat(consent.spend_used);
  const spendReserved = parseFloat(consent.spend_reserved ?? "0");
  const expiry = relativeExpiry(consent.expiry);

  return (
    <div className="space-y-6">
      {/* One-line human summary — the 30-second read */}
      <div className="rounded-lg border border-border bg-surfaceMuted p-4">
        <div className="text-[11px] font-medium uppercase tracking-label text-faint">Summary</div>
        <p className="mt-1.5 text-sm leading-relaxed text-navy">{summarizeConsent(consent)}</p>
      </div>

      {!consent.integrity_valid && (
        <div className="rounded-lg border border-danger/30 bg-dangerTint p-4 text-sm text-danger">
          This contract's stored hash no longer matches its recomputed hash. One or more
          fields were altered outside the normal write path. Treat every figure below as
          untrustworthy until this is investigated.
        </div>
      )}

      <IntegrityStrip hash={consent.integrity_hash} valid={consent.integrity_valid} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Spend limit" value={formatInr(consent.spend_limit)} accent />
        <StatCard label="Per-txn cap" value={formatInr(consent.per_txn_max)} />
        <StatCard label="User" value={consent.user_id} />
        <StatCard label="Merchant" value={consent.merchant_id} />
      </div>

      <SpendMeter
        used={spendUsed}
        limit={spendLimit}
        reserved={spendReserved}
        remaining={spendLimit - spendUsed - spendReserved}
      />

      <ExecuteTransactionPanel consentId={consent.consent_id} defaultSkuCategory={consent.scope[0]} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="text-[11px] font-medium uppercase tracking-label text-faint">Scope</div>
          <div className="mt-2">
            <ScopeTags scope={consent.scope} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="text-[11px] font-medium uppercase tracking-label text-faint">Expiry</div>
          <div className="mt-1.5 font-mono text-sm text-navy">{formatDateTime(consent.expiry)}</div>
          <div className={`mt-0.5 text-xs ${expiry.expired ? "text-danger" : "text-muted"}`}>
            {expiry.label}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Created" value={formatDateTime(consent.created_at)} />
        <StatCard
          label="Revoked"
          value={consent.revoked_at ? formatDateTime(consent.revoked_at) : "—"}
        />
      </div>

      <JsonPanel data={consent} label="Raw JSON — GET /consent/{id}" />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-16 rounded-lg border border-border bg-surface" />
      <div className="h-14 rounded-lg border border-border bg-surface" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-dangerTint p-6 text-center">
      <div className="text-sm font-medium text-danger">Couldn't load this consent</div>
      <p className="mt-1.5 text-xs text-muted">{message}</p>
    </div>
  );
}
