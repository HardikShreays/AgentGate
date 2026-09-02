import { confirmPayment, getTransactionStatus } from "./api";
import { ApiError, TransactionStatusResponse } from "./types";

const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

interface OpenCheckoutArgs {
  transactionId: string;
  razorpayOrderId: string;
  description?: string;
  onStatus: (status: TransactionStatusResponse) => void;
  onNote: (note: string) => void;
}

// Shared Razorpay Checkout flow: open the modal for a `pending` order, then
// settle the transaction via the verified /transaction/confirm callback (or
// fall back to polling GET /transaction/{id}/status if that fails or the
// modal is dismissed). Used by both the dashboard execute panel and the
// buyer-agent chat, so the agent path is genuinely end-to-end rather than
// dead-ending at `pending`.
// ponytail: ExecuteTransactionPanel still has its own inline copy wired to
// its local React state — fold it into this once the demo's recorded.
export function openCheckout({
  transactionId,
  razorpayOrderId,
  description,
  onStatus,
  onNote,
}: OpenCheckoutArgs): void {
  if (!RAZORPAY_KEY_ID) {
    onNote(
      "NEXT_PUBLIC_RAZORPAY_KEY_ID isn't set, so the checkout modal can't open — " +
        `add it to frontend/.env.local and reload. The real order was still created: ${razorpayOrderId}.`
    );
    return;
  }
  if (typeof window === "undefined" || !window.Razorpay) {
    onNote("Razorpay Checkout.js hasn't finished loading yet — try again in a moment.");
    return;
  }

  const poll = (attempt = 0) => {
    getTransactionStatus(transactionId)
      .then((status) => {
        onStatus(status);
        if (status.status === "pending" && attempt < 12) {
          setTimeout(() => poll(attempt + 1), 1500);
        }
      })
      .catch(() => {
        if (attempt < 12) setTimeout(() => poll(attempt + 1), 1500);
      });
  };

  const rzp = new window.Razorpay({
    key: RAZORPAY_KEY_ID,
    order_id: razorpayOrderId,
    name: "AgentGate — Test Mode",
    description: description ?? "Agent purchase",
    theme: { color: "#3395FF" },
    handler: async (payment) => {
      try {
        const status = await confirmPayment({
          transaction_id: transactionId,
          razorpay_order_id: payment.razorpay_order_id,
          razorpay_payment_id: payment.razorpay_payment_id,
          razorpay_signature: payment.razorpay_signature,
        });
        onStatus(status);
        onNote("Payment signature verified server-side; transaction marked captured.");
      } catch (e) {
        onNote(
          e instanceof ApiError
            ? `Checkout returned, but server confirmation failed: ${e.message}. Polling webhook status.`
            : "Checkout returned, but server confirmation failed. Polling webhook status."
        );
        poll();
      }
    },
    modal: { ondismiss: () => poll() },
  });
  rzp.open();
}
