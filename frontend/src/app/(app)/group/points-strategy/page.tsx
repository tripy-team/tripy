'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, Plane, Hotel, Activity, Zap, TrendingUp, DollarSign, Check, LucideIcon } from 'lucide-react';

interface Member {
    id: number;
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

    // Mock group members with their credit card points
    const members: Member[] = [
        {
            id: 1,
            name: 'Sarah Chen',
            initials: 'SC',
            totalPoints: 120000,
            cards: [
                { program: 'Chase Sapphire Reserve', points: 80000 },
                { program: 'Amex Gold', points: 40000 }
            ],
            budget: 5000
        },
        {
            id: 2,
            name: 'Michael Rodriguez',
            initials: 'MR',
            totalPoints: 95000,
            cards: [
                { program: 'Capital One Venture', points: 95000 }
            ],
            budget: 4500
        },
        {
            id: 3,
            name: 'Emma Thompson',
            initials: 'ET',
            totalPoints: 0,
            cards: [],
            budget: 6000
        },
        {
            id: 4,
            name: 'David Kim',
            initials: 'DK',
            totalPoints: 100000,
            cards: [
                { program: 'Chase Sapphire Preferred', points: 100000 }
            ],
            budget: 5200
        }
    ];

    // Optimized booking assignments
    const assignments: Assignment[] = [
        {
            category: 'Flights',
            icon: Plane,
            assignedTo: 'Sarah Chen',
            pointsUsed: 80000,
            cashValue: 1200,
            efficiency: 1.5,
            reason: 'Chase Sapphire Reserve offers 1.5¢ per point for travel redemption through their portal'
        },
        {
            category: 'Hotels',
            icon: Hotel,
            assignedTo: 'David Kim',
            pointsUsed: 85000,
            cashValue: 1100,
            efficiency: 1.29,
            reason: 'Chase Sapphire Preferred provides 1.25¢ per point value for hotel bookings'
        },
        {
            category: 'Activities & Tours',
            icon: Activity,
            assignedTo: 'Michael Rodriguez',
            pointsUsed: 45000,
            cashValue: 450,
            efficiency: 1.0,
            reason: 'Capital One Venture offers 1¢ per point for travel purchases with flexible redemption'
        },
        {
            category: 'Dining & Transport',
            icon: DollarSign,
            assignedTo: 'Emma Thompson',
            pointsUsed: 0,
            cashValue: 800,
            efficiency: 0,
            reason: 'Paid in cash - no points available. Other members maximize their high-value point redemptions'
        }
    ];

    const totalPointsUsed = assignments.reduce((sum, a) => sum + a.pointsUsed, 0);
    const totalCashValue = assignments.reduce((sum, a) => sum + a.cashValue, 0);
    const averageEfficiency = assignments
        .filter(a => a.pointsUsed > 0)
        .reduce((sum, a) => sum + a.efficiency, 0) / assignments.filter(a => a.pointsUsed > 0).length;

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
