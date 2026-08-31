import {
  ApiError,
  AuditTrailResponse,
  ConsentCreateRequest,
  ConsentResponse,
  ConsentRevokeResponse,
  ConfirmPaymentRequest,
  ExecuteTransactionRequest,
  ExecuteTransactionResponse,
  TransactionStatusResponse,
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

export function createConsent(body: ConsentCreateRequest): Promise<ConsentResponse> {
  return request(`/consent`, { method: "POST", body: JSON.stringify(body) });
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

export function executeTransaction(
  body: ExecuteTransactionRequest
): Promise<ExecuteTransactionResponse> {
  return request(`/transaction/execute`, { method: "POST", body: JSON.stringify(body) });
}

export function confirmPayment(body: ConfirmPaymentRequest): Promise<TransactionStatusResponse> {
  return request(`/transaction/confirm`, { method: "POST", body: JSON.stringify(body) });
}

export function getTransactionStatus(transactionId: string): Promise<TransactionStatusResponse> {
  return request(`/transaction/${encodeURIComponent(transactionId)}/status`);
}

export { API_URL };
