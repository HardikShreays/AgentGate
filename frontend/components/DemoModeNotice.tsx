// The frontend can't flip a server-side env var, and a mysterious failure
// mid-demo is worse than a clear precondition stated up front. Shared by
// /demo/revocation (needs DEMO_MODE=true) and /demo/race (needs
// DEMO_MODE=false) so both panels look consistent.
export function DemoModeNotice({ mode }: { mode: "true" | "false" }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warningTint px-4 py-3 text-xs leading-relaxed text-navy">
      <span className="font-semibold uppercase tracking-label text-warning">Requires DEMO_MODE={mode}</span>
      {" — "}
      {mode === "true" ? (
        <>
          the backend API must be running with <code className="font-mono">DEMO_MODE=true</code> for{" "}
          <code className="font-mono">simulate_delay_ms</code> to be honored. Flip it back to{" "}
          <code className="font-mono">false</code> afterward before running the race demo or recording
          the happy path.
        </>
      ) : (
        <>
          this test never sets <code className="font-mono">simulate_delay_ms</code>, so it doesn&apos;t
          depend on <code className="font-mono">DEMO_MODE</code> to prove the row lock — but keep the
          backend running with <code className="font-mono">DEMO_MODE=false</code> anyway, since that&apos;s
          the required state for any real submission run or recording.
        </>
      )}
    </div>
  );
}

// Rendered instead of a clean pass/fail when a run's outcome is only
// explainable by DEMO_MODE being set the wrong way — a real Razorpay
// order appearing where a clean denial was expected, or vice versa.
export function DemoModeMismatch({ mode }: { mode: "true" | "false" }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-dangerTint p-4 text-sm text-danger">
      <div className="text-[11px] font-semibold uppercase tracking-label">DEMO_MODE looks like it&apos;s off</div>
      <p className="mt-1.5 leading-relaxed">
        This run&apos;s result only makes sense if the API isn&apos;t currently running with{" "}
        <code className="font-mono">DEMO_MODE={mode}</code>. Restart the backend with that flag set and
        try again.
      </p>
    </div>
  );
}
