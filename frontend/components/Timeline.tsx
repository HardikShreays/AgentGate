import { ActionType, AuditLogEntry } from "@/lib/types";
import { formatDateTime, formatTime } from "@/lib/format";
import { ACTION_LABELS, COLOR_CLASSES, TimelineColor, colorForEntry } from "@/lib/auditColor";
import { JsonPanel } from "./JsonPanel";

export const DEFAULT_LEGEND: { color: TimelineColor; label: string }[] = [
  { color: "success", label: "Success" },
  { color: "retry", label: "Retry" },
  { color: "danger", label: "Failed / notified" },
  { color: "revoked", label: "Revoked mid-transaction" },
];

export function Timeline({
  entries,
  legend = DEFAULT_LEGEND,
  showLegend = true,
  stagger = false,
  highlightActionType,
}: {
  entries: AuditLogEntry[];
  legend?: { color: TimelineColor; label: string }[];
  showLegend?: boolean;
  stagger?: boolean;
  highlightActionType?: ActionType;
}) {
  return (
    <div className="space-y-6">
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surfaceMuted px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-label text-faint">Legend</span>
          {legend.map(({ color, label }) => (
            <span key={color} className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-2 w-2 rounded-full ${COLOR_CLASSES[color].dot}`} />
              {label}
            </span>
          ))}
          <span className="ml-auto font-mono text-xs text-faint">{entries.length} entries</span>
        </div>
      )}

      <ol className="relative space-y-3 border-l border-border pl-6">
        {entries.map((entry, i) => (
          <TimelineRow
            key={entry.log_id}
            entry={entry}
            index={i + 1}
            delayMs={stagger ? i * 120 : undefined}
            highlighted={highlightActionType != null && entry.action_type === highlightActionType}
          />
        ))}
      </ol>
    </div>
  );
}

export function TimelineRow({
  entry,
  index,
  delayMs,
  highlighted,
}: {
  entry: AuditLogEntry;
  index: number;
  delayMs?: number;
  highlighted?: boolean;
}) {
  const color = colorForEntry(entry);
  const classes = COLOR_CLASSES[color];

  return (
    <li
      className={delayMs != null ? "animate-timeline-in opacity-0" : "relative"}
      style={delayMs != null ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="relative">
        <span
          className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-canvas ${classes.dot}`}
        />
        <div
          className={`rounded-lg border bg-surface p-4 shadow-card transition-shadow ${classes.border} ${
            highlighted ? "ring-2 ring-brand/50 shadow-cardHover" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] text-faint tabular">
                {String(index).padStart(3, "0")}
              </span>
              <span className={`text-xs font-semibold uppercase tracking-label ${classes.text}`}>
                {ACTION_LABELS[entry.action_type] ?? entry.action_type}
              </span>
              {highlighted && (
                <span className="rounded-full bg-brandTint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-label text-brand">
                  Server-side proof
                </span>
              )}
            </div>
            <span className="font-mono text-xs text-faint tabular" title={formatDateTime(entry.timestamp)}>
              {formatTime(entry.timestamp)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-navy">{entry.reasoning}</p>
          <div className="mt-3">
            <JsonPanel data={entry.structured_payload} label="Structured payload" />
          </div>
        </div>
      </div>
    </li>
  );
}
