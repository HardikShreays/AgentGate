import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, principalHeaders } from "@/lib/serverAuth";

// Proxies POST /consent/{id}/revoke. Revoke has no request body carrying an
// owner, so this looks the consent up first (GET is unauthenticated, same
// as before) to learn who owns it, then signs the revoke as that owner.
// This is the dashboard acting as a single trusted client on the human's
// behalf, not per-user login (see lib/serverAuth.ts) — but it means a
// caller hitting the raw backend directly, without this secret, can no
// longer revoke anyone's consent.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lookup = await fetch(`${INTERNAL_API_URL}/consent/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!lookup.ok) {
    const data = await lookup.json().catch(() => ({ detail: lookup.statusText }));
    return NextResponse.json(data, { status: lookup.status });
  }
  const consent = await lookup.json();

  const res = await fetch(`${INTERNAL_API_URL}/consent/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    headers: principalHeaders(consent.user_id),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
