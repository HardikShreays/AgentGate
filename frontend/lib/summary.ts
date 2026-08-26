import { ConsentResponse } from "./types";
import { formatInr, relativeExpiry } from "./format";

// Deterministic, template-generated — same input always produces the same
// sentence, matching the philosophy of the backend's own reasoning
// templates (app/audit.py): readable prose that's still testable.
export function summarizeConsent(c: ConsentResponse): string {
  const limit = formatInr(c.spend_limit);
  const used = formatInr(c.spend_used);
  const remaining = formatInr(
    (parseFloat(c.spend_limit) - parseFloat(c.spend_used)).toFixed(2)
  );
  const perTxn = formatInr(c.per_txn_max);
  const scope = c.scope.join(", ");
  const expiry = relativeExpiry(c.expiry);

  const statusClause: Record<ConsentResponse["status"], string> = {
    active: `expiring ${expiry.label}`,
    expired: `expired ${expiry.label.replace(/^expired /, "")}`,
    revoked: c.revoked_at ? `revoked at ${new Date(c.revoked_at).toLocaleString("en-IN")}` : "revoked",
    exhausted: "fully spent",
  };

  const integrityClause = c.integrity_valid
    ? "integrity verified"
    : "integrity check FAILED — do not trust this record";

  return (
    `${c.user_id} may spend up to ${limit} at ${c.merchant_id} on ${scope}, ` +
    `capped at ${perTxn} per transaction. ${used} used, ${remaining} remaining. ` +
    `Status: ${c.status} (${statusClause[c.status]}). ${integrityClause}.`
  );
}
