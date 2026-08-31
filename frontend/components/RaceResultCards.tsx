import { ExecuteTransactionResponse } from "@/lib/types";
import { formatInr } from "@/lib/format";

export function RaceResultCards({
  results,
}: {
  results: [ExecuteTransactionResponse, ExecuteTransactionResponse];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {results.map((r, i) => (
        <RaceResultCard key={i} result={r} label={`Request ${String.fromCharCode(65 + i)}`} />
      ))}
    </div>
  );
}

function RaceResultCard({ result, label }: { result: ExecuteTransactionResponse; label: string }) {
  const accepted = result.status !== "denied";
  return (
    <div
      className={`rounded-lg border p-4 shadow-card ${
        accepted ? "border-success/30 bg-successTint" : "border-danger/30 bg-dangerTint"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-label text-faint">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-label ${
            accepted ? "text-success" : "text-danger"
          }`}
        >
          {accepted ? "Accepted" : "Denied"}
        </span>
      </div>
      <p className={`mt-2 text-sm leading-relaxed ${accepted ? "text-navy" : "text-danger"}`}>
        {result.reasoning}
      </p>
      <div className="mt-2 space-y-0.5 font-mono text-xs text-navySoft">
        {result.reason && <div>reason: {result.reason}</div>}
        {result.razorpay_order_id && <div>order: {result.razorpay_order_id}</div>}
        {result.amount != null && <div>amount: {formatInr(result.amount)}</div>}
      </div>
    </div>
  );
}
