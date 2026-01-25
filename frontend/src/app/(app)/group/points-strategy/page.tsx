'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, CreditCard, Plane, Hotel, Activity, Zap, TrendingUp, DollarSign, Check, LucideIcon, Lock, ChevronRight } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI, itineraries } from '@/lib/api';
import PointsAllocation from '@/components/PointsAllocation';
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
}

export default function GroupPointsStrategy() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
    
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAllocation, setShowAllocation] = useState(false);
    const [allocatedPoints, setAllocatedPoints] = useState<Record<string, Record<string, number>>>({}); // userId -> { program -> allocated }
    const [isPaid, setIsPaid] = useState(false); // TODO: fetch from API (trip payment status)
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
                
                const [membersResponse, pointsResponse, itinerariesRes] = await Promise.all([
                    tripsAPI.listMembers(tripId),
                    pointsAPI.summary(tripId),
                    itineraries.get(tripId).catch(() => ({ items: [] as Array<{ type?: string; [k: string]: unknown }> })),
                ]);
                
                setMembersForTransfers(membersResponse.members || []);
                setItineraryItems(Array.isArray(itinerariesRes?.items) ? itinerariesRes.items : []);
                
                // Transform members data
                // Note: We need user names, which might require a user lookup
                // For now, use userId and initials
                const transformedMembers: Member[] = membersResponse.members.map((member, index) => {
                    const userId = member.userId;
                    const initials = userId.substring(0, 2).toUpperCase();
                    
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
                        name: `User ${index + 1}`, // TODO: Get actual user name from user service
                        initials: initials,
                        totalPoints: totalPoints,
                        totalValue,
                        cards: cards,
                        budget: 5000, // TODO: Get from user profile or trip settings
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

    // Optimized booking assignments
    // TODO: Calculate or fetch from backend endpoint for optimized assignments
    // For now, use placeholder assignments based on available members
    const assignments: Assignment[] = members.length > 0 ? [
        {
            category: 'Flights',
            icon: Plane,
            assignedTo: members[0]?.name || 'Member 1',
            pointsUsed: members[0]?.totalPoints > 0 ? Math.min(members[0].totalPoints, 80000) : 0,
            cashValue: 1200,
            efficiency: 1.5,
            reason: 'Chase Sapphire Reserve offers 1.5¢ per point for travel redemption through their portal'
        },
        {
            category: 'Hotels',
            icon: Hotel,
            assignedTo: members[1]?.name || 'Member 2',
            pointsUsed: members[1]?.totalPoints > 0 ? Math.min(members[1].totalPoints, 85000) : 0,
            cashValue: 1100,
            efficiency: 1.29,
            reason: 'Chase Sapphire Preferred provides 1.25¢ per point value for hotel bookings'
        },
        {
            category: 'Activities & Tours',
            icon: Activity,
            assignedTo: members[2]?.name || 'Member 3',
            pointsUsed: members[2]?.totalPoints > 0 ? Math.min(members[2].totalPoints, 45000) : 0,
            cashValue: 450,
            efficiency: 1.0,
            reason: 'Capital One Venture offers 1¢ per point for travel purchases with flexible redemption'
        },
        {
            category: 'Dining & Transport',
            icon: DollarSign,
            assignedTo: members[3]?.name || 'Member 4',
            pointsUsed: members[3]?.totalPoints > 0 ? Math.min(members[3].totalPoints, 0) : 0,
            cashValue: 800,
            efficiency: 0,
            reason: 'Paid in cash - no points available. Other members maximize their high-value point redemptions'
        }
    ] : [];

    const totalPointsUsed = assignments.reduce((sum, a) => sum + a.pointsUsed, 0);
    const totalCashValue = assignments.reduce((sum, a) => sum + a.cashValue, 0);
    const averageEfficiency = assignments.length > 0 && assignments.filter(a => a.pointsUsed > 0).length > 0
        ? assignments
            .filter(a => a.pointsUsed > 0)
            .reduce((sum, a) => sum + a.efficiency, 0) / assignments.filter(a => a.pointsUsed > 0).length
        : 0;

    const transfers: TransferStepResult[] = buildTransferStepsFromItinerary(itineraryItems, membersForTransfers);
    const { transfer_tips } = getTransferTipsFromItems(itineraryItems);

    if (isLoading) {
        return (
            <div className="min-h-full p-8 bg-neutral-50">
                <div className="max-w-6xl mx-auto">
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-4 text-neutral-600">Loading members and points data...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => tripId ? router.push(`/group/results?tripId=${tripId}`) : router.back()}
                        className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Results</span>
                    </button>

                    <h1 className="text-4xl mb-3 tracking-tight">Points Strategy</h1>
                    <p className="text-neutral-600">Optimized booking assignments to maximize credit card points value</p>
                </div>

                {!isPaid ? (
                    /* Pending Payment section — transfer strategy hidden until payment */
                    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden p-8 md:p-12 text-center">
                        <div className="bg-neutral-100 p-4 rounded-full w-fit mx-auto mb-4">
                            <Lock className="w-10 h-10 text-neutral-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-2">Pending Payment</h3>
                        <p className="text-neutral-600 max-w-md mx-auto mb-6">
                            Complete payment to unlock your transfer plan: which credit card to transfer from, how many points to transfer to each partner, who books what, and step-by-step instructions.
                        </p>
                        <button
                            onClick={() => router.push(`/group/booking?tripId=${tripId}`)}
                            className="text-blue-600 font-semibold hover:text-blue-700 inline-flex items-center gap-1"
                        >
                            Complete Payment <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                <>
                {/* Summary Cards */}
                <div className="grid md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white border border-neutral-200 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-5 h-5 text-neutral-600" />
                            <span className="text-sm text-neutral-600">Total Points Used</span>
                        </div>
                        <div className="text-3xl mb-1">{totalPointsUsed.toLocaleString()}</div>
                        <div className="text-sm text-neutral-500">Across all bookings</div>
                    </div>

                    <div className="bg-white border border-neutral-200 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-5 h-5 text-neutral-600" />
                            <span className="text-sm text-neutral-600">Cash Value</span>
                        </div>
                        <div className="text-3xl mb-1">${totalCashValue.toLocaleString()}</div>
                        <div className="text-sm text-neutral-500">Equivalent value saved</div>
                    </div>

                    <div className="bg-white border border-neutral-200 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-5 h-5 text-neutral-600" />
                            <span className="text-sm text-neutral-600">Avg Efficiency</span>
                        </div>
                        <div className="text-3xl mb-1">{averageEfficiency.toFixed(2)}¢</div>
                        <div className="text-sm text-neutral-500">Per point redeemed</div>
                    </div>
                </div>

                {/* Where to Transfer: What & How Many */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden mb-8">
                    <div className="p-6 border-b border-neutral-200">
                        <h2 className="text-2xl">Where to Transfer: What & How Many</h2>
                        <p className="text-sm text-neutral-600 mt-1">From which credit card to transfer, how many points to transfer, and to which partner for each step</p>
                    </div>
                    <div className="p-6">
                        {transfers.length > 0 ? (
                            <div className="space-y-4">
                                {transfers.map((t) => {
                                    const Icon = t.icon;
                                    return (
                                        <div key={t.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-neutral-50 border border-neutral-200">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-white border border-neutral-200 rounded-lg flex items-center justify-center flex-shrink-0">
                                                    <Icon className="w-5 h-5 text-blue-600" />
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-slate-900">{t.member}</div>
                                                    <div className="text-xs text-neutral-500">{t.category}</div>
                                                </div>
                                            </div>
                                            <div className="flex-1 flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
                                                <span className="font-medium text-slate-700">{t.program}</span>
                                                <ArrowRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                                                <span className="font-medium text-blue-700">{t.partner}</span>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <div className="text-xs text-neutral-500">Points to transfer from {t.program}</div>
                                                <div className="text-2xl font-bold text-slate-900">{t.amount.toLocaleString()}</div>
                                                <div className="text-xs text-neutral-500">pts → {t.partner}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="pt-2">
                                    <button
                                        onClick={() => router.push(`/group/transfer-instructions?tripId=${tripId}`)}
                                        className="text-blue-600 font-medium text-sm hover:text-blue-700 inline-flex items-center gap-1"
                                    >
                                        View step-by-step transfer guide <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ) : transfer_tips.length > 0 ? (
                            <div className="space-y-4">
                                <p className="text-neutral-600 text-sm">Suggested transfers for your trip. Generate an optimized itinerary from Results to get which credit card to transfer from and how many points per member.</p>
                                {transfer_tips.map((tip: TransferTip, i: number) => (
                                    <div key={i} className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-slate-700">{tip.from_program || 'Bank points'}</span>
                                        <ArrowRight className="w-4 h-4 text-neutral-400" />
                                        <span className="font-medium text-blue-700">{tip.to_program || 'Partner'}</span>
                                        {typeof tip.points === 'number' && tip.points > 0 && (
                                            <span className="ml-2 text-slate-600 font-semibold">{tip.points.toLocaleString()} pts</span>
                                        )}
                                        {tip.best_for && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{tip.best_for}</span>}
                                        {tip.note && <p className="w-full mt-2 text-sm text-neutral-600">{tip.note}</p>}
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
                            <div className="text-center py-4">
                                <p className="text-neutral-600 text-sm mb-4">Generate an optimized itinerary from the Results page to see exactly which credit card to transfer from, how many points to transfer, and step-by-step instructions for each member.</p>
                                <button
                                    onClick={() => router.push(`/group/results?tripId=${tripId}`)}
                                    className="text-blue-600 font-medium text-sm hover:text-blue-700 inline-flex items-center gap-1"
                                >
                                    Go to Results <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Booking Assignments */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden mb-8">
                    <div className="p-6 border-b border-neutral-200">
                        <h2 className="text-2xl">Booking Assignments</h2>
                        <p className="text-sm text-neutral-600 mt-1">Who should book what for maximum value</p>
                    </div>

                    <div className="divide-y divide-neutral-200">
                        {assignments.map((assignment, idx) => {
                            const Icon = assignment.icon;
                            const member = members.find(m => m.name === assignment.assignedTo);

                            return (
                                <div key={idx} className="p-6 hover:bg-neutral-50 transition-colors">
                                    <div className="flex items-start gap-6">
                                        {/* Icon */}
                                        <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                            <Icon className="w-6 h-6 text-neutral-900" />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <h3 className="text-xl mb-1">{assignment.category}</h3>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 bg-neutral-900 text-white rounded-full flex items-center justify-center text-xs">
                                                            {member?.initials}
                                                        </div>
                                                        <span className="text-sm text-neutral-600">{assignment.assignedTo}</span>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <div className="flex items-center gap-1.5 text-sm text-neutral-600 mb-1">
                                                        <Zap className="w-4 h-4" />
                                                        <span>{assignment.pointsUsed.toLocaleString()} pts</span>
                                                    </div>
                                                    <div className="text-sm text-neutral-600">
                                                        ${assignment.cashValue.toLocaleString()} value
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Efficiency Badge */}
                                            {assignment.efficiency > 0 && (
                                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 rounded-lg text-sm mb-3">
                                                    <TrendingUp className="w-4 h-4 text-neutral-600" />
                                                    <span>{assignment.efficiency.toFixed(2)}¢ per point</span>
                                                </div>
                                            )}

                                            {/* Reason */}
                                            <p className="text-sm text-neutral-600 leading-relaxed">{assignment.reason}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Points Allocation Section */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden mb-8">
                    <div className="p-6 border-b border-neutral-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl">Points Allocation</h2>
                                <p className="text-sm text-neutral-600 mt-1">
                                    Choose how many points to allocate from each loyalty program
                                </p>
                            </div>
                            <button
                                onClick={() => setShowAllocation(!showAllocation)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                {showAllocation ? 'Hide' : 'Allocate Points'}
                            </button>
                        </div>
                    </div>

                    {showAllocation && (
                        <div className="p-6">
                            {members.map((member) => {
                                if (member.cards.length === 0) return null;
                                
                                return (
                                    <div key={member.id} className="mb-8 last:mb-0">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-10 h-10 bg-neutral-900 text-white rounded-full flex items-center justify-center text-lg">
                                                {member.initials}
                                            </div>
                                            <h3 className="text-lg font-semibold">{member.name}</h3>
                                        </div>
                                        <PointsAllocation
                                            availablePoints={member.cards.map(card => ({
                                                program: card.program,
                                                points: card.points,
                                            }))}
                                            allocatedPoints={allocatedPoints[member.id] || {}}
                                            onAllocationChange={(allocations) => {
                                                setAllocatedPoints(prev => ({
                                                    ...prev,
                                                    [member.id]: allocations,
                                                }));
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Member Points Breakdown */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
                    <div className="p-6 border-b border-neutral-200">
                        <h2 className="text-2xl">Member Points Overview</h2>
                        <p className="text-sm text-neutral-600 mt-1">Available points and cards for each member</p>
                    </div>

                    <div className="divide-y divide-neutral-200">
                        {members.map((member) => {
                            const memberAssignments = assignments.filter(a => a.assignedTo === member.name);
                            const pointsUsed = memberAssignments.reduce((sum, a) => sum + a.pointsUsed, 0);

                            return (
                                <div key={member.id} className="p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-neutral-900 text-white rounded-full flex items-center justify-center text-lg">
                                                {member.initials}
                                            </div>
                                            <div>
                                                <h3 className="text-lg mb-1">{member.name}</h3>
                                                <div className="text-sm text-neutral-600">
                                                    {member.totalPoints.toLocaleString()} total points
                                                    {member.totalValue > 0 && (
                                                        <span className="ml-1 text-neutral-500">(≈ ${member.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} at TPG rates)</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className="text-sm text-neutral-600 mb-1">Points Usage</div>
                                            <div className="text-xl">
                                                {pointsUsed.toLocaleString()} / {member.totalPoints.toLocaleString()}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Credit Cards */}
                                    {member.cards.length > 0 ? (
                                        <div className="space-y-2 mb-4">
                                            {member.cards.map((card, idx) => {
                                                const allocated = allocatedPoints[member.id]?.[card.program] || 0;
                                                const remaining = card.points - allocated;
                                                
                                                return (
                                                    <div key={idx} className="px-4 py-3 bg-neutral-50 rounded-lg border border-neutral-200">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <CreditCard className="w-4 h-4 text-neutral-600" />
                                                                <span className="text-sm font-medium text-neutral-900">{card.program}</span>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-sm font-semibold text-neutral-900">
                                                                    {card.points.toLocaleString()} pts
                                                                    {card.value != null && card.value > 0 && (
                                                                        <span className="block text-xs font-normal text-neutral-500">≈ ${card.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {allocated > 0 && (
                                                            <div className="mt-2 pt-2 border-t border-neutral-200">
                                                                <div className="flex items-center justify-between text-xs">
                                                                    <span className="text-blue-600">Allocated: {allocated.toLocaleString()} pts</span>
                                                                    <span className="text-neutral-500">Remaining: {remaining.toLocaleString()} pts</span>
                                                                </div>
                                                                <div className="w-full bg-neutral-200 rounded-full h-1.5 mt-1.5">
                                                                    <div
                                                                        className="bg-blue-600 h-1.5 rounded-full transition-all"
                                                                        style={{ width: `${(allocated / card.points) * 100}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="px-4 py-3 bg-neutral-50 rounded-lg mb-4">
                                            <span className="text-sm text-neutral-600">No credit card points available</span>
                                        </div>
                                    )}

                                    {/* Assignments */}
                                    {memberAssignments.length > 0 && (
                                        <div className="pt-4 border-t border-neutral-200">
                                            <div className="text-sm text-neutral-600 mb-2">Assigned to book:</div>
                                            <div className="flex flex-wrap gap-2">
                                                {memberAssignments.map((assignment, idx) => (
                                                    <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white rounded-lg text-sm">
                                                        <Check className="w-4 h-4" />
                                                        <span>{assignment.category}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between mt-8">
                    <button
                        onClick={() => router.back()}
                        className="px-6 py-3 bg-white border border-neutral-200 text-neutral-900 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                        Back
                    </button>

                    <div className="flex gap-3">
                        <button
                            onClick={() => router.push(`/group/transfer-instructions?tripId=${tripId}`)}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                        >
                            View Transfer Instructions
                        </button>
                        <button
                            onClick={() => {/* Export or share strategy */ }}
                            className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors"
                        >
                            Share Strategy
                        </button>
                    </div>
                </div>
                </>
                )}
            </div>
        </div>
    );
}
