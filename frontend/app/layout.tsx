import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "AgentGate — Merchant Dashboard",
  description: "Consent inspector and transaction timeline for the AgentGate trust layer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* P0-2 — loaded once, globally, so the Execute Transaction panel
            can open a real Razorpay Checkout modal (test-mode order id +
            NEXT_PUBLIC_RAZORPAY_KEY_ID) instead of sending a presenter to
            a separate tab to click Success/Failure. */}
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
        <ToastProvider>
          <Shell>{children}</Shell>
        </ToastProvider>
      </body>
    </html>
  );
}
