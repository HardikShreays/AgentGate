import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, principalHeaders } from "@/lib/serverAuth";

// Proxies POST /consent, signing the request as the principal named in the
// request body (creating a consent contract is the one case where there is
// no existing owner to look up — the caller declares who it's creating the
// contract for, same as today's UX, just now backed by a real credential
// the raw backend API requires).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${INTERNAL_API_URL}/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...principalHeaders(body.user_id) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
