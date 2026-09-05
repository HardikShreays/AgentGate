// Server-only. Never import this from a "use client" component — it reads
// AGENTGATE_HMAC_SECRET, which must never reach the browser bundle (unlike
// NEXT_PUBLIC_* vars, an unprefixed env var is never inlined into client
// code, but importing this file from a client component would still try to
// read it at runtime in the browser and fail/leak intent). It backs the
// three route handlers under app/api/agentgate/*, which are the only things
// allowed to call this.
//
// Mirrors backend/app/auth.py's derive_principal_key(): HMAC-SHA256(secret,
// principal_id). The dashboard has no login system (see README §1), so it
// is one trusted client holding the shared secret and asserting a principal
// on the human's behalf — the real fix (a login system in front of this)
// is future work, but a caller who does NOT hold this secret can no longer
// reach the backend's create/spend/revoke endpoints at all, which is the
// concrete gap being closed.
import { createHmac } from "crypto";

export function principalHeaders(principalId: string): Record<string, string> {
  const secret = process.env.AGENTGATE_HMAC_SECRET || "dev-only-change-me";
  const key = createHmac("sha256", secret).update(principalId).digest("hex");
  return { "X-Principal-Id": principalId, "X-AgentGate-Key": key };
}

// The backend URL reachable from the Next.js *server* process. In Docker
// Compose this is the internal service hostname (http://api:8000); the
// browser instead uses NEXT_PUBLIC_API_URL (http://localhost:8000, the
// host-exposed port) since it runs outside the compose network entirely.
// In local (non-Docker) dev both processes are on the same machine, so
// this just falls back to NEXT_PUBLIC_API_URL.
export const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
