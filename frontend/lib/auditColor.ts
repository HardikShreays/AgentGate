import { AuditLogEntry } from "./types";

export type TimelineColor = "success" | "retry" | "danger" | "revoked" | "neutral";

// Phase 6 spec: "color-coded (green = success, amber = retry, red =
// failed+notified, purple = revoked-mid-transaction)". action_type alone
// doesn't carry enough information for every case (a consent_check row can
// be an approval or one of several denial reasons), so this reads the
// structured_payload the same way the backend's own reasoning templates
// do (app/audit.py) rather than re-deriving new logic.
export function colorForEntry(entry: AuditLogEntry): TimelineColor {
  const p = entry.structured_payload || {};
  const reason = (p.reason as string | undefined) ?? undefined;

  switch (entry.action_type) {
    case "consent_check":
      if (p.decision === "approved") return "success";
      if (reason === "revoked_mid_transaction" || reason === "revoked") return "revoked";
      return "danger";
    case "order_created":
    case "payment_captured":
      return "success";
    case "retry_attempted":
      return "retry";
    case "payment_failed":
      return "retry";
    case "merchant_notified":
      return "danger";
    case "revocation_processed":
      return "revoked";
    case "race_condition_detected":
    case "integrity_violation":
      return "danger";
    default:
      return "neutral";
  }
}

export const COLOR_CLASSES: Record<TimelineColor, { dot: string; text: string; border: string }> = {
  success: { dot: "bg-success", text: "text-success", border: "border-success/25" },
  retry: { dot: "bg-warning", text: "text-warning", border: "border-warning/25" },
  danger: { dot: "bg-danger", text: "text-danger", border: "border-danger/25" },
  revoked: { dot: "bg-revoked", text: "text-revoked", border: "border-revoked/25" },
  neutral: { dot: "bg-faint", text: "text-muted", border: "border-border" },
};

export const ACTION_LABELS: Record<string, string> = {
  consent_check: "Consent check",
  order_created: "Order created",
  payment_captured: "Payment captured",
  payment_failed: "Payment failed",
  retry_attempted: "Retry attempted",
  merchant_notified: "Merchant notified",
  revocation_processed: "Revocation processed",
  race_condition_detected: "Race condition detected",
  integrity_violation: "Integrity violation",
};
