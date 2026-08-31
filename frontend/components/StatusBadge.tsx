import { ConsentStatus } from "@/lib/types";

const CONSENT_STYLES: Record<ConsentStatus, string> = {
  active: "bg-successTint text-success",
  expired: "bg-surfaceSunken text-muted",
  revoked: "bg-revokedTint text-revoked",
  exhausted: "bg-warningTint text-warning",
};

export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-label ${CONSENT_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function IntegrityBadge({ valid }: { valid: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-label ${
        valid ? "bg-successTint text-success" : "bg-dangerTint text-danger"
      }`}
    >
      {valid ? "Verified" : "Tampered"}
    </span>
  );
}
