'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  Shield, 
  CheckCircle, 
  Lock, 
  CreditCard, 
  ArrowRight, 
  Plane, 
  Building2,
  Sparkles,
  ChevronRight,
  Wallet,
  Users
} from 'lucide-react';
import { trips as tripsAPI } from '@/lib/api';

function GroupBookingContent() {
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';
  
  const [isPaid, setIsPaid] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [groupSize, setGroupSize] = useState(4);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!tripId) {
        setLoading(false);
        return;
      }

      try {
        // Fetch group size
        const membersResponse = await tripsAPI.listMembers(tripId);
        setGroupSize(membersResponse.members.length || 4);
      } catch (_err) {
        console.error('Error fetching booking data:', _err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tripId]);

  const handlePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setIsPaid(true);
    }, 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading booking details...</p>
        </div>
      </div>
    );
  }

  // Calculate savings from actual data if available
  // Default values if no itinerary data is available yet
  const defaultCostPerPerson = 1850;
  const defaultPointsCost = 60000;
  const defaultTaxes = 50;
  
  const cashPrice = defaultCostPerPerson * groupSize;
  const pointsCost = defaultPointsCost;
  const taxes = defaultTaxes * groupSize;
  const savings = cashPrice - (pointsCost / 1000 * 2 + taxes); // Rough estimate

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Secure Your Group Booking</h1>
          <p className="text-slate-500 mt-2">Complete your payment to unlock step-by-step transfer instructions for all {groupSize} travelers.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Trip Details & Savings */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Savings Highlight */}
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-900/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-blue-100 mb-1">
                <Sparkles className="w-5 h-5" />
                <span className="font-medium">Total Group Savings</span>
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-bold">${savings.toLocaleString()}</span>
                <span className="text-blue-200">saved vs cash price</span>
              </div>
              <div className="grid grid-cols-2 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                <div>
                  <div className="text-blue-200 text-sm">Cash Price ({groupSize} travelers)</div>
                  <div className="text-xl font-semibold line-through opacity-70">${cashPrice.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-blue-200 text-sm">Your Cost</div>
                  <div className="text-xl font-semibold text-green-300">{pointsCost.toLocaleString()} pts + ${taxes}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Transfer Instructions (Blurred until paid) */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-blue-600" />
                Transfer Instructions
              </h2>
              {isPaid ? (
                <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Unlocked
                </span>
              ) : (
                <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
            </div>

            <div className="relative">
              {!isPaid && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-8">
                  <div className="bg-white p-4 rounded-full shadow-lg mb-4">
                    <Lock className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Instructions Hidden</h3>
                  <p className="text-slate-600 max-w-sm mb-6">
                    Pay the service fee to reveal the exact transfer partners, flight numbers, and step-by-step booking guide for all group members.
                  </p>
                  <button 
                    onClick={() => document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-1"
                  >
                    Go to Payment <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className={`p-8 space-y-8 ${!isPaid ? 'opacity-20 select-none' : ''}`}>
                {/* Step 1 - Group Flight Transfer */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">1</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Group Flight Points Transfer
                    </h3>
                    <p className="text-slate-600 mb-4">
                      Each group member should transfer points to their assigned airline partner. Total: <span className="font-bold text-slate-900">45,000 points per person</span>.
                    </p>
                    <div className="space-y-3">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm">
                        <div className="font-semibold text-slate-900 mb-2">Member 1 (Sarah)</div>
                        <div className="text-slate-600 font-mono">
                          Partner: Virgin Atlantic<br/>
                          Account: 123456789<br/>
                          Amount: 45,000 pts
                        </div>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm">
                        <div className="font-semibold text-slate-900 mb-2">Member 2 (John)</div>
                        <div className="text-slate-600 font-mono">
                          Partner: Air France / KLM<br/>
                          Account: 987654321<br/>
                          Amount: 45,000 pts
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2 - Group Flight Booking */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">2</div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Book Group Flights</h3>
                    <p className="text-slate-600 mb-4">
                      Each member books their assigned flight using their transferred points. Coordinate booking times to ensure group availability.
                    </p>
                    <div className="space-y-3">
                      <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <Plane className="w-5 h-5 text-slate-400" />
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900">JFK <ArrowRight className="w-4 h-4 inline mx-1" /> LHR</div>
                          <div className="text-xs text-slate-500">June 12 • 08:30 PM • VS-102</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <Plane className="w-5 h-5 text-slate-400" />
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900">SFO <ArrowRight className="w-4 h-4 inline mx-1" /> CDG</div>
                          <div className="text-xs text-slate-500">June 12 • 10:15 AM • AF-1234</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3 - Group Hotel Transfer */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">3</div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Transfer Points for Group Hotel</h3>
                    <p className="text-slate-600 mb-4">
                      Pool hotel points from group members. Total: <span className="font-bold text-slate-900">120,000 points</span> needed for {groupSize} rooms.
                    </p>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm font-mono text-slate-600">
                      Partner: Marriott Bonvoy<br/>
                      Account: 555666777 (Group Account)<br/>
                      Amount: 120,000 pts (30k per person)
                    </div>
                  </div>
                </div>

                {/* Step 4 - Group Hotel Booking */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">4</div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Book Group Hotel</h3>
                    <p className="text-slate-600 mb-4">
                      Book {groupSize} rooms at the Marriott property using pooled points. Contact hotel directly for group booking discounts.
                    </p>
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <Building2 className="w-5 h-5 text-slate-400" />
                      <div>
                        <div className="font-semibold text-slate-900">London, UK • {groupSize} Rooms</div>
                        <div className="text-xs text-slate-500">Check-in: June 12 • Check-out: June 18</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Payment */}
        <div className="lg:col-span-1" id="payment-section">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg sticky top-8">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-slate-600">
                  <span>Itinerary Value ({groupSize} travelers)</span>
                  <span className="line-through">${cashPrice.toLocaleString()}.00</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Points Cost</span>
                  <span className="font-medium text-slate-900">{pointsCost.toLocaleString()} pts</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Taxes & Fees (Airline)</span>
                  <span className="font-medium text-slate-900">~${taxes}.00</span>
                </div>
                <div className="border-t border-slate-100 my-4 pt-4 flex justify-between items-center">
                  <span className="font-semibold text-slate-900">Tripy Service Fee</span>
                  <span className="text-xl font-bold text-slate-900">$49.00</span>
                </div>
              </div>

              {!isPaid ? (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-blue-800 font-semibold text-sm">
                      <Shield className="w-4 h-4" /> Secure Payment
                    </div>
                    <p className="text-xs text-blue-600">
                      We use bank-level encryption to handle your transaction securely.
                    </p>
                  </div>
                  
                  <button
                    onClick={handlePayment}
                    disabled={isProcessing}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>Processing...</>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" /> Pay & Reveal
                      </>
                    )}
                  </button>
                  <p className="text-xs text-center text-slate-400">
                    By clicking Pay, you agree to our Terms of Service.
                  </p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Payment Successful!</h3>
                  <p className="text-sm text-slate-600">
                    Instructions unlocked. Check your email for a receipt.
                  </p>
                  <button 
                    className="mt-6 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-colors"
                  >
                    Download Receipt
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupBooking() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
      <GroupBookingContent />
    </Suspense>
  );
}
