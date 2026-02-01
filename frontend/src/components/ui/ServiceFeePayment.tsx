'use client';

/**
 * ServiceFeePayment Component
 * 
 * Payment gate for unlocking booking instructions.
 * GTM Fix: mockPayment prop clearly marks test mode. No "secure payment" claims.
 */

import { useState } from 'react';
import { CheckCircle, Sparkles, AlertTriangle, Lock, Unlock } from 'lucide-react';

// Payment proof stored in trip metadata (P15 fix: store payment evidence)
interface PaymentProof {
  provider: 'mock' | 'stripe';
  status: string;
  paymentIntentId?: string;  // Stripe payment intent ID
  paidAt: string;            // ISO timestamp
  amount: number;
  currency: string;
}

interface ServiceFeePaymentProps {
  tripId: string;
  feeAmount: number;
  savingsAmount: number;
  onSuccess: () => void;
  /** Set to true for internal testing only */
  mockPayment?: boolean;
}

export function ServiceFeePayment({ 
  tripId, 
  feeAmount, 
  savingsAmount, 
  onSuccess,
  mockPayment = false  // Default to real payment
}: ServiceFeePaymentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePayment = async () => {
    setIsProcessing(true);
    setError(null);
    
    try {
      let paymentProof: PaymentProof;
      
      if (mockPayment) {
        // MOCK PAYMENT - for internal testing only
        console.warn('[DEV] Using mock payment - do not ship to production');
        await new Promise(resolve => setTimeout(resolve, 1500));
        paymentProof = {
          provider: 'mock',
          status: 'succeeded',
          paidAt: new Date().toISOString(),
          amount: feeAmount,
          currency: 'usd',
        };
      } else {
        // TODO: Real Stripe payment integration
        // const paymentIntent = await createPaymentIntent(tripId, feeAmount);
        // const result = await stripe.confirmPayment(paymentIntent);
        // paymentProof = {
        //   provider: 'stripe',
        //   status: result.paymentIntent.status,
        //   paymentIntentId: result.paymentIntent.id,
        //   paidAt: new Date().toISOString(),
        //   amount: feeAmount,
        //   currency: 'usd',
        // };
        throw new Error('Real payment not yet implemented');
      }
      
      // Update trip status to instructions_unlocked WITH payment proof
      const token = typeof window !== 'undefined' 
        ? (sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))
        : null;
        
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/solo/trips/${tripId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          status: 'instructions_unlocked',
          payment_proof: paymentProof,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to unlock instructions');
      }
      
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const valueMultiplier = feeAmount > 0 ? Math.round(savingsAmount / feeAmount) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">Unlock Booking Instructions</h2>
      </div>

      <div className="p-6 space-y-6">
        {/* Mock payment warning - only shown in dev */}
        {mockPayment && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800">
              <strong>Internal testing mode.</strong> This is a simulated payment.
            </div>
          </div>
        )}

        {/* Value Proposition - uses REAL savings */}
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-700 mb-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold">Your Savings: ${savingsAmount.toLocaleString()}</span>
          </div>
          {valueMultiplier > 1 && (
            <p className="text-sm text-emerald-600">
              Tripy found you {valueMultiplier}x more value than the service fee.
            </p>
          )}
        </div>

        {/* What You Get - show preview of what's gated */}
        <div>
          <div className="text-sm font-medium text-slate-700 mb-3">What you'll unlock:</div>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Exact transfer amounts for each points program
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Direct links to transfer portals
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Step-by-step booking instructions
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Transfer timing tips
            </li>
          </ul>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Fee and payment button */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-600">Service fee</span>
            <span className="text-2xl font-bold text-slate-900">${feeAmount}</span>
          </div>
          
          <button
            onClick={handlePayment}
            disabled={isProcessing}
            className={`w-full py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors ${
              isProcessing
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </>
            ) : mockPayment ? (
              <>
                <Unlock className="w-5 h-5" />
                Unlock (Test Mode)
              </>
            ) : (
              <>
                <Lock className="w-5 h-5" />
                Unlock Instructions
              </>
            )}
          </button>
          
          {/* No "secure payment" claims for mock mode */}
          {!mockPayment && (
            <p className="text-xs text-slate-500 text-center mt-3">
              Payment processed securely
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ServiceFeePayment;
