// Small localStorage-backed "recent consents" list. There's no
// GET /consents list endpoint on the backend (by design — see README
// §10, Future Work), so this is the same client-only pattern the app
// already uses for `agentgate:last_consent_id`, just extended to a
// short history instead of a single value.

const KEY = "agentgate:recent_consents";
const MAX = 6;

export interface RecentConsent {
  consent_id: string;
  at: string; // ISO timestamp
}

export function rememberConsentId(consentId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("agentgate:last_consent_id", consentId);
  try {
    const existing = getRecentConsents().filter((r) => r.consent_id !== consentId);
    const next = [{ consent_id: consentId, at: new Date().toISOString() }, ...existing].slice(
      0,
      MAX
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable or full — recent list is a convenience, not
    // load-bearing, so fail silently.
  }
}

export function getRecentConsents(): RecentConsent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
