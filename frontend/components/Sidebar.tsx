"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

// Signature mark: two gate posts (the product's namesake) closing around a
// signal dot — the dot sits inside when access is scoped/verified, echoing
// the consent-gate concept instead of a generic logomark.
export function GateMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="8" fill="#0C2451" />
      <rect x="7.5" y="6" width="3" height="16" rx="1.5" fill="white" />
      <rect x="17.5" y="6" width="3" height="16" rx="1.5" fill="white" />
      <circle cx="14" cy="14" r="2.5" fill="#3395FF" />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("agentgate:last_consent_id");
    if (stored) setLookup(stored);
  }, []);

  // /transactions/tx/[id] (P1-3) is transaction-scoped, not
  // consent-scoped, so it's excluded here — the sidebar's "Transaction
  // Timeline" link should keep pointing at the last known consent-level
  // timeline rather than trying to treat a transaction id as one.
  const currentId = pathname?.startsWith("/consent/")
    ? pathname.split("/")[2]
    : pathname?.startsWith("/transactions/") && !pathname.startsWith("/transactions/tx/")
      ? pathname.split("/")[2]
      : undefined;

  function jumpTo(target: "consent" | "transactions") {
    return (e: FormEvent) => {
      e.preventDefault();
      const id = lookup.trim();
      if (!id) return;
      window.localStorage.setItem("agentgate:last_consent_id", id);
      router.push(`/${target}/${encodeURIComponent(id)}`);
    };
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-5 py-5">
        <Link href="/dashboard" className="group flex items-center gap-2.5">
          <GateMark />
          <span className="font-mono text-[14px] font-medium tracking-wordmark text-navy">
            AgentGate
          </span>
        </Link>
        <p className="mt-1.5 pl-[38px] text-[11px] leading-snug text-faint">
          Consent &amp; trust layer
        </p>
      </div>

      <form onSubmit={jumpTo("consent")} className="border-b border-border px-5 py-4">
        <label htmlFor="lookup" className="block text-xs font-medium text-faint">
          Jump to a consent
        </label>
        <input
          id="lookup"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="c_..."
          spellCheck={false}
          className="mt-1.5 w-full rounded-sm border border-border bg-surfaceMuted px-2.5 py-1.5 font-mono text-xs text-navy placeholder:text-faint focus:border-brand focus:bg-surface"
        />
        <div className="mt-2 flex gap-1.5">
          <button
            type="submit"
            className="flex-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
          >
            Inspect
          </button>
          <button
            type="button"
            onClick={jumpTo("transactions")}
            className="flex-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
          >
            Timeline
          </button>
        </div>
      </form>

      <nav className="flex-1 px-3 py-4">
        <NavLink
          href={currentId ? `/consent/${currentId}` : "/dashboard"}
          label="Consent Inspector"
          active={pathname?.startsWith("/consent/") ?? false}
        />
        <NavLink
          href={currentId ? `/transactions/${currentId}` : "/dashboard"}
          label="Transaction Timeline"
          active={
            (pathname?.startsWith("/transactions/") && !pathname.startsWith("/transactions/tx/")) ??
            false
          }
        />
        <NavLink
          href="/agent"
          label="Buyer Agent chat"
          active={pathname?.startsWith("/agent") ?? false}
        />

        <div className="mb-1.5 mt-5 px-3 text-xs font-medium text-faint">Live demos</div>
        <NavLink
          href="/demo/revocation"
          label="Revocation mid-txn"
          active={pathname?.startsWith("/demo/revocation") ?? false}
        />
        <NavLink
          href="/demo/race"
          label="Race condition"
          active={pathname?.startsWith("/demo/race") ?? false}
        />
        <NavLink
          href="/demo/failure"
          label="Failure path"
          active={pathname?.startsWith("/demo/failure") ?? false}
        />
      </nav>

      <div className="border-t border-border px-5 py-4 text-[11px] leading-relaxed text-faint">
        Track 01 — AI Growth &amp; Agentic Commerce
        <br />
        Razorpay Test Mode
      </div>
    </aside>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`mb-0.5 flex items-center gap-2.5 rounded-sm border-l-2 px-3 py-2 text-[13px] font-medium transition ${
        active
          ? "border-l-brand bg-brandTint text-brand"
          : "border-l-transparent text-navySoft hover:border-l-borderStrong hover:bg-surfaceMuted hover:text-navy"
      }`}
    >
      {label}
    </Link>
  );
}
