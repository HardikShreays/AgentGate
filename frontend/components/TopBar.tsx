import Link from "next/link";
import { ConsentStatus } from "@/lib/types";
import { ConsentStatusBadge } from "./StatusBadge";

export function TopBar({
  consentId,
  status,
  page,
  onRefresh,
  onRevoke,
  revoking,
}: {
  consentId: string;
  status?: ConsentStatus;
  page: "consent" | "transactions";
  onRefresh: () => void;
  onRevoke?: () => void;
  revoking?: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-surface/85 px-8 py-4 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[13px]">
            <TabLink
              href={`/consent/${encodeURIComponent(consentId)}`}
              active={page === "consent"}
            >
              Consent Inspector
            </TabLink>
            <TabLink
              href={`/transactions/${encodeURIComponent(consentId)}`}
              active={page === "transactions"}
            >
              Transaction Timeline
            </TabLink>
          </div>
          <h1 className="mt-2 truncate font-mono text-sm text-navySoft" title={consentId}>
            {consentId}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && <ConsentStatusBadge status={status} />}
          <button
            onClick={onRefresh}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-navySoft transition hover:border-brand/50 hover:text-brand"
          >
            Refresh
          </button>
          {onRevoke && status === "active" && (
            <button
              onClick={onRevoke}
              disabled={revoking}
              className="rounded-sm bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:bg-danger/90 disabled:opacity-50"
            >
              {revoking ? "Revoking…" : "Revoke"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-sm px-2.5 py-1 font-medium transition ${
        active ? "bg-brandTint text-brand" : "text-faint hover:text-navySoft"
      }`}
    >
      {children}
    </Link>
  );
}
