"use client";

import { FormEvent, useState } from "react";
import { createConsent } from "@/lib/api";
import { ApiError, ConsentResponse } from "@/lib/types";
import { rememberConsentId } from "@/lib/recent";

// P0-1 — replaces `curl -X POST /consent`. Pre-filled with the exact
// values from README §9's "Happy path" so a presenter can hit Create
// with zero typing, but every field stays editable for the bounded-
// rejection / race-demo variants that need different numbers.
const DEFAULTS = {
  user_id: "u_123",
  merchant_id: "m_groceries_01",
  spend_limit: "2000",
  per_txn_max: "500",
  scope: "groceries",
  expiry_days: "7",
};

export function CreateConsentForm({
  onCreated,
  compact,
}: {
  onCreated?: (consent: ConsentResponse) => void;
  compact?: boolean;
}) {
  const [values, setValues] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ConsentResponse | null>(null);

  function set<K extends keyof typeof DEFAULTS>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const consent = await createConsent({
        user_id: values.user_id.trim(),
        merchant_id: values.merchant_id.trim(),
        spend_limit: values.spend_limit,
        per_txn_max: values.per_txn_max,
        scope: values.scope
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        expiry_days: parseInt(values.expiry_days, 10) || 7,
      });
      setCreated(consent);
      rememberConsentId(consent.consent_id);
      onCreated?.(consent);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCreated(null);
    setError(null);
  }

  if (created) {
    return (
      <div className="rounded-lg border border-success/25 bg-successTint p-4">
        <div className="text-[11px] font-medium uppercase tracking-label text-success">
          Consent created
        </div>
        <div className="mt-1.5 truncate font-mono text-sm text-navy" title={created.consent_id}>
          {created.consent_id}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/consent/${encodeURIComponent(created.consent_id)}`}
            className="rounded-sm bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brandDark"
          >
            Open Consent Inspector
          </a>
          <a
            href={`/transactions/${encodeURIComponent(created.consent_id)}`}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
          >
            Open Timeline
          </a>
          <button
            type="button"
            onClick={reset}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-lg border border-border bg-surface shadow-card ${compact ? "p-4" : "p-6"}`}
    >
      {!compact && (
        <div className="mb-4">
          <div className="text-sm font-semibold text-navy">Create a consent contract</div>
          <p className="mt-0.5 text-xs text-muted">
            POST /consent — issues a scoped, expiring spend authorization.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="User ID" value={values.user_id} onChange={(v) => set("user_id", v)} />
        <Field label="Merchant ID" value={values.merchant_id} onChange={(v) => set("merchant_id", v)} />
        <Field
          label="Spend limit (₹)"
          value={values.spend_limit}
          onChange={(v) => set("spend_limit", v)}
          inputMode="decimal"
        />
        <Field
          label="Per-txn cap (₹)"
          value={values.per_txn_max}
          onChange={(v) => set("per_txn_max", v)}
          inputMode="decimal"
        />
        <Field
          label="Scope (comma-separated)"
          value={values.scope}
          onChange={(v) => set("scope", v)}
        />
        <Field
          label="Expiry (days)"
          value={values.expiry_days}
          onChange={(v) => set("expiry_days", v)}
          inputMode="numeric"
        />
      </div>

      {error && (
        <div className="mt-3 rounded-sm border border-danger/30 bg-dangerTint px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-4 w-full rounded-sm bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
      >
        {loading ? "Creating…" : "Create consent"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "text" | "decimal" | "numeric";
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        spellCheck={false}
        required
        className="mt-1.5 w-full rounded-sm border border-border bg-surfaceMuted px-2.5 py-2 font-mono text-sm text-navy placeholder:text-faint focus:border-brand focus:bg-surface"
      />
    </label>
  );
}
