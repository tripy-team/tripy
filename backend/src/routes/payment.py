"""
Payment Routes — Stripe integration for Tripy service fees.

Pricing (per-destination):
  - 2 destinations (origin + 1 stop):  $12.00
  - Each additional stop:             +$4.00

Promo/coupon codes are validated via the Stripe Promotion Codes API.
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..utils.jwt_auth import get_current_user_id, get_user_or_anon_id
from ..utils.secrets_manager import secrets
from ..services import solo_trip_service


def _get_anon_session_id(request: Request) -> str | None:
    """Extract anonymous session ID from request header, if present."""
    return request.headers.get("X-Anon-Session-Id")


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payment", tags=["payment"])


# ---------------------------------------------------------------------------
# Stripe configuration
# ---------------------------------------------------------------------------
# Read lazily via the secrets manager so keys resolve from AWS Secrets Manager
# in production and from .env / os.environ in local development.
def _get_stripe_key() -> str:
    if not stripe.api_key:
        stripe.api_key = secrets.get("STRIPE_SECRET_KEY", "") or ""
    return stripe.api_key or ""


def _get_webhook_secret() -> str:
    return secrets.get("STRIPE_WEBHOOK_SECRET", "") or ""


# ---------------------------------------------------------------------------
# Pricing: per-destination model (amounts in cents for Stripe)
#   Base: 2 destinations (origin + 1 stop) = $12.00
#   Each additional stop beyond the first   = +$4.00
#
#   Examples:
#     EWR → CDG (round-trip)         = 2 destinations = $12
#     EWR → CDG → FCO (round-trip)   = 3 destinations = $12
#     EWR → CDG → FCO → LHR          = 4 destinations = $16
# ---------------------------------------------------------------------------
BASE_PRICE_CENTS = 1200  # $12.00 for 2 destinations
EXTRA_STOP_CENTS = 400  # $4.00 per additional stop

# ---------------------------------------------------------------------------
# Promo codes — validated via Stripe Promotion Codes API.
# Create coupons + promotion codes in the Stripe Dashboard; this code
# looks them up at runtime so there's no in-memory state to maintain.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class CalculateFeeRequest(BaseModel):
    trip_id: str


class CalculateFeeResponse(BaseModel):
    trip_id: str
    destination_count: int  # total airports (origin + destinations)
    label: str  # e.g. "2 destinations" or "4 destinations"
    amount: int  # cents
    display_amount: str  # e.g. "$8.00"
    currency: str


class ValidatePromoRequest(BaseModel):
    trip_id: str
    promo_code: str


class ValidatePromoResponse(BaseModel):
    valid: bool
    code: Optional[str] = None
    description: Optional[str] = None
    original_amount: int = 0
    discount_amount: int = 0
    final_amount: int = 0
    final_display: str = "$0.00"
    message: str = ""


class CreatePaymentIntentRequest(BaseModel):
    trip_id: str
    promo_code: Optional[str] = None


class CreatePaymentIntentResponse(BaseModel):
    client_secret: str
    payment_intent_id: str
    amount: int
    currency: str


class ConfirmFreeRequest(BaseModel):
    trip_id: str
    promo_code: str


class ConfirmFreeResponse(BaseModel):
    ok: bool
    message: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _calculate_price(trip: dict) -> tuple[int, int]:
    """
    Calculate service fee from trip destinations.
    Returns (amount_cents, destination_count).

    Destination count = origin (1) + number of unique destinations.
    For round-trips the return to origin doesn't add an extra charge.

    Pricing:
      2 destinations = $8.00 (base)
      Each additional = +$4.00
    """
    destinations = trip.get("destinations", [])
    # Count = origin + destinations (the return leg for round-trip is free)
    dest_count = 1 + len(destinations)  # at least 2 (origin + 1 dest)
    dest_count = max(dest_count, 2)  # floor at 2

    extra_stops = max(dest_count - 2, 0)
    amount = BASE_PRICE_CENTS + (extra_stops * EXTRA_STOP_CENTS)
    return amount, dest_count


def _apply_promo(base_amount: int, code: str) -> tuple[bool, int, str]:
    """
    Validate a promotion code via Stripe and calculate the discount.
    Returns (valid, discount_cents, message).

    Looks up the customer-facing code string using stripe.PromotionCode.list(),
    then retrieves the linked Coupon to compute the discount against base_amount.
    """
    key = _get_stripe_key()
    if not key:
        logger.error("[PROMO] No Stripe API key configured.")
        return False, 0, "Payment system not configured. Please try again later."

    cleaned = code.strip().upper()
    logger.info(f"[PROMO] Validating code '{cleaned}' against base amount {base_amount}")

    try:
        promo_codes = stripe.PromotionCode.list(code=cleaned, active=True, limit=1)
        logger.info(f"[PROMO] Stripe returned {len(promo_codes.data)} result(s) for '{cleaned}'")
    except Exception as e:
        logger.error(f"[PROMO] Stripe API error for '{cleaned}': {type(e).__name__}: {e}")
        return False, 0, "Unable to validate promo code. Please try again."

    if not promo_codes.data:
        return False, 0, "Invalid or expired promo code."

    promo = promo_codes.data[0]
    if not promo.get("active"):
        return False, 0, "This promo code is no longer active."

    max_red = promo.get("max_redemptions")
    if max_red and promo.get("times_redeemed", 0) >= max_red:
        return False, 0, "This promo code has been fully redeemed."

    # Retrieve the coupon separately — avoids attribute-access issues in stripe v8+
    coupon_ref = promo.get("coupon")
    if not coupon_ref:
        logger.error(f"[PROMO] No coupon attached to promotion code '{cleaned}'")
        return False, 0, "Invalid coupon configuration."

    try:
        coupon_id = coupon_ref if isinstance(coupon_ref, str) else coupon_ref.get("id", coupon_ref)
        coupon = stripe.Coupon.retrieve(coupon_id)
    except Exception as e:
        logger.error(f"[PROMO] Failed to retrieve coupon for '{cleaned}': {type(e).__name__}: {e}")
        return False, 0, "Unable to validate promo code. Please try again."

    if not coupon.get("valid", True):
        return False, 0, "The coupon for this code has expired."

    percent_off = coupon.get("percent_off")
    amount_off = coupon.get("amount_off")

    if percent_off:
        discount = int(base_amount * percent_off / 100)
        logger.info(f"[PROMO] '{cleaned}' → {percent_off}% off → discount {discount}¢")
    elif amount_off:
        discount = min(amount_off, base_amount)
        logger.info(f"[PROMO] '{cleaned}' → {amount_off}¢ off → discount {discount}¢")
    else:
        return False, 0, "Invalid coupon configuration."

    name = coupon.get("name") or promo.get("code") or "Promo applied!"
    return True, discount, name


def _get_trip_or_404(
    trip_id: str, user_id: str, anon_session_id: str | None = None
) -> dict:
    """
    Fetch trip from DynamoDB or raise 404.

    Supports fallback: if the authenticated user_id doesn't match the trip's
    createdBy, we also try the anon_session_id (from the X-Anon-Session-Id header).
    This handles the case where a trip was created anonymously, the user signed in,
    but session migration hasn't completed yet.
    """
    try:
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
    except PermissionError:
        # Fallback: try with the anonymous session ID
        if anon_session_id and anon_session_id.startswith("anon_"):
            try:
                trip = solo_trip_service.get_solo_trip(trip_id, anon_session_id)
                if trip:
                    logger.info(
                        f"Trip {trip_id} accessed via anon fallback (user={user_id}, anon={anon_session_id}). "
                        "Session migration may not have completed."
                    )
                    return trip
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized for this trip.")
    except ValueError:
        raise HTTPException(status_code=404, detail="Trip not found.")
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return trip


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/calculate-fee", response_model=CalculateFeeResponse)
async def calculate_fee(
    request: CalculateFeeRequest,
    raw_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """Return the service fee based on destination count."""
    anon_id = _get_anon_session_id(raw_request)
    trip = _get_trip_or_404(request.trip_id, user_id, anon_session_id=anon_id)
    amount, dest_count = _calculate_price(trip)

    return CalculateFeeResponse(
        trip_id=request.trip_id,
        destination_count=dest_count,
        label=f"{dest_count} destination{'s' if dest_count != 1 else ''}",
        amount=amount,
        display_amount=f"${amount / 100:.2f}",
        currency="usd",
    )


@router.post("/validate-promo", response_model=ValidatePromoResponse)
async def validate_promo(
    request: ValidatePromoRequest,
    raw_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """Validate a promo code and preview the discount."""
    try:
        anon_id = _get_anon_session_id(raw_request)
        trip = _get_trip_or_404(request.trip_id, user_id, anon_session_id=anon_id)
        base, _ = _calculate_price(trip)

        valid, discount, msg = _apply_promo(base, request.promo_code)
        final = max(base - discount, 0)

        return ValidatePromoResponse(
            valid=valid,
            code=request.promo_code.strip().upper() if valid else None,
            description=msg if valid else None,
            original_amount=base,
            discount_amount=discount if valid else 0,
            final_amount=final if valid else base,
            final_display=f"${final / 100:.2f}" if valid else f"${base / 100:.2f}",
            message=msg,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PROMO] Unexpected error in validate_promo: {type(e).__name__}: {e}")
        return ValidatePromoResponse(
            valid=False,
            message="Something went wrong validating your code. Please try again.",
        )


@router.post("/create-intent", response_model=CreatePaymentIntentResponse)
async def create_payment_intent(
    request: CreatePaymentIntentRequest,
    raw_request: Request,
    user_id: str = Depends(get_current_user_id),  # Must be authenticated
):
    """Create a Stripe PaymentIntent for the service fee."""
    if not _get_stripe_key():
        raise HTTPException(
            status_code=500,
            detail="Stripe is not configured. Set STRIPE_SECRET_KEY in the environment.",
        )

    anon_id = _get_anon_session_id(raw_request)
    trip = _get_trip_or_404(request.trip_id, user_id, anon_session_id=anon_id)
    base, dest_count = _calculate_price(trip)

    # Apply promo if provided
    final_amount = base
    if request.promo_code:
        valid, discount, _ = _apply_promo(base, request.promo_code)
        if valid:
            final_amount = max(base - discount, 0)

    if final_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Amount is $0 after promo. Use /payment/confirm-free instead.",
        )

    try:
        intent = stripe.PaymentIntent.create(
            amount=final_amount,
            currency="usd",
            metadata={
                "trip_id": request.trip_id,
                "user_id": user_id,
                "destinations": str(dest_count),
                "promo_code": request.promo_code or "",
            },
            automatic_payment_methods={"enabled": True},
        )
    except stripe.StripeError as e:
        logger.error(f"Stripe error creating PaymentIntent: {e}")
        raise HTTPException(status_code=502, detail="Payment provider error.")

    return CreatePaymentIntentResponse(
        client_secret=intent.client_secret,
        payment_intent_id=intent.id,
        amount=final_amount,
        currency="usd",
    )


@router.post("/confirm-free", response_model=ConfirmFreeResponse)
async def confirm_free_payment(
    request: ConfirmFreeRequest,
    raw_request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """
    Confirm a $0 payment (100% promo discount).
    Marks trip as instructions_unlocked with a free payment proof.
    """
    anon_id = _get_anon_session_id(raw_request)
    trip = _get_trip_or_404(request.trip_id, user_id, anon_session_id=anon_id)
    base, _ = _calculate_price(trip)

    valid, discount, msg = _apply_promo(base, request.promo_code)
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    final = max(base - discount, 0)
    if final > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Promo does not cover the full amount (${final / 100:.2f} remaining). Use Stripe payment.",
        )

    # Mark trip as paid
    payment_proof = {
        "provider": "promo",
        "status": "succeeded",
        "promo_code": request.promo_code.strip(),
        "amount": 0,
        "currency": "usd",
        "paid_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        solo_trip_service.update_solo_trip_status(
            request.trip_id,
            "instructions_unlocked",
            user_id,
            payment_proof=payment_proof,
        )
    except Exception as e:
        logger.error(f"Error unlocking trip after free payment: {e}")
        raise HTTPException(status_code=500, detail="Failed to unlock trip.")

    return ConfirmFreeResponse(ok=True, message="Trip unlocked with promo code!")


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events (payment_intent.succeeded, etc.).
    Configure this endpoint in Stripe Dashboard → Webhooks.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    webhook_secret = _get_webhook_secret()
    if not webhook_secret or webhook_secret == "whsec_your_secret_here":
        logger.warning("Stripe webhook secret not configured. Skipping verification.")
        raise HTTPException(status_code=400, detail="Webhook secret not configured.")

    # Ensure Stripe API key is loaded for any follow-up Stripe calls
    _get_stripe_key()

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload.")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature.")

    # Handle the event
    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        trip_id = intent["metadata"].get("trip_id")
        user_id = intent["metadata"].get("user_id")
        promo_code = intent["metadata"].get("promo_code", "")

        if trip_id and user_id:
            payment_proof = {
                "provider": "stripe",
                "status": "succeeded",
                "payment_intent_id": intent["id"],
                "promo_code": promo_code,
                "amount": intent["amount"],
                "currency": intent["currency"],
                "paid_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                solo_trip_service.update_solo_trip_status(
                    trip_id,
                    "instructions_unlocked",
                    user_id,
                    payment_proof=payment_proof,
                )
                logger.info(f"Trip {trip_id} unlocked via Stripe webhook.")
            except Exception as e:
                logger.error(f"Webhook: failed to unlock trip {trip_id}: {e}")

    return {"ok": True}
