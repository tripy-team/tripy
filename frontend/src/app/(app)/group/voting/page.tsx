'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, DollarSign, Clock, Users, CheckCircle, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';

interface Itinerary {
    id: string;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCostPerPerson: number;
    pointsCost: number;
    score: number;
}

export default function GroupVoting() {
    const router = useRouter();
    const groupSize = 4;

    // TODO: Fetch itineraries from backend on mount
    // Endpoint: POST /itinerary/get
    // Data needed: trip_id (from URL or context)
    const [rankedItineraries, setRankedItineraries] = useState<Itinerary[]>([
        {
            id: '1',
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
        },
        {
            id: '2',
            name: 'Budget Friendly',
            cities: [
                { name: 'Paris', days: 3 },
                { name: 'Barcelona', days: 4 },
                { name: 'Rome', days: 3 },
            ],
            totalCostPerPerson: 3900,
            pointsCost: 97500,
            score: 88,
        },
        {
            id: '3',
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
        },
    ]);

    const [submitted, setSubmitted] = useState(false);

    // TODO: Fetch members and their voting status
    // Endpoint: POST /trips/members
    // May need separate endpoint for voting status or extend members response
    // Voting status for all members
    const members = [
        { id: 1, name: 'Sarah Chen', initials: 'SC', voted: false },
        { id: 2, name: 'Michael Rodriguez', initials: 'MR', voted: true },
        { id: 3, name: 'Emma Thompson', initials: 'ET', voted: true },
        { id: 4, name: 'David Kim', initials: 'DK', voted: false },
    ];

    const moveUp = (index: number) => {
        if (index === 0) return;
        const newItems = [...rankedItineraries];
        [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
        setRankedItineraries(newItems);
    };

    const moveDown = (index: number) => {
        if (index === rankedItineraries.length - 1) return;
        const newItems = [...rankedItineraries];
        [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
        setRankedItineraries(newItems);
    };

    const handleSubmit = async () => {
        // TODO: Submit ranking to backend
        // Endpoint: POST /itinerary/rank (may need to be added) or use destination voting
        // Data: trip_id, ranked itinerary IDs in order
        // For each itinerary, may need to vote on destinations or create ranking endpoint
        setSubmitted(true);
        // Navigate to results after a delay
        setTimeout(() => {
            router.push('/group/comparison');
        }, 1500);
    };

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Group Voting · European Adventure 2025</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">Rank your preferences</h1>
                    <p className="text-slate-600">Use the arrows to reorder itineraries from most to least preferred</p>
                </div>

                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Left - Ranking Area */}
                    <div className="lg:col-span-2">
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center justify-between mb-8">
                                <h2 className="text-2xl text-slate-900 font-semibold">Your Ranking</h2>
                                <div className="text-sm text-slate-600">Use arrows to reorder</div>
                            </div>

                            <div className="space-y-4">
                                {rankedItineraries.map((itinerary, index) => (
                                    <div
                                        key={itinerary.id}
                                        className="bg-white border-2 rounded-2xl overflow-hidden transition-all border-slate-200"
                                    >
                                        <div className="p-6">
                                            <div className="flex items-start gap-4">
                                                {/* Move Controls */}
                                                <div className="flex flex-col gap-1 flex-shrink-0 mt-2">
                                                    <button
                                                        onClick={() => moveUp(index)}
                                                        disabled={index === 0}
                                                        className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        <ArrowUp className="w-5 h-5 text-slate-600" />
                                                    </button>
                                                    <button
                                                        onClick={() => moveDown(index)}
                                                        disabled={index === rankedItineraries.length - 1}
                                                        className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        <ArrowDown className="w-5 h-5 text-slate-600" />
                                                    </button>
                                                </div>

                                                {/* Rank Badge */}
                                                <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-xl font-semibold ${index === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' :
                                                    index === 1 ? 'bg-yellow-400 text-slate-900' :
                                                        'bg-slate-100 text-slate-600'
                                                    }`}>
                                                    {index + 1}
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="text-xl mb-3 text-slate-900 font-semibold">{itinerary.name}</h3>

                                                    {/* Cities */}
                                                    <div className="flex flex-wrap gap-2 mb-4">
                                                        {itinerary.cities.map((city, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-sm"
                                                            >
                                                                <MapPin className="w-3 h-3 text-blue-600" />
                                                                <span className="text-slate-900">{city.name}</span>
                                                                <span className="text-slate-500">· {city.days}d</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Stats */}
                                                    <div className="flex items-center gap-6 text-sm text-slate-600">
                                                        <span className="flex items-center gap-1.5">
                                                            <DollarSign className="w-4 h-4" />
                                                            ${itinerary.totalCostPerPerson.toLocaleString()} pp
                                                        </span>
                                                        <span className="flex items-center gap-1.5">
                                                            <Clock className="w-4 h-4" />
                                                            {itinerary.cities.reduce((sum, c) => sum + c.days, 0)} days
                                                        </span>
                                                        <span className="flex items-center gap-1.5">
                                                            <Users className="w-4 h-4" />
                                                            ${(itinerary.totalCostPerPerson * groupSize).toLocaleString()} total
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Submit Button */}
                            <button
                                onClick={handleSubmit}
                                disabled={submitted}
                                className="w-full mt-8 px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-yellow-400/20 font-semibold"
                            >
                                {submitted ? (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        <span>Vote Submitted!</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Submit Your Ranking</span>
                                        <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Right Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* Voting Status */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                            <h3 className="text-lg mb-6 text-slate-900 font-semibold">Voting Status</h3>

                            <div className="space-y-3">
                                {members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-xl"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-semibold">
                                                {member.initials}
                                            </div>
                                            <span className="text-sm text-slate-900">{member.name}</span>
                                        </div>

                                        {member.voted ? (
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                        ) : (
                                            <div className="w-5 h-5 border-2 border-slate-300 rounded-full"></div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-200">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Progress</span>
                                    <span className="font-semibold text-slate-900">
                                        {members.filter(m => m.voted).length} / {members.length} voted
                                    </span>
                                </div>
                                <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-600 transition-all duration-500"
                                        style={{ width: `${(members.filter(m => m.voted).length / members.length) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>

                        {/* How it Works */}
                        <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200">
                            <h3 className="text-lg mb-4 text-slate-900 font-semibold">How it works</h3>
                            <div className="space-y-3 text-sm text-slate-600">
                                <div className="flex gap-3">
                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                                        1
                                    </div>
                                    <p>Use arrows to rank itineraries by preference</p>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                                        2
                                    </div>
                                    <p>Submit your ranking to the group</p>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                                        3
                                    </div>
                                    <p>We&apos;ll calculate the group&apos;s top choice</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
