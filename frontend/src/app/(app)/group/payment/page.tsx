'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Shield, 
  CheckCircle, 
  CreditCard, 
  Sparkles
} from 'lucide-react';
import { generateItinerary, trips } from '@/lib/api';
import { TripGenerationLoader } from '@/components/ui/TripGenerationLoader';
import { tripDurationDays, calculateServiceFee, SERVICE_FEE_PERCENT } from '@/lib/utils';

export default function GroupPayment() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [isAlreadyGenerated, setIsAlreadyGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trip, setTrip] = useState<{ startDate?: string; endDate?: string; destinations?: string[]; optimizationGenerated?: boolean; strategyPaid?: boolean } | null>(null);
  const [groupSize, setGroupSize] = useState(4);

  useEffect(() => {
    if (!tripId) return;
    trips.get(tripId).then((tripData) => {
      setTrip(tripData);
      // Check if optimization was already generated or strategy already paid
      if (tripData.optimizationGenerated || tripData.strategyPaid) {
        setIsAlreadyGenerated(true);
        setIsPaid(true);
      }
    }).catch(() => setTrip(null));
    trips.listMembers(tripId).then((r) => setGroupSize(r.members?.length || 4)).catch(() => {});
  }, [tripId]);

  // Amount spent + saved = estimated total group cash price
  const perPerson = (trip?.startDate && trip?.endDate && trip?.destinations
    ? (tripDurationDays(trip.startDate, trip.endDate) ?? 5) * 200 + (trip.destinations.length || 1) * 300
    : 5 * 200 + 1 * 300);
  const estimatedCash = perPerson * groupSize;
  const serviceFee = calculateServiceFee(estimatedCash);
  const estimatedSavings = Math.round(estimatedCash * 0.3);
  const estimatedOptimized = estimatedCash - estimatedSavings;

  // Promo Code State
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState('');

  const handleApplyPromo = () => {
    const code = promoCode.toUpperCase();
    if (code === 'QEUIOXN0211') {
      setDiscount(serviceFee);
      setPromoMessage('100% off applied!');
    } else if (code === 'TRIPY2025') {
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
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Show generation loader and start generating
      setIsProcessing(false);
      setIsGenerating(true);
      
      // Generate itinerary after payment
      if (tripId) {
        const result = await generateItinerary(tripId);
        if (process.env.NODE_ENV === 'development') {
          console.log('[GroupPayment] generateItinerary success', {
            tripId,
            status: (result as Record<string, unknown>)?.status,
            itemCount: Array.isArray((result as Record<string, unknown>)?.items) 
              ? ((result as Record<string, unknown>).items as unknown[]).length 
              : 0,
            relaxed: (result as Record<string, unknown>)?.relaxed_constraints,
          });
        }
        
        // Mark strategy as paid so all group members can access transfer instructions
        await trips.markStrategyPaid(tripId, {
          amount: Math.max(0, serviceFee - discount),
          currency: 'USD',
          method: 'card',
        });
        if (process.env.NODE_ENV === 'development') {
          console.log('[GroupPayment] Strategy marked as paid for trip', tripId);
        }
      }
      
      setIsPaid(true);
      
      // The loader will handle the redirect after showing completion
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[GroupPayment] generateItinerary failed', {
          tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      setIsGenerating(false);
      const msg = err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.';
      setError(msg);
    }
  };
  
  // Handle generation complete - redirect to results
  const handleGenerationComplete = () => {
    setIsGenerating(false);
    router.push(`/group/results?tripId=${tripId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Trip Generation Progress Loader */}
      <TripGenerationLoader 
        isVisible={isGenerating} 
        isComplete={isPaid}
        onComplete={handleGenerationComplete}
        estimatedDuration={20000}
      />
      
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Finalize Group Trip</h1>
          <p className="text-slate-500 mt-2">Secure your group&apos;s optimization strategy and booking details.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Value Proposition */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Savings Highlight */}
          <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-8 text-white shadow-xl shadow-emerald-900/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-emerald-100 mb-1">
                <Sparkles className="w-5 h-5" />
                <span className="font-medium">Estimated Group Savings</span>
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-bold">${estimatedSavings.toLocaleString()}</span>
                <span className="text-emerald-100">saved vs public rates</span>
              </div>
              <div className="grid grid-cols-2 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                <div>
                  <div className="text-emerald-100 text-sm">Standard Price</div>
                  <div className="text-xl font-semibold line-through opacity-70">${estimatedCash.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-emerald-100 text-sm">Optimized Price</div>
                  <div className="text-xl font-semibold text-white">~ ${estimatedOptimized.toLocaleString()}</div>
                </div>
              </div>
              <p className="mt-4 text-sm text-emerald-100 opacity-90">
                * Based on current point valuations and group discounts available for your destination.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Why pay for optimization?</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">1</div>
                <div>
                  <h4 className="font-medium text-slate-900">Payment Processing</h4>
                  <p className="text-sm text-slate-600">We verify funds and hold the deposit.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">2</div>
                <div>
                  <h4 className="font-medium text-slate-900">Strategy Generation</h4>
                  <p className="text-sm text-slate-600">Our AI generates the optimal itinerary for your group.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">3</div>
                <div>
                  <h4 className="font-medium text-slate-900">Booking & Transfer</h4>
                  <p className="text-sm text-slate-600">You get the final booking links and point transfer instructions.</p>
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
                  <span>Group Size</span>
                  <span className="font-medium text-slate-900">{groupSize} Travelers</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Optimization Fee ({SERVICE_FEE_PERCENT}% of trip value)</span>
                  <span className="font-medium text-slate-900">${serviceFee.toFixed(2)}</span>
                </div>

                {/* Promo Code Input */}
                <div className="pt-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value);
                        setPromoMessage('');
                      }}
                      placeholder="Promo Code"
                      className="w-full pl-3 pr-24 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent uppercase placeholder:normal-case"
                    />
                    <button
                      onClick={handleApplyPromo}
                      disabled={!promoCode}
                      className="absolute right-1.5 top-1.5 bottom-1.5 px-4 bg-slate-900 text-white text-xs font-bold rounded-md hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      APPLY
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
                  <span className="text-xl font-bold text-slate-900">${Math.max(0, serviceFee - discount).toFixed(2)}</span>
                </div>
              </div>

              {!isPaid ? (
                <div className="space-y-4">
                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-800 font-medium">Could not generate itinerary</p>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                      <p className="text-xs text-red-600 mt-2">
                        {/ITH|regional|small airport|try a nearby major/i.test(error)
                          ? 'If you used a small regional airport, try a nearby major (e.g. Syracuse SYR or JFK).'
                          : 'Check that travel dates are in the future and routes exist. For major hubs (e.g. JFK, AMS, CDG), the server needs SERPAPI_KEY and AWARD_TOOL_API_KEY configured.'}
                      </p>
                    </div>
                  )}
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-blue-800 font-semibold text-sm">
                      <Shield className="w-4 h-4" /> Secure Transaction
                    </div>
                    <p className="text-xs text-blue-600">
                      Payment is refundable if no itinerary is found.
                    </p>
                  </div>
                  
                  <button
                    onClick={handlePayment}
                    disabled={isProcessing || isGenerating}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>Processing payment...</>
                    ) : isGenerating ? (
                      <>Generating trip...</>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" /> Pay & Generate
                      </>
                    )}
                  </button>
                  <div className="flex justify-center gap-2 text-slate-400">
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                     <div className="w-8 h-5 bg-slate-200 rounded"></div>
                  </div>
                </div>
              ) : isAlreadyGenerated ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-amber-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Already Generated</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Optimization has already been run for this trip.
                  </p>
                  <button 
                    onClick={() => router.push(`/group/results?tripId=${tripId}`)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
                  >
                    View Results
                  </button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Payment Successful!</h3>
                  <p className="text-sm text-slate-600">
                    Generating your itinerary...
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
