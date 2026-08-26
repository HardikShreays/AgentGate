import {
  ApiError,
  AuditTrailResponse,
  ConsentResponse,
  ConsentRevokeResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `Could not reach the AgentGate API at ${API_URL}. Is the backend running?`,
      0
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // response wasn't JSON — fall back to statusText
    }
    throw new ApiError(detail, res.status);
  }

  return res.json() as Promise<T>;
}

export function getConsent(consentId: string): Promise<ConsentResponse> {
  return request(`/consent/${encodeURIComponent(consentId)}`);
}

export function revokeConsent(consentId: string): Promise<ConsentRevokeResponse> {
  return request(`/consent/${encodeURIComponent(consentId)}/revoke`, {
    method: "POST",
  });
}

export function getAuditTrail(consentId: string): Promise<AuditTrailResponse> {
  return request(`/audit/${encodeURIComponent(consentId)}`);
}

export { API_URL };
