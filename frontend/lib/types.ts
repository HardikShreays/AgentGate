// Mirrors backend/app/schemas.py. Kept as plain types (no runtime
// validation library) since this is a two-page read-mostly dashboard —
// per A.11, no state library, no extra dependency for this scale.

export type ConsentStatus = "active" | "expired" | "revoked" | "exhausted";

export interface ConsentCreateRequest {
  user_id: string;
  merchant_id: string;
  spend_limit: string;
  per_txn_max: string;
  scope: string[];
  expiry_days: number;
}

export interface ConsentResponse {
  consent_id: string;
  user_id: string;
  merchant_id: string;
  spend_limit: string;
  spend_used: string;
  per_txn_max: string;
  scope: string[];
  expiry: string;
  status: ConsentStatus;
  integrity_hash: string;
  integrity_valid: boolean;
  created_at: string;
  revoked_at: string | null;
}

export interface ConsentRevokeResponse {
  consent_id: string;
  status: ConsentStatus;
  revoked_at: string | null;
}

export type ActionType =
  | "consent_check"
  | "order_created"
  | "payment_captured"
  | "payment_failed"
  | "retry_attempted"
  | "merchant_notified"
  | "revocation_processed"
  | "race_condition_detected"
  | "integrity_violation";

export interface AuditLogEntry {
  log_id: string;
  consent_id: string;
  action_type: ActionType;
  reasoning: string;
  structured_payload: Record<string, unknown>;
  timestamp: string;
}

export interface AuditTrailResponse {
  consent_id: string;
  entry_count: number;
  entries: AuditLogEntry[];
}

export interface ExecuteTransactionRequest {
  consent_id: string;
  amount: string;
  sku_category: string;
  idempotency_key: string;
  simulate_delay_ms?: number;
}

// Mirrors backend ExecuteTransactionResponse (app/schemas.py). Note this
// is the *synchronous* response to POST /transaction/execute — status is
// "pending" (a real Razorpay order was created, awaiting checkout +
// webhook) or "denied" (rejected before any order was created). It is
// never "captured" here — capture shows up later via
// GET /transaction/{id}/status, after webhook delivery or verified
// Checkout.js confirmation.
export interface ExecuteTransactionResponse {
  transaction_id: string | null;
  status: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  amount?: string | null;
  reason?: string | null;
  reasoning: string;
  consent_remaining?: string | null;
}

export interface ConfirmPaymentRequest {
  transaction_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface TransactionAttempt {
  attempt: number;
  razorpay_order_id?: string | null;
  status: string;
  error_reason?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  razorpay_payment_id?: string | null;
}

export interface TransactionStatusResponse {
  transaction_id: string;
  consent_id: string;
  status: string;
  amount: string;
  sku_category: string;
  attempt_count: number;
  max_attempts: number;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  attempts: TransactionAttempt[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
