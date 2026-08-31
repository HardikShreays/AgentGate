export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-label text-faint">{label}</div>
      <div
        className={`mt-1.5 truncate font-mono text-lg tabular ${accent ? "text-brand" : "text-navy"}`}
        title={value}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function SpendMeter({
  used,
  limit,
  remaining,
}: {
  used: number;
  limit: number;
  remaining: number;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const barColor = pct >= 90 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-brand";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-label text-faint">Spend used</span>
        <span className="font-mono text-xs text-muted">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surfaceSunken">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 font-mono text-xs">
        <span className="min-w-0 truncate text-navy">
          ₹{used.toLocaleString("en-IN", { minimumFractionDigits: 2 })} used
        </span>
        <span className="min-w-0 truncate text-muted">
          ₹{remaining.toLocaleString("en-IN", { minimumFractionDigits: 2 })} remaining
        </span>
      </div>
    </div>
  );
}

export function ScopeTags({ scope }: { scope: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {scope.map((s) => (
        <span
          key={s}
          className="rounded-full border border-border bg-surfaceMuted px-2.5 py-1 font-mono text-[11px] text-navySoft"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export function IntegrityStrip({ hash, valid }: { hash: string; valid: boolean }) {
  return (
    <div
      className={`flex items-center gap-4 rounded-lg border bg-surface p-4 shadow-card ${
        valid ? "border-success/25" : "border-danger/30"
      }`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed ${
          valid ? "border-success/40 bg-successTint text-success" : "border-danger/40 bg-dangerTint text-danger"
        }`}
      >
        {valid ? <CheckIcon /> : <CrossIcon />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-label text-faint">
          Integrity hash · HMAC-SHA256
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted" title={hash}>
          {hash}
        </div>
      </div>
      <div
        className={`shrink-0 text-xs font-semibold uppercase tracking-label ${
          valid ? "text-success" : "text-danger"
        }`}
      >
        {valid ? "Verified" : "Tampered"}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 9.5 17 19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6 18 18M18 6 6 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
