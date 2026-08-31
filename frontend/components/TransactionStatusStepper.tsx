import { TransactionStatusResponse } from "@/lib/types";
import { formatTime } from "@/lib/format";

// Extracted out of ExecuteTransactionPanel.tsx (P0-2) so P1-3's standalone
// `/transactions/tx/[id]` route can render the exact same attempt stepper
// instead of reimplementing it — same reasoning as Timeline/TimelineRow
// being shared between the consent-scoped audit view and the live demo
// pages. This is what actually shows the "one bounded retry, then hard
// stop" claim at the transaction level.
export function TransactionStatusCard({
  status,
  polling,
}: {
  status: TransactionStatusResponse | null;
  polling: boolean;
}) {
  return (
    <div className="rounded-sm border border-border bg-surfaceMuted p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-label text-faint">
          Transaction status
        </span>
        {polling && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            watching for webhook…
          </span>
        )}
      </div>

      {!status ? (
        <p className="mt-1.5 text-xs text-muted">Waiting on the first status read…</p>
      ) : (
        <>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusPill status={status.status} />
            <span className="font-mono text-xs text-navySoft">
              {status.attempt_count}/{status.max_attempts} attempts
            </span>
          </div>
          <ol className="mt-2 space-y-1.5">
            {status.attempts.map((a) => (
              <li key={a.attempt} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-faint">#{a.attempt}</span>
                <StatusPill status={a.status} small />
                <span className="min-w-0 flex-1 truncate text-muted" title={a.error_reason ?? ""}>
                  {a.error_reason ?? "—"}
                </span>
                <span className="shrink-0 font-mono text-faint">
                  {a.resolved_at ? formatTime(a.resolved_at) : a.created_at ? formatTime(a.created_at) : ""}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const tone =
    status === "captured"
      ? "bg-successTint text-success"
      : status === "failed" || status === "denied"
        ? "bg-dangerTint text-danger"
        : "bg-warningTint text-warning";
  return (
    <span
      className={`rounded-full font-semibold uppercase tracking-label ${tone} ${
        small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      {status}
    </span>
  );
}
