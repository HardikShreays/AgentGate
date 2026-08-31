import { ExecuteTransactionResponse } from "@/lib/types";
import { formatInr } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";

export function RaceResultCards({
  results,
}: {
  results: [ExecuteTransactionResponse, ExecuteTransactionResponse];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {results.map((result, index) => (
        <RaceResultCard key={index} label={`Request ${index + 1}`} result={result} />
      ))}
    </div>
  );
}

function RaceResultCard({
  label,
  result,
}: {
  label: string;
  result: ExecuteTransactionResponse;
}) {
  const accepted = result.status !== "denied";
  const balanceDenied =
    result.status === "denied" && result.reason === "insufficient_remaining_balance";
  const tone = accepted
    ? "border-success/25 bg-successTint text-success"
    : balanceDenied
      ? "border-danger/30 bg-dangerTint text-danger"
      : "border-warning/30 bg-warningTint text-warning";

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-label">{label}</div>
        <div className="rounded-full bg-white/70 px-2 py-0.5 font-mono text-[10px] uppercase">
          {accepted ? "accepted" : "denied"}
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{result.reasoning}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Meta label="Status" value={result.status} />
        <Meta label="Reason" value={result.reason ?? "-"} />
        <Meta label="Amount" value={result.amount ? formatInr(result.amount) : "-"} />
        <Meta label="Remaining" value={result.consent_remaining ? formatInr(result.consent_remaining) : "-"} />
      </dl>
      {result.transaction_id && (
        <div className="mt-3 flex min-w-0 items-center gap-1 font-mono text-xs opacity-80">
          <span className="truncate" title={result.transaction_id}>
            {result.transaction_id}
          </span>
          <CopyButton value={result.transaction_id} label="Transaction ID" className="hover:bg-white/70" />
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-label opacity-70">{label}</dt>
      <dd className="truncate font-mono" title={value}>
        {value}
      </dd>
    </div>
  );
}
