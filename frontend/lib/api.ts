import {
  AgentMessageRequest,
  AgentMessageResponse,
  ApiError,
  AuditTrailResponse,
  ConsentCreateRequest,
  ConsentResponse,
  ConsentRevokeResponse,
  CatalogResponse,
  ConfirmPaymentRequest,
  DemoModeResponse,
  ExecuteTransactionRequest,
  ExecuteTransactionResponse,
  SimulateFailureRequest,
  TransactionStatusResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// `base` defaults to the backend (API_URL). Pass "" for the three mutating
// endpoints so the fetch stays same-origin, hitting this Next.js app's own
// /api/agentgate/* route handler instead of the backend directly.
async function request<T>(path: string, init?: RequestInit, base: string = API_URL): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
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

// create/revoke/execute are the mutating endpoints the backend now requires
// a signed principal for (see backend/app/auth.py). The signing secret must
// never reach the browser, so these three go through this app's own
// /api/agentgate/* route handlers (server-side, holds the secret) instead
// of straight to the backend like every read-only call below.
export function createConsent(body: ConsentCreateRequest): Promise<ConsentResponse> {
  return request(`/api/agentgate/consent`, { method: "POST", body: JSON.stringify(body) }, "");
}

export function getConsent(consentId: string): Promise<ConsentResponse> {
  return request(`/consent/${encodeURIComponent(consentId)}`);
}

export function revokeConsent(consentId: string): Promise<ConsentRevokeResponse> {
  return request(`/api/agentgate/consent/${encodeURIComponent(consentId)}/revoke`, {
    method: "POST",
  }, "");
}

export function getAuditTrail(consentId: string): Promise<AuditTrailResponse> {
  return request(`/audit/${encodeURIComponent(consentId)}`);
}

export function executeTransaction(
  body: ExecuteTransactionRequest
): Promise<ExecuteTransactionResponse> {
  return request(`/api/agentgate/transaction/execute`, { method: "POST", body: JSON.stringify(body) }, "");
}

export function getCatalog(category?: string): Promise<CatalogResponse> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  return request(`/catalog${q}`);
}

export function simulateFailure(body: SimulateFailureRequest): Promise<TransactionStatusResponse> {
  return request(`/demo/simulate-failure`, { method: "POST", body: JSON.stringify(body) });
}

export function confirmPayment(body: ConfirmPaymentRequest): Promise<TransactionStatusResponse> {
  return request(`/transaction/confirm`, { method: "POST", body: JSON.stringify(body) });
}

export function getTransactionStatus(transactionId: string): Promise<TransactionStatusResponse> {
  return request(`/transaction/${encodeURIComponent(transactionId)}/status`);
}

export function sendAgentMessage(body: AgentMessageRequest): Promise<AgentMessageResponse> {
  return request(`/agent/message`, { method: "POST", body: JSON.stringify(body) });
}

export function getDemoMode(): Promise<DemoModeResponse> {
  return request(`/demo-mode`);
}

export function setDemoMode(enabled: boolean): Promise<DemoModeResponse> {
  return request(`/demo-mode`, { method: "POST", body: JSON.stringify({ enabled }) });
}

export { API_URL };
