"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { confirmPayment, executeTransaction, getTransactionStatus } from "@/lib/api";
import { ApiError, ExecuteTransactionResponse, TransactionStatusResponse } from "@/lib/types";
import { formatInr } from "@/lib/format";
import { TransactionStatusCard } from "@/components/TransactionStatusStepper";
import { CopyButton } from "@/components/CopyButton";

const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// P0-2 — replaces `curl -X POST /transaction/execute` for three
// pitch-script segments at once: happy path, bounded rejection, and
// (via the real Razorpay Checkout modal below) the failure path too.
// The endpoint itself only ever returns "denied" or "pending" — it never
// synchronously reports "captured" (see README §3's design note) — so a
// real order always routes into Checkout.js, and the eventual
// captured/failed outcome is picked up by polling GET
// /transaction/{id}/status after the modal closes, once the webhook has
// had a moment to land.
export function ExecuteTransactionPanel({
  consentId,
  defaultSkuCategory = "groceries",
  disabled,
}: {
  consentId: string;
  defaultSkuCategory?: string;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState("450");
  const [skuCategory, setSkuCategory] = useState(defaultSkuCategory);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [simulateDelayMs, setSimulateDelayMs] = useState("0");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteTransactionResponse | null>(null);
  const [checkoutNote, setCheckoutNote] = useState<string | null>(null);

  const [txStatus, setTxStatus] = useState<TransactionStatusResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIdempotencyKey(newIdempotencyKey());
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  function resetResultState() {
    setResult(null);
    setTxStatus(null);
    setCheckoutNote(null);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    resetResultState();
    setLoading(true);
    try {
      const res = await executeTransaction({
        consent_id: consentId,
        amount,
        sku_category: skuCategory.trim(),
        idempotency_key: idempotencyKey,
        simulate_delay_ms: parseInt(simulateDelayMs, 10) || 0,
      });
      setResult(res);
      setIdempotencyKey(newIdempotencyKey());

      if (res.status === "pending" && res.razorpay_order_id) {
        launchCheckout(res);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function launchCheckout(res: ExecuteTransactionResponse) {
    if (!res.razorpay_order_id) return;
    if (!RAZORPAY_KEY_ID) {
      setCheckoutNote(
        "NEXT_PUBLIC_RAZORPAY_KEY_ID isn't set, so the checkout modal can't open — " +
          "add it to frontend/.env.local (the public key ID only, never the secret) and reload. " +
          `The real order was still created: ${res.razorpay_order_id}.`
      );
      return;
    }
    if (typeof window === "undefined" || !window.Razorpay) {
      setCheckoutNote("Razorpay Checkout.js hasn't finished loading yet — try again in a moment.");
      return;
    }

    const rzp = new window.Razorpay({
      key: RAZORPAY_KEY_ID,
      order_id: res.razorpay_order_id,
      name: "AgentGate — Test Mode",
      description: `${skuCategory} · ${formatInr(res.amount ?? amount)}`,
      theme: { color: "#3395FF" },
      handler: async (payment) => {
        if (!res.transaction_id) return;
        try {
          const status = await confirmPayment({
            transaction_id: res.transaction_id,
            razorpay_order_id: payment.razorpay_order_id,
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_signature: payment.razorpay_signature,
          });
          setTxStatus(status);
          setPolling(false);
          setCheckoutNote("Payment signature verified server-side; transaction marked captured.");
        } catch (e) {
          setCheckoutNote(
            e instanceof ApiError
              ? `Checkout returned, but server confirmation failed: ${e.message}. Polling webhook status.`
              : "Checkout returned, but server confirmation failed. Polling webhook status."
          );
          startPolling(res.transaction_id);
        }
      },
      modal: {
        ondismiss: () => {
          // Covers both "clicked Failure on the mock bank page" and
          // "closed the modal" — either way, poll for whatever the
          // webhook (or FailureHandler's bounded retry) ends up recording.
          if (res.transaction_id) startPolling(res.transaction_id);
        },
      },
    });
    rzp.open();
  }

  function startPolling(transactionId: string) {
    setPolling(true);
    let attempts = 0;
    const maxAttempts = 12; // ~18s at 1.5s intervals — enough for a webhook to land locally
    const tick = async () => {
      attempts += 1;
      try {
        const status = await getTransactionStatus(transactionId);
        setTxStatus(status);
        if (status.status === "pending" && attempts < maxAttempts) {
          pollTimer.current = setTimeout(tick, 1500);
        } else {
          setPolling(false);
        }
      } catch {
        if (attempts < maxAttempts) {
          pollTimer.current = setTimeout(tick, 1500);
        } else {
          setPolling(false);
        }
      }
    };
    tick();
  }

  const denialTone = result?.status === "denied" ? toneForDenial(result.reason) : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="mb-3">
        <div className="text-sm font-semibold text-navy">Execute a transaction</div>
        <p className="mt-0.5 text-xs text-muted">
          POST /transaction/execute — approved amounts open a real Razorpay test-mode checkout.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
            Amount (₹)
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
            className="mt-1.5 w-full rounded-sm border border-border bg-surfaceMuted px-2.5 py-2 font-mono text-sm text-navy focus:border-brand focus:bg-surface"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
            SKU category
          </span>
          <input
            value={skuCategory}
            onChange={(e) => setSkuCategory(e.target.value)}
            required
            className="mt-1.5 w-full rounded-sm border border-border bg-surfaceMuted px-2.5 py-2 font-mono text-sm text-navy focus:border-brand focus:bg-surface"
          />
        </label>

        <div className="col-span-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-label text-faint transition hover:text-brand"
          >
            <span className={`inline-block transition-transform ${advancedOpen ? "rotate-90" : ""}`}>
              ›
            </span>
            Advanced
          </button>
          {advancedOpen && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-sm border border-border bg-surfaceMuted p-3">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
                  Idempotency key
                </span>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    spellCheck={false}
                    className="w-full min-w-0 rounded-sm border border-border bg-surface px-2.5 py-2 font-mono text-xs text-navy focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setIdempotencyKey(newIdempotencyKey())}
                    title="Regenerate"
                    className="shrink-0 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-navySoft hover:border-brand/50 hover:text-brand"
                  >
                    ↻
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-label text-faint">
                  simulate_delay_ms
                </span>
                <input
                  value={simulateDelayMs}
                  onChange={(e) => setSimulateDelayMs(e.target.value)}
                  inputMode="numeric"
                  className="mt-1.5 w-full rounded-sm border border-border bg-surface px-2.5 py-2 font-mono text-xs text-navy focus:border-brand"
                />
                <span className="mt-1 block text-[10px] leading-snug text-faint">
                  Only honored when the API runs with DEMO_MODE=true. For the automated
                  revocation demo, use the dedicated Live Demo page instead.
                </span>
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="col-span-2 rounded-sm border border-danger/30 bg-dangerTint px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || disabled}
          className="col-span-2 rounded-sm bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brandDark disabled:opacity-50"
        >
          {loading ? "Submitting…" : "Execute transaction"}
        </button>
      </form>

      {result && (
        <div className="mt-4 space-y-3">
          {result.status === "denied" && denialTone && (
            <div className={`rounded-sm border p-3 text-sm ${denialTone.border} ${denialTone.bg} ${denialTone.text}`}>
              <div className="text-[11px] font-semibold uppercase tracking-label">
                Denied · {result.reason}
              </div>
              <p className="mt-1 leading-relaxed">{result.reasoning}</p>
              {result.consent_remaining != null && (
                <p className="mt-1 text-xs opacity-80">
                  {formatInr(result.consent_remaining)} still remaining on this consent.
                </p>
              )}
            </div>
          )}

          {result.status === "pending" && result.razorpay_order_id && (
            <div className="rounded-sm border border-brand/30 bg-brandTint p-3 text-sm text-navy">
              <div className="text-[11px] font-semibold uppercase tracking-label text-brand">
                Real Razorpay order created
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-xs text-navySoft">
                <span className="truncate">{result.razorpay_order_id}</span>
                <CopyButton value={result.razorpay_order_id} label="Order ID" />
              </div>
              <p className="mt-1.5 leading-relaxed">{result.reasoning}</p>
              <button
                type="button"
                onClick={() => launchCheckout(result)}
                className="mt-2 rounded-sm bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brandDark"
              >
                Open Razorpay Checkout
              </button>
              {checkoutNote && <p className="mt-2 text-xs text-muted">{checkoutNote}</p>}
            </div>
          )}

          {(polling || txStatus) && (
            <div className="space-y-1.5">
              <TransactionStatusCard status={txStatus} polling={polling} />
              {result.transaction_id && (
                <Link
                  href={`/transactions/tx/${encodeURIComponent(result.transaction_id)}`}
                  className="inline-block text-[11px] font-medium text-brand hover:underline"
                >
                  View full attempt history →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toneForDenial(reason?: string | null) {
  if (reason === "revoked_mid_transaction" || reason === "revoked") {
    return { border: "border-revoked/30", bg: "bg-revokedTint", text: "text-revoked" };
  }
  return { border: "border-danger/30", bg: "bg-dangerTint", text: "text-danger" };
}
