'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import {
  CreditCard,
  Shield,
  CheckCircle,
  Loader2,
  Tag,
  ArrowLeft,
  Plane,
  Sparkles,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { solo, payment, isAuthenticated, getAnonSessionId, type SoloTripResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// Stripe loader — singleton so we only load once
// ---------------------------------------------------------------------------
const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise && stripePublishableKey) {
    stripePromise = loadStripe(stripePublishableKey);
  }
  return stripePromise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FeeInfo {
  tripId: string;
  destinationCount: number;
  label: string;
  amount: number;       // cents
  displayAmount: string;
  currency: string;
}

interface PromoState {
  code: string;
  valid: boolean;
  discountAmount: number;
  finalAmount: number;
  finalDisplay: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Stripe Checkout Form (rendered inside <Elements>)
// ---------------------------------------------------------------------------
function CheckoutForm({
  tripId,
  onSuccess,
}: {
  tripId: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || processing) return;

    setProcessing(true);
    setError(null);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message || 'Validation failed.');
        return;
      }

      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/solo/booking?trip_id=${tripId}&payment=success`,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        setError(confirmError.message || 'Payment failed. Please try again.');
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        // Also update trip status client-side as a fallback (webhook is primary)
        try {
          await solo.updateStatus(tripId, 'instructions_unlocked', {
            provider: 'stripe',
            status: 'succeeded',
            payment_intent_id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            paid_at: new Date().toISOString(),
          });
        } catch {
          // Webhook will handle it
        }
        onSuccess();
      } else if (paymentIntent?.status === 'requires_action') {
        // 3D Secure or additional authentication is needed — Stripe handles the
        // redirect automatically when redirect: 'if_required' is set.
        // If we reach here without a redirect, it means the action couldn't
        // be completed inline.
        setError('Additional authentication is required. Please try again.');
      } else {
        setError('Payment was not completed. Please try again.');
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: 'tabs',
        }}
        onReady={() => setReady(true)}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !ready || processing}
        className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20"
      >
        {processing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </>
        ) : !ready ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading...
          </>
        ) : (
          <>
            <Lock className="w-5 h-5" />
            Pay Now
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
        <Shield className="w-3.5 h-3.5" />
        <span>Secured by Stripe. Your payment info never touches our servers.</span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Payment Page Content (inside Suspense)
// ---------------------------------------------------------------------------
function PaymentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  // State
  const [trip, setTrip] = useState<SoloTripResponse | null>(null);
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<PromoState | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [freeProcessing, setFreeProcessing] = useState(false);

  // Effective amount after promo
  const effectiveAmount = promo?.valid ? promo.finalAmount : (feeInfo?.amount ?? 0);
  const effectiveDisplay = promo?.valid ? promo.finalDisplay : (feeInfo?.displayAmount ?? '$0.00');

  // Auth check — redirect to login if not signed in
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isAuthenticated()) {
      const returnUrl = `/solo/payment?trip_id=${tripId}`;
      router.replace(`/login?redirect=${encodeURIComponent(returnUrl)}`);
    }
  }, [router, tripId]);

  // Load trip + fee info (with anonymous session migration retry)
  useEffect(() => {
    if (!tripId || !isAuthenticated()) return;

    (async () => {
      // Helper to load trip and fee data
      const loadData = async () => {
        const [tripResult, feeResult] = await Promise.allSettled([
          solo.getTrip(tripId),
          payment.calculateFee(tripId),
        ]);

        const tripOk = tripResult.status === 'fulfilled' ? tripResult.value : null;
        const feeOk = feeResult.status === 'fulfilled' ? feeResult.value : null;

        return { tripOk, feeOk, tripErr: tripResult.status === 'rejected' ? tripResult.reason : null, feeErr: feeResult.status === 'rejected' ? feeResult.reason : null };
      };

      try {
        let { tripOk, feeOk, tripErr, feeErr } = await loadData();

        // If we got a 403, try migrating the anonymous session first, then retry
        const is403 = (err: unknown) => err instanceof Error && err.message.includes('Not authorized');
        if ((tripErr && is403(tripErr)) || (feeErr && is403(feeErr))) {
          try {
            const anonId = getAnonSessionId();
            if (anonId) {
              console.log('[Payment] Trip access denied — attempting anonymous session migration...');
              await solo.migrateSession(anonId);
              // Retry after migration
              const retry = await loadData();
              tripOk = retry.tripOk;
              feeOk = retry.feeOk;
              tripErr = retry.tripErr;
              feeErr = retry.feeErr;
            }
          } catch (migrationErr) {
            console.warn('[Payment] Session migration failed:', migrationErr);
          }
        }

        if (tripOk) setTrip(tripOk);
        if (feeOk) setFeeInfo(feeOk);

        // Set error if we still couldn't load critical data
        if (!tripOk || !feeOk) {
          const errMsg = tripErr?.message || feeErr?.message || 'Failed to load payment data.';
          console.error('Failed to load payment data:', tripErr || feeErr);
          setLoadError(errMsg);
        }
      } catch (err) {
        console.error('Failed to load payment data:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load payment data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId]);

  // Error from creating the PaymentIntent (shown in the payment section)
  const [intentError, setIntentError] = useState<string | null>(null);

  // Create PaymentIntent when we know the final amount
  const createIntent = useCallback(async (promoCode?: string) => {
    if (!tripId) return;
    setIntentError(null);
    try {
      const intentData = await payment.createIntent(tripId, promoCode);
      setClientSecret(intentData.clientSecret);
    } catch (err) {
      console.error('Failed to create payment intent:', err);
      setIntentError(err instanceof Error ? err.message : 'Failed to initialize payment. Please refresh and try again.');
    }
  }, [tripId]);

  // Create initial payment intent once fee is loaded (no promo)
  useEffect(() => {
    if (feeInfo && feeInfo.amount > 0 && !clientSecret && !promo?.valid) {
      createIntent();
    }
  }, [feeInfo, clientSecret, createIntent, promo]);

  // Apply promo code
  const handleApplyPromo = async () => {
    if (!promoInput.trim() || !tripId) return;
    setPromoLoading(true);
    setPromoError(null);

    try {
      const result = await payment.validatePromo(tripId, promoInput.trim());
      if (result.valid) {
        setPromo({
          code: result.code || promoInput.trim().toUpperCase(),
          valid: true,
          discountAmount: result.discountAmount,
          finalAmount: result.finalAmount,
          finalDisplay: result.finalDisplay,
          description: result.description || '',
        });

        // If there's still a charge, create a new PaymentIntent with the promo
        if (result.finalAmount > 0) {
          setClientSecret(null); // reset
          await createIntent(result.code || promoInput.trim());
        } else {
          // $0 — no Stripe needed
          setClientSecret(null);
        }
      } else {
        setPromoError(result.message || 'Invalid promo code.');
        setPromo(null);
      }
    } catch {
      setPromoError('Failed to validate promo code.');
      setPromo(null);
    } finally {
      setPromoLoading(false);
    }
  };

  // Remove promo
  const handleRemovePromo = () => {
    setPromo(null);
    setPromoInput('');
    setPromoError(null);
    setClientSecret(null);
    // Re-create intent at full price
    if (feeInfo && feeInfo.amount > 0) {
      createIntent();
    }
  };

  // Confirm $0 payment
  const handleConfirmFree = async () => {
    if (!promo?.code || !tripId) return;
    setFreeProcessing(true);
    try {
      await payment.confirmFree(tripId, promo.code);
      setPaymentSuccess(true);
    } catch (err) {
      console.error('Free confirmation failed:', err);
      setPromoError('Failed to apply promo. Please try again.');
    } finally {
      setFreeProcessing(false);
    }
  };

  // Success → redirect to booking
  const handleSuccess = useCallback(() => {
    setPaymentSuccess(true);
  }, []);

  // Auto-redirect on success
  useEffect(() => {
    if (paymentSuccess) {
      const timer = setTimeout(() => {
        router.push(`/solo/booking?trip_id=${tripId}&payment=success`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [paymentSuccess, router, tripId]);

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-slate-600">Loading payment details...</p>
        </div>
      </div>
    );
  }

  // Error state — show a clear message and retry option
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Unable to Load Payment</h1>
          <p className="text-slate-600 mb-6 text-sm">
            {loadError.includes('Not authorized')
              ? 'We couldn\'t verify your access to this trip. This can happen if you created the trip before signing in. Please try again or go back to results.'
              : loadError}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                // Trigger re-load by re-mounting
                window.location.reload();
              }}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => router.back()}
              className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Back to Results
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Payment success state
  if (paymentSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-emerald-50/30 to-white">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Payment Successful!</h1>
          <p className="text-slate-600 mb-6">
            Your booking instructions are being unlocked. Redirecting you now...
          </p>
          <Loader2 className="w-5 h-5 animate-spin text-blue-600 mx-auto" />
        </div>
      </div>
    );
  }

  // Route display
  const routeDisplay = trip
    ? [trip.origin, ...trip.destinations, ...(trip.tripType === 'round_trip' ? [trip.origin] : [])].join(' → ')
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* Back link */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to results
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-600/20">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Unlock Your Booking Plan</h1>
          <p className="text-slate-600 max-w-md mx-auto">
            Get step-by-step transfer instructions, booking links, and price drop monitoring.
          </p>
        </div>

        <div className="space-y-6">
          {/* Order Summary Card */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-600" />
                Order Summary
              </h2>

              {/* Trip info */}
              {trip && (
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl mb-4">
                  <Plane className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{trip.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{routeDisplay}</p>
                    {trip.startDate && trip.endDate && (
                      <p className="text-sm text-slate-500 mt-0.5">{trip.startDate} — {trip.endDate}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Fee line items */}
              {feeInfo && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      Tripy Planning Fee
                      <span className="ml-1.5 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        {feeInfo.label}
                      </span>
                      {feeInfo.destinationCount > 2 && (
                        <span className="ml-1 text-xs text-slate-500">
                          ($12 base + ${(feeInfo.destinationCount - 2) * 4} for {feeInfo.destinationCount - 2} extra stop{feeInfo.destinationCount - 2 > 1 ? 's' : ''})
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-slate-900">{feeInfo.displayAmount}</span>
                  </div>

                  {/* Promo discount */}
                  {promo?.valid && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-emerald-700 flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5" />
                        Promo: {promo.code}
                        <button
                          onClick={handleRemovePromo}
                          className="ml-1 text-xs text-slate-400 hover:text-red-500 underline"
                        >
                          remove
                        </button>
                      </span>
                      <span className="font-medium text-emerald-700">
                        −${(promo.discountAmount / 100).toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                    <span className="font-semibold text-slate-900">Total</span>
                    <span className="text-xl font-bold text-slate-900">{effectiveDisplay}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Promo Code Input */}
          {!promo?.valid && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Have a promo code?
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value.toUpperCase());
                    setPromoError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyPromo()}
                  placeholder="Enter code"
                  className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-400"
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={!promoInput.trim() || promoLoading}
                  className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {promoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  Apply
                </button>
              </div>
              {promoError && (
                <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {promoError}
                </p>
              )}
            </div>
          )}

          {/* Payment Section */}
          {effectiveAmount > 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-blue-600" />
                Payment Details
              </h2>

              {intentError ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{intentError}</span>
                  </div>
                  <button
                    onClick={() => { setIntentError(null); createIntent(promo?.code); }}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : clientSecret && getStripe() ? (
                <Elements
                  stripe={getStripe()}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#2563eb',
                        borderRadius: '12px',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                      },
                    },
                  }}
                >
                  <CheckoutForm tripId={tripId} onSuccess={handleSuccess} />
                </Elements>
              ) : clientSecret && !getStripe() ? (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Payment system failed to load. Please refresh the page.</span>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-slate-600 text-sm">Preparing payment form...</span>
                </div>
              )}
            </div>
          ) : promo?.valid && effectiveAmount === 0 ? (
            /* $0 payment — promo covers everything */
            <div className="bg-white border-2 border-emerald-200 rounded-2xl p-6 shadow-sm">
              <div className="text-center">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  Your promo covers the full amount!
                </h3>
                <p className="text-sm text-slate-600 mb-6">
                  No payment required. Click below to unlock your plan.
                </p>
                <button
                  onClick={handleConfirmFree}
                  disabled={freeProcessing}
                  className="w-full max-w-xs mx-auto flex items-center justify-center gap-2 px-6 py-4 bg-emerald-600 text-white rounded-xl font-semibold text-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-600/20"
                >
                  {freeProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Unlocking...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Unlock My Plan — Free
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* What you get */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
            <h3 className="font-semibold text-blue-900 mb-3">What you get:</h3>
            <ul className="space-y-2.5">
              {[
                'Step-by-step points transfer instructions',
                'Direct booking links for each flight',
                'Detailed cost breakdown with savings analysis',
                'Free price drop monitoring via email',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
                  <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper with Suspense
// ---------------------------------------------------------------------------
export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <PaymentPageContent />
    </Suspense>
  );
}
