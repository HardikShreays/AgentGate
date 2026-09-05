import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, principalHeaders } from "@/lib/serverAuth";

// Proxies POST /transaction/execute. Same pattern as the revoke route: look
// up the consent to learn its owner, then sign the execute call as that
// owner before forwarding.
export async function POST(req: NextRequest) {
  const body = await req.json();

  const lookup = await fetch(`${INTERNAL_API_URL}/consent/${encodeURIComponent(body.consent_id)}`, {
    cache: "no-store",
  });
  if (!lookup.ok) {
    const data = await lookup.json().catch(() => ({ detail: lookup.statusText }));
    return NextResponse.json(data, { status: lookup.status });
  }
  const consent = await lookup.json();

  const res = await fetch(`${INTERNAL_API_URL}/transaction/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...principalHeaders(consent.user_id) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
