'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  CheckCircle, 
  CreditCard, 
  Sparkles,
  MapPin,
  Calendar,
  Zap
} from 'lucide-react';
import { generateItinerary } from '@/lib/api';

export default function SoloPayment() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('tripId') || '';
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promo Code State
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState('');

  const handleApplyPromo = () => {
    if (promoCode.toUpperCase() === 'TRIPY2025') {
      setDiscount(10);
      setPromoMessage('Code applied successfully!');
    } else {
      setDiscount(0);
      setPromoMessage('Invalid promo code');
    }
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Generate itinerary after payment
      if (tripId) {
        await generateItinerary(tripId);
      }
      
      setIsProcessing(false);
      setIsPaid(true);
      
      // Redirect to results after success
      setTimeout(() => {
        router.push(`/solo/results?trip_id=${tripId}`);
      }, 1500);
    } catch (err) {
      console.error('Error processing payment:', err);
      setIsProcessing(false);
      const msg = err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.';
      setError(msg);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Finalize Trip Plan</h1>
          <p className="text-slate-500 mt-2">Unlock your personalized, optimized travel strategy.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Value Proposition */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Savings Highlight */}
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-900/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-blue-100 mb-1">
                <Sparkles className="w-5 h-5" />
                <span className="font-medium">Estimated Savings</span>
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-bold">$1,240</span>
                <span className="text-blue-200">saved vs cash</span>
              </div>
              <div className="grid grid-cols-2 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                <div>
                  <div className="text-blue-200 text-sm">Avg. Cash Price</div>
                  <div className="text-xl font-semibold line-through opacity-70">$3,400</div>
                </div>
                <div>
                  <div className="text-blue-200 text-sm">Your Points Value</div>
                  <div className="text-xl font-semibold text-white">~ $2,160</div>
                </div>
              </div>
              <p className="mt-4 text-sm text-blue-100 opacity-90">
                * We optimize transfers to get you 2-3x more value per point.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Your Trip Configuration</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl">
                <div className="p-2 bg-white rounded-lg border border-slate-200">
                  <Calendar className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Duration</div>
                  <div className="text-sm text-slate-600">7 Days</div>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl">
                <div className="p-2 bg-white rounded-lg border border-slate-200">
                  <MapPin className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Destinations</div>
                  <div className="text-sm text-slate-600">Multiple Cities</div>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl">
                <div className="p-2 bg-white rounded-lg border border-slate-200">
                  <Zap className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Points Budget</div>
                  <div className="text-sm text-slate-600">Optimized</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Payment */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg sticky top-8">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Payment Details</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-slate-600">
                  <span>Planning Fee</span>
                  <span className="font-medium text-slate-900">$29.00</span>
                </div>

                {/* Promo Code Input */}
                <div className="pt-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value);
                        setPromoMessage('');
                      }}
                      placeholder="Promo Code"
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent uppercase placeholder:normal-case"
                    />
                    <button
                      onClick={handleApplyPromo}
                      disabled={!promoCode}
                      className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Apply
                    </button>
                  </div>
                  {promoMessage && (
                    <div className={`text-xs mt-1.5 ${discount > 0 ? 'text-green-600 font-medium' : 'text-red-500'}`}>
                      {promoMessage}
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-green-600 text-sm mt-2 font-medium">
                      <span>Discount</span>
                      <span>-${discount.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 my-4 pt-4 flex justify-between items-center">
                  <span className="font-semibold text-slate-900">Total Due</span>
                  <span className="text-xl font-bold text-slate-900">${(29 - discount).toFixed(2)}</span>
                </div>
              </div>

              {!isPaid ? (
                <div className="space-y-4">
                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-800 font-medium">Could not generate itinerary</p>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                      <p className="text-xs text-red-600 mt-2">
                        Try using a nearby major airport as your start (e.g. Syracuse SYR or New York JFK instead of a small regional).
                      </p>
                    </div>
                  )}
                  <button
                    onClick={handlePayment}
                    disabled={isProcessing}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>Processing...</>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" /> Pay & View Results
                      </>
                    )}
                  </button>
                  <div className="flex justify-center gap-2 text-slate-400">
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Payment Successful!</h3>
                  <p className="text-sm text-slate-600">
                    Optimizing your itinerary...
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
