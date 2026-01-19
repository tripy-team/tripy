'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, CreditCard, Plane, Hotel, Activity, Zap, TrendingUp, DollarSign, Check, LucideIcon } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI } from '@/lib/api';

interface Member {
    id: string;
    name: string;
    initials: string;
    totalPoints: number;
    cards: Array<{ program: string; points: number }>;
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
    const tripId = searchParams?.get('trip_id') || '';
    
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchMembers = async () => {
            if (!tripId) {
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                
                // Fetch trip members
                const membersResponse = await tripsAPI.listMembers(tripId);
                
                // Fetch points summary to get points per user
                const pointsResponse = await pointsAPI.summary(tripId);
                
                // Transform members data
                // Note: We need user names, which might require a user lookup
                // For now, use userId and initials
                const transformedMembers: Member[] = membersResponse.members.map((member, index) => {
                    const userId = member.userId;
                    const initials = userId.substring(0, 2).toUpperCase();
                    
                    // Get points for this user from points summary
                    const userPoints = pointsResponse.items?.filter((item: { userId?: string }) => item.userId === userId) || [];
                    const totalPoints = userPoints.reduce((sum: number, item: { balance?: number }) => sum + (item.balance || 0), 0);
                    const cards = userPoints.map((item: { program?: string; balance?: number }) => ({
                        program: item.program || 'Unknown',
                        points: item.balance || 0,
                    }));
                    
                    return {
                        id: userId,
                        name: `User ${index + 1}`, // TODO: Get actual user name from user service
                        initials: initials,
                        totalPoints: totalPoints,
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
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Winner</span>
                    </button>

                    <h1 className="text-4xl mb-3 tracking-tight">Points Strategy</h1>
                    <p className="text-neutral-600">Optimized booking assignments to maximize credit card points value</p>
                </div>

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
                                            {member.cards.map((card, idx) => (
                                                <div key={idx} className="flex items-center justify-between px-4 py-2 bg-neutral-50 rounded-lg">
                                                    <div className="flex items-center gap-2">
                                                        <CreditCard className="w-4 h-4 text-neutral-600" />
                                                        <span className="text-sm text-neutral-900">{card.program}</span>
                                                    </div>
                                                    <span className="text-sm text-neutral-600">{card.points.toLocaleString()} pts</span>
                                                </div>
                                            ))}
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

                    <button
                        onClick={() => {/* Export or share strategy */ }}
                        className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors"
                    >
                        Share Strategy
                    </button>
                </div>
            </div>
        </div>
    );
}
