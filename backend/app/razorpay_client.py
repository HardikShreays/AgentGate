"""
Thin wrapper around the official `razorpay` SDK (A.15), pinned to
razorpay==2.0.1. This is the real integration — no in-memory mock.

Verified live against the installed SDK (interface differs slightly from
what the plan's Appendix A.15 assumed — the plan says
`razorpay.utils.verify_webhook_signature`, but on 2.0.1 that lives at
`client.utility.verify_webhook_signature`, raising
`razorpay.errors.SignatureVerificationError` on mismatch. Confirm this
again if you bump the pinned version.)

Order creation happens here, synchronously, from the backend. Payment
CAPTURE does not happen here — the person completes checkout on
Razorpay's hosted page (test mode: Success/Failure mock bank screen),
and Razorpay calls back to POST /webhooks/razorpay with the outcome.
This module never guesses at a payment result; the webhook is the only
source of truth for capture/failure.
"""
from decimal import Decimal

import razorpay

from app.config import get_settings

settings = get_settings()


def get_client() -> razorpay.Client:
    return razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))


def create_order(client: razorpay.Client, amount: Decimal, receipt: str) -> dict:
    """amount is in rupees; Razorpay's API wants paise (A.15)."""
    return client.order.create(
        {
            "amount": int(amount * 100),
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
        }
    )


def verify_webhook_signature(client: razorpay.Client, payload_body: str, signature: str) -> bool:
    """Raises razorpay.errors.SignatureVerificationError on mismatch —
    callers should catch it and treat as a hard reject + integrity-style
    log event. Returns True on success (matches SDK's own return value)."""
    return client.utility.verify_webhook_signature(
        payload_body, signature, settings.RAZORPAY_WEBHOOK_SECRET
    )


def verify_payment_signature(
    client: razorpay.Client,
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
) -> bool:
    """Verify Checkout.js' client-side success callback signature.

    This is separate from webhook verification: the checkout callback is
    signed with the API key secret over order_id + payment_id, while
    webhooks are signed with RAZORPAY_WEBHOOK_SECRET over the raw body.
    """
    return client.utility.verify_payment_signature(
        {
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": razorpay_signature,
        }
    )
