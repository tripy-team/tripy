'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, CreditCard, Plane, Check, LucideIcon, Lock, ChevronRight, Sparkles, ExternalLink, Wallet } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI, itineraries } from '@/lib/api';
import { buildTransferStepsFromItinerary, getTransferTipsFromItems, type TransferStepResult, type TransferTip } from '@/lib/transfer-instructions';

interface Member {
    id: string;
    name: string;
    initials: string;
    totalPoints: number;
    totalValue: number;
    cards: Array<{ program: string; points: number; value?: number; centsPerPoint?: number }>;
    budget: number;
}

interface Assignment {
    category: string;
    icon: LucideIcon;
    assignedTo: string;
    pointsUsed: number;
    cashValue: number;
    efficiency: number;
    reason: string;
    flightSegment?: string;
}

export default function GroupPointsStrategy() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
    
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPaid, setIsPaid] = useState(true);
    const [itineraryItems, setItineraryItems] = useState<Array<{ type?: string; [k: string]: unknown }>>([]);
    const [membersForTransfers, setMembersForTransfers] = useState<Array<{ userId: string; name?: string }>>([]);

    useEffect(() => {
        const fetchMembers = async () => {
            if (!tripId) {
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                
                const [membersResponse, pointsResponse, itinerariesRes, strategyStatus] = await Promise.all([
                    tripsAPI.listMembers(tripId),
                    pointsAPI.summary(tripId),
                    itineraries.get(tripId).catch(() => ({ items: [] as Array<{ type?: string; [k: string]: unknown }> })),
                    tripsAPI.getStrategyStatus(tripId).catch(() => ({ strategy_paid: false })),
                ]);
                
                setIsPaid(strategyStatus.strategy_paid || false);
                
                setMembersForTransfers(membersResponse.members || []);
                setItineraryItems(Array.isArray(itinerariesRes?.items) ? itinerariesRes.items : []);
                
                // Transform members data
                const transformedMembers: Member[] = membersResponse.members.map((member, index) => {
                    const userId = member.userId;
                    const name = member.name || `Member ${index + 1}`;
                    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || userId.substring(0, 2).toUpperCase();
                    
                    // Get points for this user from points summary (includes value, centsPerPoint from TPG)
                    const userPoints = pointsResponse.items?.filter((item: { userId?: string }) => item.userId === userId) || [];
                    const totalPoints = userPoints.reduce((sum: number, item: { balance?: number }) => sum + (item.balance || 0), 0);
                    const totalValue = userPoints.reduce((sum: number, item: { value?: number | null }) => sum + (item.value ?? 0), 0);
                    const cards = userPoints.map((item: { program?: string; balance?: number; value?: number | null; centsPerPoint?: number | null }) => ({
                        program: item.program || 'Unknown',
                        points: item.balance || 0,
                        value: item.value ?? undefined,
                        centsPerPoint: item.centsPerPoint ?? undefined,
                    }));
                    
                    return {
                        id: userId,
                        name,
                        initials,
                        totalPoints: totalPoints,
                        totalValue,
                        cards: cards,
                        budget: 5000,
                    };
                });
                
                setMembers(transformedMembers);
            } catch (err) {
                console.error('Error fetching members:', err);
                setMembers([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchMembers();
    }, [tripId]);

    const transfers: TransferStepResult[] = buildTransferStepsFromItinerary(itineraryItems, membersForTransfers);

    // Build booking assignments from the actual transfer data (same source as Step 1)
    // Each transfer represents who books which segment
    const assignments: Assignment[] = transfers.map((transfer) => {
        // Build a descriptive category from the route info
        let category = 'Flights';
        if (transfer.flightSegment) {
            category = transfer.flightSegment;
        } else if (transfer.routeSegments && transfer.routeSegments.length > 0) {
            category = transfer.routeSegments.join(' + ');
        }
        
        // Estimate cash value from cents per point if available
        const efficiency = transfer.centsPerPoint || 1.5;
        const cashValue = transfer.pointsValue || Math.round((transfer.amount * efficiency) / 100);
        
        return {
            category,
            icon: Plane,
            assignedTo: transfer.member,
            pointsUsed: transfer.amount,
            cashValue,
            efficiency,
            reason: `Transfer to ${transfer.partner} for best redemption value`,
            flightSegment: transfer.flightSegment,
        };
    });

    const totalPointsUsed = assignments.reduce((sum, a) => sum + a.pointsUsed, 0);
    const totalCashValue = assignments.reduce((sum, a) => sum + a.cashValue, 0);
    const averageEfficiency = assignments.length > 0 && assignments.filter(a => a.pointsUsed > 0).length > 0
        ? assignments
            .filter(a => a.pointsUsed > 0)
            .reduce((sum, a) => sum + a.efficiency, 0) / assignments.filter(a => a.pointsUsed > 0).length
        : 0;
    const { transfer_tips } = getTransferTipsFromItems(itineraryItems);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse shadow-xl shadow-blue-600/20">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold text-slate-900 mb-2">Loading Strategy</h2>
                    <p className="text-slate-600">Fetching member points and transfer options...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-6 py-8">
                    <button
                        onClick={() => tripId ? router.push(`/group/results?tripId=${tripId}`) : router.back()}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Results</span>
                    </button>
                    <h1 className="text-3xl font-bold text-slate-900">Your Transfer Strategy</h1>
                    <p className="text-slate-500 mt-2">Step-by-step instructions to transfer points and book flights</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-12">
                {(
                <>
                {/* Savings Summary - matches solo booking page */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-900/10 relative overflow-hidden mb-8">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 text-blue-100 mb-1">
                            <Sparkles className="w-5 h-5" />
                            <span className="font-medium">Estimated Savings</span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-4">
                            <span className="text-5xl font-bold">${totalCashValue.toLocaleString()}</span>
                            <span className="text-blue-200">in flight value</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                            <div>
                                <div className="text-blue-200 text-sm">Points Used</div>
                                <div className="text-xl font-semibold">{(totalPointsUsed / 1000).toFixed(0)}k</div>
                            </div>
                            <div>
                                <div className="text-blue-200 text-sm">Avg Value</div>
                                <div className="text-xl font-semibold">{averageEfficiency.toFixed(2)}¢/pt</div>
                            </div>
                            <div>
                                <div className="text-blue-200 text-sm">Group Size</div>
                                <div className="text-xl font-semibold">{members.length}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Transfer Instructions - matches solo booking page style */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm mb-8">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                            <Wallet className="w-5 h-5 text-blue-600" />
                            Step 1: Transfer Points
                        </h2>
                        <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> Unlocked
                        </span>
                    </div>
                    <div className="p-6">
                        {transfers.length > 0 ? (
                            <div className="space-y-4">
                                {transfers.map((t, idx) => {
                                    const Icon = t.icon;
                                    return (
                                        <div key={t.id} className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
                                            <div className="p-4">
                                                {/* Flight Route Header - prominent display of which flight */}
                                                {t.flightSegment && (
                                                    <div className="mb-4 pb-3 border-b border-blue-100">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <Plane className="w-4 h-4 text-blue-600" />
                                                            <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Flight Route</span>
                                                        </div>
                                                        <div className="text-lg font-bold text-slate-900">{t.flightSegment}</div>
                                                        {t.segmentDescription && (
                                                            <div className="text-sm text-slate-600 mt-1">{t.segmentDescription}</div>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg flex-shrink-0">
                                                            {idx + 1}
                                                        </div>
                                                        <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                                                            <CreditCard className="w-6 h-6 text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <div className="text-sm text-slate-500">From</div>
                                                            <div className="font-bold text-slate-900">{t.program}</div>
                                                        </div>
                                                        <div className="flex items-center gap-2 px-3">
                                                            <div className="w-8 h-px bg-slate-300"></div>
                                                            <ArrowRight className="w-5 h-5 text-blue-500" />
                                                            <div className="w-8 h-px bg-slate-300"></div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm text-slate-500">To</div>
                                                            <div className="font-bold text-slate-900">{t.partner}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-2xl font-bold text-blue-600">{t.amount.toLocaleString()}</div>
                                                        <div className="text-xs text-slate-500">points</div>
                                                    </div>
                                                </div>
                                                
                                                {/* Member tag and additional details */}
                                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-blue-100">
                                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                                        <span className="px-2 py-1 bg-white rounded-lg border border-slate-200 font-medium">{t.member}</span>
                                                        {t.surcharge != null && t.surcharge > 0 && (
                                                            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">
                                                                +${Math.round(t.surcharge)} fees
                                                            </span>
                                                        )}
                                                        {t.centsPerPoint != null && t.centsPerPoint > 0 && (
                                                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                                                                {t.centsPerPoint.toFixed(1)}¢/pt
                                                            </span>
                                                        )}
                                                    </div>
                                                    {t.transferTime && (
                                                        <div className="text-xs text-slate-500">
                                                            Transfer: {t.transferTime}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="pt-4">
                                    <button
                                        onClick={() => router.push(`/group/transfer-instructions?tripId=${tripId}`)}
                                        className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 flex items-center justify-center gap-2"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        View Step-by-Step Transfer Guide
                                    </button>
                                </div>
                            </div>
                        ) : transfer_tips.length > 0 ? (
                            <div className="space-y-4">
                                <p className="text-slate-600 text-sm">Suggested transfers for your trip. Generate an optimized itinerary to see exact amounts per member.</p>
                                {transfer_tips.map((tip: TransferTip, i: number) => (
                                    <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-slate-700">{tip.from_program || 'Bank points'}</span>
                                        <ArrowRight className="w-4 h-4 text-slate-400" />
                                        <span className="font-medium text-blue-700">{tip.to_program || 'Partner'}</span>
                                        {typeof tip.points === 'number' && tip.points > 0 && (
                                            <span className="ml-2 text-slate-600 font-semibold">{tip.points.toLocaleString()} pts</span>
                                        )}
                                        {tip.best_for && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{tip.best_for}</span>}
                                        {tip.note && <p className="w-full mt-2 text-sm text-slate-600">{tip.note}</p>}
                                    </div>
                                ))}
                                <button
                                    onClick={() => router.push(`/group/results?tripId=${tripId}`)}
                                    className="text-blue-600 font-medium text-sm hover:text-blue-700"
                                >
                                    Generate itinerary for exact amounts <ChevronRight className="w-4 h-4 inline" />
                                </button>
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CreditCard className="w-8 h-8 text-slate-400" />
                                </div>
                                <p className="text-slate-600 text-sm mb-4 max-w-md mx-auto">Generate an optimized itinerary from the Results page to see exactly which credit card to transfer from and how many points per member.</p>
                                <button
                                    onClick={() => router.push(`/group/results?tripId=${tripId}`)}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                                >
                                    Go to Results
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Booking Assignments - Step 2 */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm mb-8">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                            <Plane className="w-5 h-5 text-blue-600" />
                            Step 2: Book Flights
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">Who should book each flight segment after transfers complete</p>
                    </div>

                    <div className="divide-y divide-slate-100">
                        {assignments.filter(a => a.pointsUsed > 0 || a.cashValue > 0).map((assignment, idx) => {
                            const Icon = assignment.icon;
                            const member = members.find(m => m.name === assignment.assignedTo);
                            // Get the matching transfer for additional details
                            const matchingTransfer = transfers.find(t => t.member === assignment.assignedTo && t.flightSegment === assignment.flightSegment);

                            return (
                                <div key={idx} className="p-5 hover:bg-slate-50/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        {/* Icon */}
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                            assignment.pointsUsed > 0 ? 'bg-blue-100' : 'bg-slate-100'
                                        }`}>
                                            <Icon className={`w-6 h-6 ${assignment.pointsUsed > 0 ? 'text-blue-600' : 'text-slate-500'}`} />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            {/* Flight Route - prominent display */}
                                            {assignment.flightSegment && (
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Plane className="w-4 h-4 text-blue-600" />
                                                    <span className="text-lg font-bold text-slate-900">{assignment.flightSegment}</span>
                                                    {assignment.efficiency > 0 && (
                                                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                                                            {assignment.efficiency.toFixed(2)}¢/pt
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {!assignment.flightSegment && (
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-semibold text-slate-900">{assignment.category}</h3>
                                                    {assignment.efficiency > 0 && (
                                                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                                                            {assignment.efficiency.toFixed(2)}¢/pt
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 bg-slate-700 text-white rounded-full flex items-center justify-center text-xs font-medium">
                                                    {member?.initials}
                                                </div>
                                                <span className="text-sm text-slate-600">{assignment.assignedTo}</span>
                                                {matchingTransfer?.partner && (
                                                    <span className="text-sm text-blue-600">• Book via {matchingTransfer.partner}</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-2">{assignment.reason}</p>
                                        </div>

                                        {/* Points/Value */}
                                        <div className="text-right flex-shrink-0">
                                            {assignment.pointsUsed > 0 ? (
                                                <>
                                                    <div className="text-xl font-bold text-blue-600">{assignment.pointsUsed.toLocaleString()}</div>
                                                    <div className="text-xs text-slate-500">points</div>
                                                    <div className="text-sm text-slate-600 mt-1">${assignment.cashValue.toLocaleString()} value</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="text-xl font-bold text-slate-900">${assignment.cashValue.toLocaleString()}</div>
                                                    <div className="text-xs text-slate-500">cash</div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Member Points Overview */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-blue-600" />
                            Member Points Overview
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">Available points and assigned bookings for each member</p>
                    </div>

                    <div className="divide-y divide-slate-100">
                        {members.map((member) => {
                            const memberAssignments = assignments.filter(a => a.assignedTo === member.name);
                            const pointsUsed = memberAssignments.reduce((sum, a) => sum + a.pointsUsed, 0);
                            const remainingPoints = member.totalPoints - pointsUsed;
                            const usagePercent = member.totalPoints > 0 ? (pointsUsed / member.totalPoints) * 100 : 0;

                            return (
                                <div key={member.id} className="p-5">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 text-white rounded-xl flex items-center justify-center text-lg font-semibold shadow-sm">
                                                {member.initials}
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-900">{member.name}</h3>
                                                <div className="text-sm text-slate-500">
                                                    {member.totalPoints.toLocaleString()} total points
                                                    {member.totalValue > 0 && (
                                                        <span className="ml-1">(≈ ${member.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className="text-sm text-slate-500 mb-1">Using</div>
                                            <div className="text-lg font-bold text-blue-600">
                                                {pointsUsed.toLocaleString()} pts
                                            </div>
                                        </div>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="mb-4">
                                        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                                            <span>Points allocated</span>
                                            <span>{remainingPoints.toLocaleString()} remaining</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2">
                                            <div
                                                className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all"
                                                style={{ width: `${Math.min(usagePercent, 100)}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Credit Cards */}
                                    {member.cards.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-4">
                                            {member.cards.map((card, idx) => (
                                                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                                                    <CreditCard className="w-4 h-4 text-slate-500" />
                                                    <span className="text-sm font-medium text-slate-700">{card.program}</span>
                                                    <span className="text-sm text-slate-500">{card.points.toLocaleString()} pts</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Assignments - show flight segments */}
                                    {memberAssignments.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {memberAssignments.filter(a => a.pointsUsed > 0).map((assignment, idx) => (
                                                <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                                                    <Plane className="w-4 h-4" />
                                                    <span>{assignment.flightSegment || assignment.category}</span>
                                                    <span className="text-blue-500 text-xs ml-1">({assignment.pointsUsed.toLocaleString()} pts)</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-8 space-y-3">
                    <button
                        onClick={() => router.push(`/group/transfer-instructions?tripId=${tripId}`)}
                        className="w-full py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold text-lg"
                    >
                        Start Transferring Points
                    </button>
                    <button
                        onClick={() => tripId ? router.push(`/group/results?tripId=${tripId}`) : router.back()}
                        className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium"
                    >
                        Back to Results
                    </button>
                </div>
                </>
                )}
            </div>
        </div>
    );
}
