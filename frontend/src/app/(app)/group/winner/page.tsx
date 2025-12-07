'use client';

import { useRouter } from 'next/navigation';
import { Trophy, MapPin, DollarSign, Users, Calendar, Plane, Hotel, Activity, Zap, Download, Share2 } from 'lucide-react';

export default function GroupWinner() {
    const router = useRouter();

    const winner = {
        name: 'Balanced Group Route',
        cities: [
            { name: 'Paris', days: 4, flights: '$450', hotels: '$600', activities: '$350' },
            { name: 'Barcelona', days: 3, flights: '$280', hotels: '$420', activities: '$280' },
            { name: 'Rome', days: 4, flights: '$320', hotels: '$560', activities: '$320' },
            { name: 'Amsterdam', days: 3, flights: '$240', hotels: '$450', activities: '$240' },
        ],
        totalCostPerPerson: 4800,
        groupSize: 4,
        totalDays: 14,
        averageRank: 1.25,
        votes: [
            { member: 'Sarah Chen', rank: 1 },
            { member: 'Michael Rodriguez', rank: 1 },
            { member: 'Emma Thompson', rank: 2 },
            { member: 'David Kim', rank: 1 },
        ],
    };

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-6xl mx-auto">
                {/* Hero Section */}
                <div className="bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-700 text-white rounded-3xl p-12 mb-8">
                    <div className="flex items-start justify-between mb-8">
                        <div>
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 rounded-full text-sm mb-6">
                                <Trophy className="w-4 h-4" />
                                <span>Selected by Your Group</span>
                            </div>
                            <h1 className="text-5xl mb-4 tracking-tight">{winner.name}</h1>
                            <p className="text-xl text-neutral-300">
                                Your European adventure starts here
                            </p>
                        </div>

                        <div className="text-right">
                            <div className="text-neutral-400 text-sm mb-2">Avg Rank</div>
                            <div className="text-6xl">{winner.averageRank.toFixed(2)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-6 pt-8 border-t border-white/20">
                        <div>
                            <div className="flex items-center gap-2 text-neutral-300 mb-2">
                                <Calendar className="w-4 h-4" />
                                <span className="text-sm">Duration</span>
                            </div>
                            <div className="text-3xl">{winner.totalDays} days</div>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 text-neutral-300 mb-2">
                                <MapPin className="w-4 h-4" />
                                <span className="text-sm">Cities</span>
                            </div>
                            <div className="text-3xl">{winner.cities.length}</div>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 text-neutral-300 mb-2">
                                <DollarSign className="w-4 h-4" />
                                <span className="text-sm">Per Person</span>
                            </div>
                            <div className="text-3xl">${winner.totalCostPerPerson.toLocaleString()}</div>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 text-neutral-300 mb-2">
                                <Users className="w-4 h-4" />
                                <span className="text-sm">Group Total</span>
                            </div>
                            <div className="text-3xl">${(winner.totalCostPerPerson * winner.groupSize).toLocaleString()}</div>
                        </div>
                    </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Itinerary Details */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Cities Breakdown */}
                        <div className="bg-white border border-neutral-200 rounded-2xl p-8">
                            <h2 className="text-2xl mb-6">Itinerary Breakdown</h2>

                            <div className="space-y-4">
                                {winner.cities.map((city, index) => (
                                    <div key={index} className="border border-neutral-200 rounded-xl overflow-hidden">
                                        {/* City Header */}
                                        <div className="bg-neutral-50 p-6 border-b border-neutral-200">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-neutral-900 text-white rounded-xl flex items-center justify-center text-xl">
                                                        {index + 1}
                                                    </div>
                                                    <div>
                                                        <h3 className="text-xl mb-1">{city.name}</h3>
                                                        <div className="flex items-center gap-2 text-sm text-neutral-600">
                                                            <Calendar className="w-4 h-4" />
                                                            <span>{city.days} days</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <div className="text-2xl">
                                                        ${(parseInt(city.flights.replace('$', '')) +
                                                            parseInt(city.hotels.replace('$', '')) +
                                                            parseInt(city.activities.replace('$', ''))).toLocaleString()}
                                                    </div>
                                                    <div className="text-sm text-neutral-600">per person</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Cost Details */}
                                        <div className="p-6">
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="p-4 bg-neutral-50 rounded-xl">
                                                    <div className="flex items-center gap-2 text-neutral-600 mb-2">
                                                        <Plane className="w-4 h-4" />
                                                        <span className="text-sm">Flights</span>
                                                    </div>
                                                    <div className="text-xl">{city.flights}</div>
                                                </div>

                                                <div className="p-4 bg-neutral-50 rounded-xl">
                                                    <div className="flex items-center gap-2 text-neutral-600 mb-2">
                                                        <Hotel className="w-4 h-4" />
                                                        <span className="text-sm">Hotels</span>
                                                    </div>
                                                    <div className="text-xl">{city.hotels}</div>
                                                </div>

                                                <div className="p-4 bg-neutral-50 rounded-xl">
                                                    <div className="flex items-center gap-2 text-neutral-600 mb-2">
                                                        <Activity className="w-4 h-4" />
                                                        <span className="text-sm">Activities</span>
                                                    </div>
                                                    <div className="text-xl">{city.activities}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Total Summary */}
                        <div className="bg-white border border-neutral-200 rounded-2xl p-8">
                            <h2 className="text-2xl mb-6">Total Cost Summary</h2>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center pb-4 border-b border-neutral-200">
                                    <span className="text-neutral-600">Flights</span>
                                    <span className="text-xl">
                                        ${winner.cities.reduce((sum, c) => sum + parseInt(c.flights.replace('$', '')), 0).toLocaleString()} pp
                                    </span>
                                </div>

                                <div className="flex justify-between items-center pb-4 border-b border-neutral-200">
                                    <span className="text-neutral-600">Hotels</span>
                                    <span className="text-xl">
                                        ${winner.cities.reduce((sum, c) => sum + parseInt(c.hotels.replace('$', '')), 0).toLocaleString()} pp
                                    </span>
                                </div>

                                <div className="flex justify-between items-center pb-4 border-b border-neutral-200">
                                    <span className="text-neutral-600">Activities</span>
                                    <span className="text-xl">
                                        ${winner.cities.reduce((sum, c) => sum + parseInt(c.activities.replace('$', '')), 0).toLocaleString()} pp
                                    </span>
                                </div>

                                <div className="flex justify-between items-center pt-4">
                                    <span className="text-lg">Total Per Person</span>
                                    <span className="text-3xl">${winner.totalCostPerPerson.toLocaleString()}</span>
                                </div>

                                <div className="flex justify-between items-center pt-4 bg-neutral-50 rounded-xl p-4">
                                    <span className="text-lg">Group Total ({winner.groupSize} people)</span>
                                    <span className="text-3xl">${(winner.totalCostPerPerson * winner.groupSize).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* Voting Results */}
                        <div className="bg-white border border-neutral-200 rounded-2xl p-6">
                            <h3 className="text-lg mb-6">How Members Voted</h3>

                            <div className="space-y-3">
                                {winner.votes.map((vote, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
                                        <span className="text-sm">{vote.member}</span>
                                        <span className={`px-3 py-1 rounded-lg text-sm ${vote.rank === 1 ? 'bg-neutral-900 text-white' : 'bg-neutral-200 text-neutral-600'
                                            }`}>
                                            #{vote.rank}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Points Optimization */}
                        <div className="bg-neutral-900 text-white rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Zap className="w-5 h-5" />
                                <h3 className="text-lg">Points Optimization</h3>
                            </div>
                            <p className="text-sm text-neutral-300 mb-6">
                                Use your combined 315k points to save up to $1,260 on flights and hotels
                            </p>
                            <button
                                className="w-full px-4 py-3 bg-white text-neutral-900 rounded-xl hover:bg-neutral-100 transition-colors text-sm"
                                onClick={() => router.push('/group/points-strategy')}
                            >
                                View Points Strategy
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="space-y-3">
                            <button className="w-full px-6 py-4 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2">
                                <Download className="w-5 h-5" />
                                <span>Export Itinerary</span>
                            </button>

                            <button className="w-full px-6 py-4 bg-white border border-neutral-200 text-neutral-900 rounded-xl hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2">
                                <Share2 className="w-5 h-5" />
                                <span>Share with Group</span>
                            </button>

                            <button className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors">
                                Start Booking
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
