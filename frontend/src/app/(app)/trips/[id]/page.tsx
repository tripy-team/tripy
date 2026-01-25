'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ArrowLeft, Calendar, MapPin, CreditCard, Users, User, Plane, Copy, CheckCircle, AlertCircle, Lock, ChevronRight, Lightbulb, TrendingUp, ArrowRight } from 'lucide-react';
import { trips as tripsAPI, itineraries } from '@/lib/api';
import { getOptimizedImageUrl } from '@/lib/image-utils';
import { 
    buildTransferStepsFromItinerary, 
    getTransferTipsFromItems, 
    buildTransferStrategyOverview,
    buildTransferActionsFromTips,
    calculateTransferMetrics,
    BANK_PORTAL_URLS,
} from '@/lib/transfer-instructions';

interface Trip {
    id: string;
    destination: string;
    image: string;
    dates: string;
    status: 'upcoming' | 'completed';
    pointsRedeemed: string;
    type: 'Solo' | 'Group';
    travelers: number;
    location: string;
    description: string;
}

interface ApiTrip {
    tripId: string;
    title: string;
    startDate: string;
    endDate: string;
    status: string;
    createdBy: string;
    role?: string;
    memberCount?: number;
    destinations?: string[];
    firstDestination?: string;
}

interface TransferStep {
    id: string;
    title: string;
    program: string;
    partner: string;
    amount: string;
    icon: typeof Plane;
    instructions: string[];
    flightSegment?: string;
    surcharge?: number;
    isCodeshare?: boolean;
    operatingCarrier?: string;
    segmentDescription?: string;
    // Enhanced fields
    transferPortalUrl?: string;
    transferTime?: string;
    transferRatio?: string;
    bookingUrl?: string;
    centsPerPoint?: number;
    pointsValue?: number;
}

