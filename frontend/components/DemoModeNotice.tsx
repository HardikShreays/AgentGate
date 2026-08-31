"use client";

import { useEffect, useState } from "react";
import { getDemoMode, setDemoMode } from "@/lib/api";
import { ApiError } from "@/lib/types";

export function DemoModeNotice({ mode }: { mode: "true" | "false" }) {
  const desired = mode === "true";
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await getDemoMode();
      setEnabled(res.enabled);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not read demo mode.");
    }
  }

  async function applyDesiredMode() {
    setSaving(true);
    setError(null);
    try {
      const res = await setDemoMode(desired);
      setEnabled(res.enabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update demo mode.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const matches = enabled === desired;

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-xs leading-relaxed ${
        matches ? "border-success/25 bg-successTint text-navy" : "border-warning/30 bg-warningTint text-navy"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className={`font-semibold uppercase tracking-label ${matches ? "text-success" : "text-warning"}`}>
            DEMO_MODE should be {mode}
          </span>
          {" — "}
          current API value:{" "}
          <code className="font-mono">
            {enabled == null ? "checking…" : String(enabled)}
          </code>
        </div>
        <button
          type="button"
          onClick={applyDesiredMode}
          disabled={saving || matches}
          className="rounded-sm border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-navySoft transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
        >
          {saving ? "Switching…" : desired ? "Enable revocation demo mode" : "Switch demo mode off"}
        </button>
      </div>
      <p className="mt-2">
        {mode === "true" ? (
          <>
            Enables <code className="font-mono">simulate_delay_ms</code> for this revocation demo.
            Switch it off before running the race demo or recording the happy path.
          </>
        ) : (
          <>
            Keeps the API in normal mode. The race demo does not need{" "}
            <code className="font-mono">simulate_delay_ms</code>.
          </>
        )}
      </p>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}

// Rendered instead of a clean pass/fail when a run's outcome is only
// explainable by DEMO_MODE being set the wrong way — a real Razorpay
// order appearing where a clean denial was expected, or vice versa.
export function DemoModeMismatch({ mode }: { mode: "true" | "false" }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-dangerTint p-4 text-sm text-danger">
      <div className="text-[11px] font-semibold uppercase tracking-label">
        DEMO_MODE does not match this demo
      </div>
      <p className="mt-1.5 leading-relaxed">
        This run&apos;s result only makes sense if the API isn&apos;t currently running with{" "}
        <code className="font-mono">DEMO_MODE={mode}</code>. Use the switch above and try again.
      </p>
    </div>
  );
}
