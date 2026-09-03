import Link from "next/link";
import { GateMark } from "@/components/Sidebar";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";

export const metadata = {
  title: "AgentGate — consent enforced at the moment money moves",
  description:
    "A scoped, expiring, tamper-evident spend mandate for buyer agents — re-verified under a row lock as late as physically possible before a Razorpay order is created, and revocable while a transaction is in flight.",
};

const REPO = "https://github.com/HardikShreays/AgentGate";

// The hero ledger — the exact sequence the revocation demo produces,
// revealed one row at a time on load (see .animate-ledger-row).
const LEDGER = [
  { t: "00:00.0", action: "consent_check", verdict: "approved", note: "₹420 within per-txn and remaining caps" },
  { t: "00:01.0", action: "revocation_processed", verdict: "—", note: "human revoked the consent from a separate request" },
  { t: "00:03.0", action: "consent_check", verdict: "denied", note: "revoked_mid_transaction" },
  { t: "00:03.0", action: "order_created", verdict: "blocked", note: "Razorpay was never called" },
];

const PROTOCOLS = [
  { name: "AP2", by: "Google", line: "A user-signed mandate delegates scoped spend to an agent, with a cart mandate committing an amount to a merchant." },
  { name: "ACP", by: "OpenAI · Stripe", line: "Standardises the merchant catalog feed and the checkout handoff between an agent and a store." },
  { name: "x402", by: "open spec", line: "Revives HTTP 402 as a payment challenge: the server asks, the client pays, the request is retried." },
];