export default function TripDetails() {
    const params = useParams();
    const router = useRouter();
    const tripId = params.id as string;
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [trip, setTrip] = useState<Trip | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPaid, setIsPaid] = useState(false); // TODO: fetch from API (trip payment status)
    const [itineraryItems, setItineraryItems] = useState<Array<{ type?: string; [k: string]: unknown }>>([]);
    const [members, setMembers] = useState<Array<{ userId: string; name?: string }>>([]);

    useEffect(() => {
        const fetchTrip = async () => {
            try {
                setIsLoading(true);
                const response = await tripsAPI.list();
                const apiTrip = response.trips.find((t: ApiTrip) => t.tripId === tripId);

                if (!apiTrip) {
                    setTrip(null);
                    return;
                }

                const startDate = apiTrip.startDate ? new Date(apiTrip.startDate) : null;
                const endDate = apiTrip.endDate ? new Date(apiTrip.endDate) : null;
                const now = new Date();

                let datesStr = 'TBD';
                if (startDate && endDate) {
                    datesStr = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                } else if (startDate) {
                    datesStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                }

                const isCompleted = endDate ? endDate < now : false;
                const status: 'upcoming' | 'completed' = isCompleted ? 'completed' : 'upcoming';

                const memberCount = apiTrip.memberCount || 1;
                const tripType: 'Solo' | 'Group' = memberCount > 1 ? 'Group' : 'Solo';

                const destinationName = apiTrip.firstDestination || apiTrip.title || 'Trip';
                const location = apiTrip.firstDestination || 'Location TBD';

                // Fetch city-specific image
                let imageUrl = '';
                try {
                    imageUrl = await getOptimizedImageUrl(destinationName, 'large');
                } catch (err) {
                    console.error('Error loading image for', destinationName, err);
                }

                const description = apiTrip.destinations && apiTrip.destinations.length > 0
                    ? `Visiting ${apiTrip.destinations.join(', ')}`
                    : `Your ${tripType.toLowerCase()} trip to ${destinationName}`;

                setTrip({
                    id: apiTrip.tripId,
                    destination: apiTrip.title || destinationName,
                    image: imageUrl || '/placeholder-trip.jpg',
                    dates: datesStr,
                    status: status,
                    pointsRedeemed: '0', // TODO: Calculate from points data
                    type: tripType,
                    travelers: memberCount,
                    location: location,
                    description: description,
                });
            } catch (err) {
                console.error('Error fetching trip:', err);
                setTrip(null);
            } finally {
                setIsLoading(false);
            }
        };

        if (tripId) {
            fetchTrip();
        }
    }, [tripId]);

    useEffect(() => {
        if (!tripId) return;
        let cancelled = false;
        Promise.all([
            itineraries.get(tripId).then((r) => r.items || []),
            tripsAPI.listMembers(tripId).then((r) => r.members || []),
        ])
            .then(([its, mems]) => {
                if (cancelled) return;
                setItineraryItems(Array.isArray(its) ? its : []);
                setMembers(Array.isArray(mems) ? mems : []);
            })
            .catch(() => {
                if (cancelled) return;
                setItineraryItems([]);
                setMembers([]);
            });
        return () => { cancelled = true; };
    }, [tripId]);

    const copyToClipboard = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            console.error('Copy failed', err);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <p className="mt-4 text-slate-600">Loading trip details...</p>
                </div>
            </div>
        );
    }

    if (!trip) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 mb-4">Trip Not Found</h2>
                    <button
                        onClick={() => router.push('/my-trips')}
                        className="text-blue-600 hover:underline"
                    >
                        Back to My Trips
                    </button>
                </div>
            </div>
        );
    }

    // Tailored transfer instructions from itinerary (totals.transfers) and smart tips
    const rawSteps = buildTransferStepsFromItinerary(itineraryItems, members);
    const { transfer_tips } = getTransferTipsFromItems(itineraryItems);
    const strategyOverview = buildTransferStrategyOverview(itineraryItems, members);
    const transferMetrics = calculateTransferMetrics(transfer_tips);
    const transferActions = buildTransferActionsFromTips(transfer_tips);
    const transferSteps: TransferStep[] = rawSteps.map((t) => ({
        id: t.id,
        title: `${t.member}: ${t.category}`,
        program: t.program,
        partner: t.partner,
        amount: t.amountStr,
        icon: t.icon,
        instructions: t.steps,
        flightSegment: t.flightSegment,
        surcharge: t.surcharge,
        isCodeshare: t.isCodeshare,
        operatingCarrier: t.operatingCarrier,
        segmentDescription: t.segmentDescription,
        // Enhanced fields
        transferPortalUrl: t.transferPortalUrl,
        transferTime: t.transferTime,
        transferRatio: t.transferRatio,
        bookingUrl: t.bookingUrl,
        centsPerPoint: t.centsPerPoint,
        pointsValue: t.pointsValue,
    }));

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Hero Header */}
            <div className="relative h-64 md:h-80 bg-slate-900">
                <Image
                    src={trip.image}
                    alt={trip.destination}
                    fill
                    className="object-cover opacity-60"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />

                <div className="absolute top-6 left-6 z-10">
                    <button
                        onClick={() => router.push('/my-trips')}
                        className="flex items-center gap-2 text-white/90 hover:text-white bg-black/20 hover:bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full transition-all text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Trips
                    </button>
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 max-w-5xl mx-auto">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                                    trip.status === 'upcoming' ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-200'
                                }`}>
                                    {trip.status}
                                </span>
                                <span className="flex items-center gap-1 text-slate-300 text-sm">
                                    {trip.type === 'Solo' ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                                    {trip.type} Trip
                                </span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">{trip.destination}</h1>
                            <div className="flex flex-wrap items-center gap-4 text-slate-300 text-sm">
                                <span className="flex items-center gap-1.5">
                                    <MapPin className="w-4 h-4 text-slate-400" />
                                    {trip.location}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <Calendar className="w-4 h-4 text-slate-400" />
                                    {trip.dates}
                                </span>
                            </div>
                        </div>

                        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 min-w-[140px]">
                            <div className="text-xs text-slate-300 uppercase tracking-wider font-semibold mb-1">Total Points</div>
                            <div className="flex items-center gap-2 text-2xl font-bold text-white">
                                <CreditCard className="w-6 h-6 text-emerald-400" />
                                {trip.pointsRedeemed}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 md:px-6 mt-8 relative z-10">
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Main Content: Transfer Instructions */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900">Transfer Instructions</h2>
                                    <p className="text-sm text-slate-500 mt-1">From which credit card to transfer, how many points, and steps to complete your booking</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                                        <Plane className="w-5 h-5 text-blue-600" />
                                    </div>
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
                            </div>

                            {!isPaid ? (
                                /* Pending Payment section — transfer strategy hidden until payment */
                                <div className="p-8 md:p-12 text-center">
                                    <div className="bg-slate-100 p-4 rounded-full w-fit mx-auto mb-4">
                                        <Lock className="w-10 h-10 text-slate-500" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 mb-2">Pending Payment</h3>
                                    <p className="text-slate-600 max-w-md mx-auto mb-6">
                                        Complete payment to unlock your transfer strategy: where to transfer, which programs to use, how many points, and step-by-step booking instructions.
                                    </p>
                                    <button
                                        onClick={() => router.push(trip.type === 'Group' ? `/group/booking?trip_id=${trip.id}` : `/solo/booking?trip_id=${trip.id}`)}
                                        className="text-blue-600 font-semibold hover:text-blue-700 inline-flex items-center gap-1"
                                    >
                                        Complete Payment <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Warning Banner */}
                                    <div className="p-4 bg-amber-50 border-b border-amber-100 flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="text-sm text-amber-900">
                                            <span className="font-semibold block mb-1">Important: Transfers are irreversible</span>
                                            Once you transfer credit card points, you cannot move them back. Ensure availability before transferring.
                                        </div>
                                    </div>

                                    {/* Transfer Strategy Overview */}
                                    {strategyOverview && strategyOverview.totalPointsByProgram.size > 0 && (
                                        <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-blue-100">
                                            <div className="flex items-center gap-2 mb-4">
                                                <TrendingUp className="w-5 h-5 text-blue-600" />
                                                <h3 className="text-lg font-bold text-slate-900">Your Transfer Strategy</h3>
                                            </div>
                                            
                                            {/* Value Metrics Summary */}
                                            {transferMetrics.totalPoints > 0 && (
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                                    <div className="bg-white rounded-lg p-3 border border-blue-100">
                                                        <div className="text-xs text-slate-500 font-medium">Total Points</div>
                                                        <div className="text-xl font-bold text-slate-900">{transferMetrics.totalPoints.toLocaleString()}</div>
                                                    </div>
                                                    <div className="bg-white rounded-lg p-3 border border-blue-100">
                                                        <div className="text-xs text-slate-500 font-medium">Taxes & Fees</div>
                                                        <div className="text-xl font-bold text-slate-900">${Math.round(transferMetrics.totalSurcharges)}</div>
                                                    </div>
                                                    {transferMetrics.totalCashSaved > 0 && (
                                                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                                                            <div className="text-xs text-green-600 font-medium">Cash Saved</div>
                                                            <div className="text-xl font-bold text-green-700">${Math.round(transferMetrics.totalCashSaved)}</div>
                                                        </div>
                                                    )}
                                                    {transferMetrics.averageCpp > 0 && (
                                                        <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                                                            <div className="text-xs text-purple-600 font-medium">Avg. Value</div>
                                                            <div className="text-xl font-bold text-purple-700">{transferMetrics.averageCpp.toFixed(2)}¢/pt</div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            <p className="text-sm text-slate-700 mb-2">{strategyOverview.strategySummary}</p>
                                            {strategyOverview.strategyReason && (
                                                <p className="text-xs text-slate-600 italic mb-4">{strategyOverview.strategyReason}</p>
                                            )}
                                            
                                            {/* Points by Credit Card Program */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                {Array.from(strategyOverview.totalPointsByProgram.entries()).map(([program, total]) => {
                                                    const destinations = strategyOverview.transfersByProgram.get(program) || [];
                                                    return (
                                                        <div key={program} className="bg-white rounded-xl p-4 border border-slate-200">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit Card</div>
                                                                <div className="text-2xl font-bold text-slate-900">{total.toLocaleString()}</div>
                                                            </div>
                                                            <div className="text-sm font-medium text-slate-900 mb-3">{program}</div>
                                                            <div className="space-y-2">
                                                                {destinations.map((dest, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2 text-xs text-slate-600">
                                                                        <ArrowRight className="w-3 h-3 text-blue-500" />
                                                                        <span className="font-medium">{dest.points.toLocaleString()} pts</span>
                                                                        <span>→</span>
                                                                        <span className="text-blue-700 font-medium">{dest.partner}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            
                                            {/* Per-Member Breakdown */}
                                            {strategyOverview.memberStrategies.length > 1 && (
                                                <div className="mt-4 pt-4 border-t border-blue-200">
                                                    <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Per Traveler</h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {strategyOverview.memberStrategies.map((ms, idx) => (
                                                            <div key={idx} className="bg-white/50 rounded-lg p-3">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <span className="text-sm font-semibold text-slate-900">{ms.memberName}</span>
                                                                    <span className="text-xs font-bold text-slate-600">{ms.totalPoints.toLocaleString()} pts</span>
                                                                </div>
                                                                <div className="text-xs text-slate-600">
                                                                    {ms.transfers.length} transfer{ms.transfers.length !== 1 ? 's' : ''}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {transferSteps.length > 0 ? (
                                        <div className="divide-y divide-slate-100">
                                            {transferSteps.map((step, idx) => {
                                                // Find the corresponding transfer tip for codeshare info
                                                const tip = transfer_tips.find(t => 
                                                    t.to_program?.toLowerCase().includes(step.partner.toLowerCase()) ||
                                                    step.partner.toLowerCase().includes(t.to_program?.toLowerCase() || '')
                                                );
                                                const isCodeshare = step.isCodeshare || tip?.is_codeshare || false;
                                                const operatingCarrier = step.operatingCarrier || tip?.operating_carrier_name;
                                                const bookingAirline = tip?.booking_airline_name || step.partner;
                                                const flightSegment = step.flightSegment || tip?.best_for;
                                                const surcharge = step.surcharge ?? tip?.surcharge;

                                                return (
                                                    <div key={step.id} className="p-6 hover:bg-slate-50/50 transition-colors">
                                                        <div className="flex items-start gap-4">
                                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                                                                {idx + 1}
                                                            </div>
                                                            <div className="flex-1">
                                                                <h3 className="text-lg font-semibold text-slate-900 mb-3">{step.title}</h3>
                                                                
                                                                {/* Transfer Summary Box - Enhanced */}
                                                                <div className="mb-4 p-5 bg-gradient-to-br from-blue-50 via-indigo-50/50 to-slate-50 rounded-xl border-2 border-blue-200 shadow-sm">
                                                                    {/* Primary Transfer Info */}
                                                                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-blue-200">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="w-12 h-12 bg-white rounded-lg shadow-sm flex items-center justify-center">
                                                                                <CreditCard className="w-6 h-6 text-blue-600" />
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-xs text-slate-500 font-medium">From</div>
                                                                                <div className="text-base font-bold text-slate-900">{step.program}</div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="text-right">
                                                                                <div className="text-xs text-slate-500 font-medium">Transfer Amount</div>
                                                                                <div className="text-2xl font-bold text-blue-700">{step.amount.toLocaleString()}</div>
                                                                                <div className="text-xs text-slate-600 font-medium">points</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Destination & Flight Info */}
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div className="bg-white rounded-lg p-3 border border-blue-100">
                                                                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Transfer To</div>
                                                                            <div className="text-sm font-bold text-blue-700 flex items-center gap-1">
                                                                                {bookingAirline}
                                                                                <button
                                                                                    onClick={() => copyToClipboard(bookingAirline, `${step.id}-partner`)}
                                                                                    title="Copy airline name"
                                                                                    className="hover:opacity-100"
                                                                                >
                                                                                    {copiedId === `${step.id}-partner` ? <CheckCircle className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 opacity-50" />}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                        
                                                                        {flightSegment && (
                                                                            <div className="bg-white rounded-lg p-3 border border-blue-100">
                                                                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">For Flight</div>
                                                                                <div className="text-sm font-bold text-slate-900 flex items-center gap-1">
                                                                                    <Plane className="w-3.5 h-3.5 text-slate-400" />
                                                                                    {flightSegment}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    
                                                                    {/* Transfer Time & Ratio */}
                                                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                                                        {step.transferTime && (
                                                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                                                <div className="text-xs text-slate-500">Transfer Time</div>
                                                                                <div className="text-sm font-medium text-slate-900">{step.transferTime}</div>
                                                                            </div>
                                                                        )}
                                                                        {step.transferRatio && (
                                                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                                                <div className="text-xs text-slate-500">Transfer Ratio</div>
                                                                                <div className="text-sm font-medium text-slate-900">{step.transferRatio}</div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    
                                                                    {/* Taxes/Fees */}
                                                                    {surcharge !== undefined && surcharge > 0 && (
                                                                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                                                            <div className="flex items-center gap-2">
                                                                                <AlertCircle className="w-4 h-4 text-amber-600" />
                                                                                <div className="text-sm">
                                                                                    <span className="font-semibold text-amber-900">Additional Cost:</span>
                                                                                    <span className="text-amber-800 ml-1">~${Math.round(surcharge)} in taxes & fees</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    
                                                                    {/* Value Information */}
                                                                    {(step.centsPerPoint || step.pointsValue) && (
                                                                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                                                                            <div className="flex items-center justify-between text-sm">
                                                                                {step.centsPerPoint && (
                                                                                    <div>
                                                                                        <span className="text-green-600 font-medium">Value: </span>
                                                                                        <span className="text-green-800 font-bold">{step.centsPerPoint.toFixed(2)}¢ per point</span>
                                                                                    </div>
                                                                                )}
                                                                                {step.pointsValue && (
                                                                                    <div>
                                                                                        <span className="text-green-600 font-medium">Saving: </span>
                                                                                        <span className="text-green-800 font-bold">${Math.round(step.pointsValue)}</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    
                                                                    {/* Codeshare Information */}
                                                                    {isCodeshare && operatingCarrier && (
                                                                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                                                            <div className="flex items-start gap-2">
                                                                                <Plane className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                                                                <div className="text-xs text-slate-700">
                                                                                    <span className="font-semibold text-blue-700">Codeshare Flight:</span> Book through {bookingAirline}, fly on <span className="font-semibold">{operatingCarrier}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Quick Action Buttons */}
                                                                <div className="mt-4 flex flex-wrap gap-2">
                                                                    {step.transferPortalUrl && (
                                                                        <a
                                                                            href={step.transferPortalUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                                                                        >
                                                                            <CreditCard className="w-4 h-4" />
                                                                            Open {step.program.split(' ')[0]} Portal
                                                                            <ChevronRight className="w-3 h-3" />
                                                                        </a>
                                                                    )}
                                                                    {step.bookingUrl && (
                                                                        <a
                                                                            href={step.bookingUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
                                                                        >
                                                                            <Plane className="w-4 h-4" />
                                                                            Book on {bookingAirline.split(' ')[0]}
                                                                            <ChevronRight className="w-3 h-3" />
                                                                        </a>
                                                                    )}
                                                                </div>

                                                                {/* Step-by-step Instructions */}
                                                                <div className="mt-4">
                                                                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                                        <div className="w-1 h-4 bg-blue-600 rounded"></div>
                                                                        How to Complete This Transfer
                                                                    </h4>
                                                                    <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                                                                        {step.instructions.map((inst, i) => (
                                                                            <div key={i} className="flex gap-3">
                                                                                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                                                                                    {i + 1}
                                                                                </div>
                                                                                <p className="text-sm text-slate-600 leading-relaxed pt-0.5">{inst}</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : transfer_tips.length > 0 ? (
                                        <div className="p-6">
                                            <div className="flex items-center gap-2 text-amber-600 mb-3">
                                                <Lightbulb className="w-5 h-5" />
                                                <span className="font-semibold text-slate-900">Tailored strategies for your trip</span>
                                            </div>
                                            <p className="text-sm text-slate-600 mb-4">
                                                Generate an optimized itinerary to get step-by-step instructions. For now, consider transferring: {transfer_tips.slice(0, 2).map((t) => `${t.from_program || 'bank'} → ${t.to_program || 'partner'}`).join('; ')}.
                                            </p>
                                            <button
                                                onClick={() => router.push(trip.type === 'Group' ? `/group/results?trip_id=${trip.id}` : `/solo/results?trip_id=${trip.id}`)}
                                                className="text-blue-600 font-medium text-sm hover:text-blue-700"
                                            >
                                                Generate itinerary <ChevronRight className="w-3 h-3 inline" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center">
                                            <p className="text-slate-600 text-sm">Generate an itinerary for this trip to see your tailored transfer strategy and step-by-step instructions.</p>
                                            <button
                                                onClick={() => router.push(trip.type === 'Group' ? `/group/results?trip_id=${trip.id}` : `/solo/results?trip_id=${trip.id}`)}
                                                className="mt-3 text-blue-600 font-medium text-sm hover:text-blue-700"
                                            >
                                                Go to Results <ChevronRight className="w-3 h-3 inline" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Sidebar: Trip Info */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <h3 className="font-bold text-slate-900 mb-4">Trip Details</h3>
                            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                                {trip.description}
                            </p>

                            <div className="space-y-4">
                                <div className="flex items-center gap-3 text-sm">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                                        <Users className="w-4 h-4 text-indigo-600" />
                                    </div>
                                    <div>
                                        <div className="text-slate-500 text-xs">Travelers</div>
                                        <div className="font-medium text-slate-900">{trip.travelers} People</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                        <CreditCard className="w-4 h-4 text-emerald-600" />
                                    </div>
                                    <div>
                                        <div className="text-slate-500 text-xs">Total Points</div>
                                        <div className="font-medium text-slate-900">{trip.pointsRedeemed}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-100">
                                <button className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-medium text-sm hover:bg-slate-800 transition-colors">
                                    Edit Trip Details
                                </button>
                            </div>
                        </div>

                        <div className="bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20 p-6 text-white overflow-hidden relative">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                            <h3 className="font-bold mb-2 relative z-10">Need Help?</h3>
                            <p className="text-blue-100 text-sm mb-4 relative z-10">
                                Having trouble with your transfer? Check out our guide on how to troubleshoot common issues.
                            </p>
                            <button className="text-xs font-bold bg-white text-blue-600 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors relative z-10">
                                View Help Guide
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
