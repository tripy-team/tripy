'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, DollarSign, Clock, Users, Zap, TrendingUp, ArrowRight } from 'lucide-react';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCostPerPerson: number;
    pointsCost: number;
    score: number;
    votes: Array<{ member: string; rank: number }>;
    averageRank: number;
}

export default function GroupComparison() {
    const router = useRouter();
    const groupSize = 4;

    const itineraries: Itinerary[] = [
        {
            id: 1,
            name: 'Balanced Group Route',
            cities: [
                { name: 'Paris', days: 4 },
                { name: 'Barcelona', days: 3 },
                { name: 'Rome', days: 4 },
                { name: 'Amsterdam', days: 3 },
            ],
            totalCostPerPerson: 4800,
            pointsCost: 120000,
            score: 93,
            votes: [
                { member: 'Sarah Chen', rank: 1 },
                { member: 'Michael Rodriguez', rank: 1 },
                { member: 'Emma Thompson', rank: 2 },
                { member: 'David Kim', rank: 1 },
            ],
            averageRank: 1.25,
        },
        {
            id: 2,
            name: 'Budget Friendly',
            cities: [
                { name: 'Paris', days: 3 },
                { name: 'Barcelona', days: 4 },
                { name: 'Rome', days: 3 },
            ],
            totalCostPerPerson: 3900,
            pointsCost: 97500,
            score: 88,
            votes: [
                { member: 'Sarah Chen', rank: 2 },
                { member: 'Michael Rodriguez', rank: 3 },
                { member: 'Emma Thompson', rank: 1 },
                { member: 'David Kim', rank: 2 },
            ],
            averageRank: 2.0,
        },
        {
            id: 3,
            name: 'Extended Explorer',
            cities: [
                { name: 'Paris', days: 5 },
                { name: 'Barcelona', days: 4 },
                { name: 'Rome', days: 5 },
                { name: 'Amsterdam', days: 4 },
            ],
            totalCostPerPerson: 5600,
            pointsCost: 140000,
            score: 91,
            votes: [
                { member: 'Sarah Chen', rank: 3 },
                { member: 'Michael Rodriguez', rank: 2 },
                { member: 'Emma Thompson', rank: 3 },
                { member: 'David Kim', rank: 3 },
            ],
            averageRank: 2.75,
        },
    ];

    const sortedItineraries = [...itineraries].sort((a, b) => a.averageRank - b.averageRank);
    const winner = sortedItineraries[0];
    const [selectedIds, setSelectedIds] = useState<number[]>([1, 2]);

    const toggleSelection = (id: number) => {
        if (selectedIds.includes(id)) {
            if (selectedIds.length > 1) {
                setSelectedIds(selectedIds.filter(i => i !== id));
            }
        } else {
            setSelectedIds([...selectedIds, id]);
        }
    };

    const selectedItineraries = itineraries.filter(i => selectedIds.includes(i.id));

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-neutral-200 rounded-full text-sm text-neutral-600 mb-4">
                        <Users className="w-4 h-4" />
                        <span>Group Results · All votes in</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight">Compare Itineraries</h1>
                    <p className="text-neutral-600">Side-by-side comparison of your group&apos;s options</p>
                </div>

                {/* Winner Announcement */}
                <div className="bg-gradient-to-r from-neutral-900 to-neutral-700 text-white rounded-2xl p-8 mb-8">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-sm mb-4">
                                <TrendingUp className="w-4 h-4" />
                                <span>Group Winner</span>
                            </div>
                            <h2 className="text-3xl mb-2">{winner.name}</h2>
                            <p className="text-neutral-300 mb-6">
                                Average rank: {winner.averageRank.toFixed(2)} · {winner.cities.length} cities · {winner.cities.reduce((sum, c) => sum + c.days, 0)} days
                            </p>

                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => router.push('/group/winner')}
                                    className="px-6 py-3 bg-white text-neutral-900 rounded-xl hover:bg-neutral-100 transition-colors flex items-center gap-2"
                                >
                                    <span>View Winner Details</span>
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="text-right">
                            <div className="text-5xl mb-2">${winner.totalCostPerPerson.toLocaleString()}</div>
                            <div className="text-neutral-300">per person</div>
                        </div>
                    </div>
                </div>

                {/* Selection Controls */}
                <div className="flex items-center gap-3 mb-6">
                    <span className="text-sm text-neutral-600">Compare:</span>
                    {itineraries.map((itinerary) => (
                        <button
                            key={itinerary.id}
                            onClick={() => toggleSelection(itinerary.id)}
                            className={`px-4 py-2 rounded-xl transition-all text-sm ${selectedIds.includes(itinerary.id)
                                ? 'bg-neutral-900 text-white'
                                : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                }`}
                        >
                            {itinerary.name}
                        </button>
                    ))}
                </div>

                {/* Comparison Table */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
                    <div className="grid" style={{ gridTemplateColumns: `200px repeat(${selectedItineraries.length}, 1fr)` }}>
                        {/* Header Row */}
                        <div className="bg-neutral-50 border-b border-neutral-200 p-6"></div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="bg-neutral-50 border-b border-l border-neutral-200 p-6">
                                <h3 className="text-lg mb-2">{itinerary.name}</h3>
                                <div className="text-sm text-neutral-600">Avg rank: {itinerary.averageRank.toFixed(2)}</div>
                            </div>
                        ))}

                        {/* Cities */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <MapPin className="w-4 h-4 text-neutral-600" />
                                <span>Cities & Duration</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="space-y-2">
                                    {itinerary.cities.map((city, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <span className="text-neutral-900">{city.name}</span>
                                            <span className="text-neutral-600">{city.days} days</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Total Days */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <Clock className="w-4 h-4 text-neutral-600" />
                                <span>Total Duration</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.cities.reduce((sum, c) => sum + c.days, 0)} days</div>
                            </div>
                        ))}

                        {/* Cost Per Person */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <DollarSign className="w-4 h-4 text-neutral-600" />
                                <span>Cost Per Person</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">${itinerary.totalCostPerPerson.toLocaleString()}</div>
                            </div>
                        ))}

                        {/* Total Cost */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-neutral-600" />
                                <span>Total Group Cost</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">${(itinerary.totalCostPerPerson * groupSize).toLocaleString()}</div>
                                <div className="text-sm text-neutral-600 mt-1">for {groupSize} people</div>
                            </div>
                        ))}

                        {/* Points */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <Zap className="w-4 h-4 text-neutral-600" />
                                <span>Points Required</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                            </div>
                        ))}

                        {/* Score */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <TrendingUp className="w-4 h-4 text-neutral-600" />
                                <span>AI Score</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.score}/100</div>
                            </div>
                        ))}

                        {/* Votes Breakdown */}
                        <div className="p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-neutral-600" />
                                <span>Member Rankings</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-l border-neutral-200 p-6">
                                <div className="space-y-2">
                                    {itinerary.votes.map((vote, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <span className="text-neutral-600">{vote.member}</span>
                                            <span className={`px-2 py-0.5 rounded ${vote.rank === 1 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                                                }`}>
                                                #{vote.rank}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between mt-8">
                    <button
                        onClick={() => router.push('/group/voting')}
                        className="px-6 py-3 bg-white border border-neutral-200 text-neutral-900 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                        Back to Voting
                    </button>

                    <button
                        onClick={() => router.push('/group/winner')}
                        className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors flex items-center gap-2"
                    >
                        <span>Proceed with Winner</span>
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
