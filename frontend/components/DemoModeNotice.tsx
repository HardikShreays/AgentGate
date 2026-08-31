"use client";

import { useEffect, useState } from "react";
import { getDemoMode, setDemoMode } from "@/lib/api";
import { ApiError } from "@/lib/types";

export function DemoModeNotice({ mode }: { mode: "true" | "false" }) {
  const expected = mode === "true";
  const [actual, setActual] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await getDemoMode();
      setActual(response.enabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not read demo mode.");
    } finally {
      setLoading(false);
    }
  }

  async function applyExpected() {
    setUpdating(true);
    setError(null);
    try {
      const response = await setDemoMode(expected);
      setActual(response.enabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update demo mode.");
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const matches = actual === expected;
  const tone =
    actual == null || loading
      ? "border-border bg-surfaceMuted text-muted"
      : matches
        ? "border-success/25 bg-successTint text-success"
        : "border-warning/30 bg-warningTint text-warning";

  return (
    <div className={`rounded-lg border p-4 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-label">
            Requires DEMO_MODE={mode}
          </div>
          <p className="mt-1 leading-relaxed">
            {loading
              ? "Checking the API setting..."
              : error
                ? error
                : actual == null
                  ? "Could not confirm the current API setting."
                  : matches
                    ? "The API is set for this demo."
                    : `The API currently reports DEMO_MODE=${String(actual)}; switch it before running this demo.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading || updating}
            className="rounded-sm border border-current/25 bg-white/60 px-3 py-1.5 text-xs font-medium transition hover:bg-white disabled:opacity-50"
          >
            Recheck
          </button>
          {!matches && (
            <button
              type="button"
              onClick={applyExpected}
              disabled={loading || updating}
              className="rounded-sm bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
            >
              {updating ? "Switching..." : `Set ${mode}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DemoModeMismatch({ mode }: { mode: "true" | "false" }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warningTint p-4 text-sm text-warning">
      <div className="text-[11px] font-semibold uppercase tracking-label">
        DEMO_MODE looks wrong
      </div>
      <p className="mt-1.5 leading-relaxed">
        This result created an order where the demo expects a guarded abort. Set the API to
        DEMO_MODE={mode}, then run it again.
      </p>
    </div>
  );
}
