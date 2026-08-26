"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GateMark } from "@/components/Sidebar";

export default function Home() {
  const router = useRouter();
  const [id, setId] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("agentgate:last_consent_id");
    if (stored) setId(stored);
  }, []);

  function go(target: "consent" | "transactions") {
    return (e: FormEvent) => {
      e.preventDefault();
      const trimmed = id.trim();
      if (!trimmed) return;
      window.localStorage.setItem("agentgate:last_consent_id", trimmed);
      router.push(`/${target}/${encodeURIComponent(trimmed)}`);
    };
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <GateMark size={40} />
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-brandTint px-3 py-1 text-[11px] font-semibold uppercase tracking-label text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Live audit
          </div>
          <h1 className="mt-4 text-[26px] font-semibold leading-snug text-navy">
            Every rupee an agent spends,
            <br />
            explained.
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Enter a consent ID to inspect its limits and verify its integrity hash,
            or jump straight to the transaction timeline behind it.
          </p>
        </div>

        <form onSubmit={go("consent")} className="rounded-lg border border-border bg-surface p-6 shadow-card">
          <label htmlFor="home-lookup" className="block text-[11px] font-medium uppercase tracking-label text-faint">
            Consent ID
          </label>
          <input
            id="home-lookup"
            autoFocus
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="c_a1b2c3d4-..."
            spellCheck={false}
            className="mt-2 w-full rounded-sm border border-border bg-surfaceMuted px-3 py-2.5 font-mono text-sm text-navy placeholder:text-faint focus:border-brand focus:bg-surface"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-sm bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark"
            >
              Open Consent Inspector
            </button>
            <button
              type="button"
              onClick={go("transactions")}
              className="flex-1 rounded-sm border border-border bg-surface px-3 py-2.5 text-sm font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
            >
              Open Timeline
            </button>
          </div>
        </form>

        <p className="mt-5 text-center text-[11px] text-faint">
          No consent ID handy? Create one via <code className="text-muted">POST /consent</code> and
          paste the returned <code className="text-muted">consent_id</code> above.
        </p>
      </div>
    </div>
  );
}
