// Minimal ambient typing for Razorpay's Checkout.js, loaded via a plain
// <script> tag (app/layout.tsx) rather than an npm package — Razorpay
// doesn't ship first-party TS types for the client-side checkout script,
// only the server-side `razorpay` SDK (already used in the backend).

export interface RazorpayCheckoutOptions {
  key: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  order_id: string;
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

export interface RazorpayCheckoutInstance {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}