const NUMBERS = [
  { claim: "No double-spend under concurrency", cmd: "race_test.py --runs 250", result: "250 / 250 races closed correctly" },
  { claim: "Revocation lands mid-transaction", cmd: "revocation_demo.py --runs 50", result: "50 / 50 aborted before Razorpay" },
  { claim: "Suite green on every push", cmd: "pytest tests/ -q", result: "56 passed" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas text-navy">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header
        className="text-white"
        style={{ background: "linear-gradient(165deg, #0C2451 0%, #071634 100%)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-center gap-2.5">
            <GateMark />
            <span className="font-mono text-sm font-medium tracking-wordmark">AgentGate</span>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:pb-28">
          <div>
            <p className="font-mono text-xs text-white/55">Consent &amp; trust layer for agent payments</p>
            <h1 className="mt-4 font-display text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.12] tracking-[-0.02em]">
              The mandate is re-checked the moment the money moves.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[15px] leading-relaxed text-white/70">
              AP2, ACP, and x402 all authorise a buyer agent once, at the door. AgentGate
              re-verifies that mandate under a database row lock as late as physically
              possible before a Razorpay order is created — and a human can revoke it while
              the transaction is still in flight.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-sm bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark"
              >
                Open the dashboard
              </Link>
              <a
                href={REPO}
                className="rounded-sm border border-white/25 px-5 py-2.5 text-sm font-medium text-white/90 transition hover:border-white/60"
              >
                Read the source
              </a>
            </div>
          </div>

          {/* Audit ledger */}
          <figure className="rounded-lg border border-white/12 bg-white/[0.04] p-5 shadow-popover backdrop-blur-sm">
            <figcaption className="flex items-center justify-between font-mono text-[11px] text-white/45">
              <span>GET /audit/c_3f9a2e…</span>
              <span>revocation demo</span>
            </figcaption>
            <div className="mt-4 space-y-2 font-mono text-[12px] leading-relaxed">
              {LEDGER.map((row, i) => {
                const blocked = row.verdict === "blocked";
                const denied = row.verdict === "denied";
                return (
                  <div
                    key={i}
                    className="animate-ledger-row grid grid-cols-[auto_1fr] gap-x-3 border-b border-white/8 pb-2 last:border-0"
                    style={{ "--row": `${140 + i * 520}ms` } as React.CSSProperties}
                  >
                    <span className="text-white/40">{row.t}</span>
                    <span>
                      <span className={blocked ? "text-white/45 line-through" : "text-white/90"}>
                        {row.action}
                      </span>
                      <span
                        className={
                          "ml-2 " +
                          (blocked
                            ? "text-danger"
                            : denied
                              ? "text-revoked"
                              : row.verdict === "approved"
                                ? "text-success"
                                : "text-white/40")
                        }
                      >
                        {blocked ? "✕ never reached" : row.verdict}
                      </span>
                      <span className="mt-0.5 block text-white/45">{row.note}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 font-mono text-[11px] text-white/45">
              50 / 50 runs. No <span className="text-white/70">order_created</span> row in any of them.
            </p>
          </figure>
        </div>
      </header>

      {/* ── The gap ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="max-w-[24ch] font-display text-[clamp(1.5rem,3vw,2rem)] font-medium leading-tight tracking-[-0.01em]">
          Three agent-payment protocols shipped this year. All three stop at authorisation.
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {PROTOCOLS.map((p) => (
            <div key={p.name} className="border-t-2 border-navy/15 pt-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-medium text-navy">{p.name}</span>
                <span className="text-xs text-faint">{p.by}</span>
              </div>
              <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-muted">{p.line}</p>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-label text-faint">
                checked once, at signing
              </p>
            </div>
          ))}
        </div>
        <p className="mt-12 max-w-[68ch] text-[15px] leading-relaxed text-navySoft">
          A mandate gets signed, an agent gets scoped spend, the check happens at the door.
          None of them re-verify that mandate at the instant money actually moves, and none
          of them can be pulled back mid-transaction. That gap is the whole bet of AgentGate.
        </p>
      </section>

      {/* ── What it does ─────────────────────────────────────── */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-x-12 gap-y-14 md:grid-cols-2">
            <div>
              <h3 className="font-display text-xl font-medium tracking-[-0.01em] text-navy">
                Re-checked when money moves
              </h3>
              <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-muted">
                The executor takes a <code className="font-mono text-[12px] text-navy">SELECT … FOR UPDATE</code>{" "}
                row lock, re-runs the full consent check inside it, and writes a{" "}
                <code className="font-mono text-[12px] text-navy">spend_reserved</code> hold in the
                same transaction — closing the window where two concurrent buys both read the
                same balance.
              </p>
              <pre className="mt-5 overflow-x-auto rounded-sm border border-border bg-canvas p-4 font-mono text-[12px] leading-relaxed text-navySoft">
{`lock  → SELECT … FOR UPDATE
check → check_consent() under lock
hold  → write spend_reserved
order → create Razorpay order`}
              </pre>
            </div>

            <div>
              <h3 className="font-display text-xl font-medium tracking-[-0.01em] text-navy">
                Revocable mid-flight
              </h3>
              <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-muted">
                A human can revoke a consent from a separate request while a transaction is
                sleeping between checks. The executor&rsquo;s post-delay re-check sees it and
                aborts before Razorpay is ever called — and the audit trail proves the order
                was never created.
              </p>
              <pre className="mt-5 overflow-x-auto rounded-sm border border-border bg-canvas p-4 font-mono text-[12px] leading-relaxed text-navySoft">
{`consent_check         approved
revocation_processed  —
consent_check         denied  ·  revoked_mid_transaction
order_created          (never written)`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── The numbers ──────────────────────────────────────── */}
      <section className="text-white" style={{ background: "#0C2451" }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-[clamp(1.5rem,3vw,2rem)] font-medium tracking-[-0.01em]">
            Measured, not asserted.
          </h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-white/60">
            Reproducible on real Postgres and real Razorpay test mode. The scripts are in the
            repo; the logs are committed next to them.
          </p>
          <div className="mt-10 divide-y divide-white/10 border-y border-white/10 font-mono text-[13px]">
            {NUMBERS.map((n) => (
              <div key={n.claim} className="grid gap-1 py-4 md:grid-cols-[1fr_14rem_auto] md:items-center md:gap-6">
                <span className="text-white/85">{n.claim}</span>
                <span className="text-white/40">{n.cmd}</span>
                <span className="text-brand md:text-right">{n.result}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Architecture ─────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-display text-[clamp(1.5rem,3vw,2rem)] font-medium tracking-[-0.01em]">
          Money decisions never touch the LLM.
        </h2>
        <div className="mt-8 rounded-lg border border-border bg-surface p-5 shadow-card">
          <ArchitectureDiagram />
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The agent picks a catalog SKU; the server resolves the price and discards any
            amount the caller supplied. Its tools call straight into the same Consent Engine
            and Tx Executor the plain HTTP API uses, so a hallucinated &ldquo;that
            worked&rdquo; has no way to move money.
          </p>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <footer className="text-white" style={{ background: "linear-gradient(165deg, #0C2451 0%, #071634 100%)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-[20ch] font-display text-[clamp(1.75rem,4vw,2.5rem)] font-medium leading-tight tracking-[-0.02em]">
            It&rsquo;s all in the repo.
          </h2>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-white/70">
            The row lock, the integrity hash, the reservation hold, the gap-free audit trail,
            and three one-click live demos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-sm bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark"
            >
              Open the dashboard
            </Link>
            <a
              href={REPO}
              className="rounded-sm border border-white/25 px-5 py-2.5 text-sm font-medium text-white/90 transition hover:border-white/60"
            >
              View on GitHub
            </a>
          </div>
          <p className="mt-16 font-mono text-[11px] text-white/40">
            Track 01 — AI Growth &amp; Agentic Commerce · Razorpay AI Buildathon
          </p>
        </div>
      </footer>
    </div>
  );
}
