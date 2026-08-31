"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GateMark } from "@/components/Sidebar";
import { CreateConsentForm } from "@/components/CreateConsentForm";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { getRecentConsents, rememberConsentId, RecentConsent } from "@/lib/recent";
import { truncateMiddle, formatDateTime } from "@/lib/format";

export default function Home() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [recent, setRecent] = useState<RecentConsent[]>([]);

  useEffect(() => {
    const stored = window.localStorage.getItem("agentgate:last_consent_id");
    if (stored) setId(stored);
    setRecent(getRecentConsents());
  }, []);

  function openConsent(target: "consent" | "transactions", explicitId?: string) {
    const trimmed = (explicitId ?? id).trim();
    if (!trimmed) return;
    rememberConsentId(trimmed);
    router.push(`/${target}/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
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
          Issue a consent contract, execute a transaction against it, and inspect the
          gap-free reasoning trail — no curl required.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
            New consent
          </div>
          <CreateConsentForm />
        </div>

        <div className="space-y-6">
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
              Look up an existing consent
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                openConsent("consent");
              }}
              className="rounded-lg border border-border bg-surface p-4 shadow-card"
            >
              <label
                htmlFor="home-lookup"
                className="block text-[11px] font-medium uppercase tracking-label text-faint"
              >
                Consent ID
              </label>
              <input
                id="home-lookup"
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
                  Open Inspector
                </button>
                <button
                  type="button"
                  onClick={() => openConsent("transactions")}
                  className="flex-1 rounded-sm border border-border bg-surface px-3 py-2.5 text-sm font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
                >
                  Open Timeline
                </button>
              </div>
            </form>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
              Recent consents
            </div>
            {recent.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-faint">
                Consents you create or view will show up here.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((r) => (
                  <li key={r.consent_id}>
                    <button
                      type="button"
                      onClick={() => openConsent("consent", r.consent_id)}
                      className="flex w-full items-center justify-between rounded-sm border border-border bg-surface px-3 py-2 text-left transition hover:border-brand/50 hover:bg-brandTint"
                    >
                      <span className="truncate font-mono text-xs text-navySoft" title={r.consent_id}>
                        {truncateMiddle(r.consent_id, 12, 8)}
                      </span>
                      <span className="ml-2 shrink-0 text-[10px] text-faint">
                        {formatDateTime(r.at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-label text-faint">
          Architecture
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <ArchitectureDiagram />
          <p className="mt-2 text-center text-[11px] text-faint">
            Money decisions are never made by an LLM — the agent's tools call directly into
            the same Consent Engine and Tx Executor the HTTP API uses.
          </p>
        </div>
      </div>
    </div>
  );
}
