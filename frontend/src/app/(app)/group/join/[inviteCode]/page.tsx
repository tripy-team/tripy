'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Zap, MapPin, Users, Calendar } from 'lucide-react';

export default function GroupMemberJoin({ params }: { params: Promise<{ inviteCode: string }> }) {
    const { inviteCode } = use(params);
    const router = useRouter();
    const [budget, setBudget] = useState(5000);
    const [points, setPoints] = useState(100000);
    const [airport, setAirport] = useState('');

    // TODO: Fetch trip info on mount using invite code
    // Endpoint: POST /trips/join (validates invite and returns trip info)
    // Data needed: trip name, admin name, cities, dates, member count
    // Mock trip data
    const tripInfo = {
        name: 'European Adventure 2025',
        admin: 'Sarah Chen',
        cities: ['Paris', 'Barcelona', 'Rome', 'Amsterdam'],
        duration: 14,
        startDate: 'June 15, 2025',
        currentMembers: 2,
    };

    const handleJoin = async () => {
        // TODO: Implement backend integration:
        // 1. POST /trips/join - Join trip with invite code
        //    - invite_code: inviteCode from URL
        //    Returns: { trip_id, trip details }
        // 2. POST /points/upsert - Save user's points (if provided)
        //    - trip_id: from step 1
        //    - program: "User Points" or similar
        //    - balance: points value
        // 3. Update user profile with airport: PUT /users/profile
        //    - default_home_airport: airport value
        // 4. Navigate to /group/dashboard with trip_id
        router.push('/group/dashboard');
    };

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Joining Group Trip</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">Join {tripInfo.name}</h1>
                    <p className="text-slate-600">Complete your profile to join this group trip</p>
                    <p className="text-sm text-slate-500 mt-2">Invite code: {inviteCode}</p>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                    {/* Left - Trip Info */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <h3 className="text-lg mb-6 text-slate-900 font-semibold">Trip Overview</h3>

                        <div className="space-y-4 text-sm">
                            <div>
                                <div className="text-slate-600 mb-1">Organized by</div>
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-semibold">
                                        SC
                                    </div>
                                    <span className="text-slate-900">{tripInfo.admin}</span>
                                </div>
                            </div>

                            <div>
                                <div className="text-slate-600 mb-1">Duration</div>
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-blue-600" />
                                    <span className="text-slate-900">{tripInfo.duration} days</span>
                                </div>
                            </div>

                            <div>
                                <div className="text-slate-600 mb-1">Start Date</div>
                                <div className="text-slate-900">{tripInfo.startDate}</div>
                            </div>

                            <div>
                                <div className="text-slate-600 mb-1">Destinations</div>
                                <div className="flex flex-wrap gap-1">
                                    {tripInfo.cities.map((city) => (
                                        <span key={city} className="px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-slate-900">
                                            {city}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="text-slate-600 mb-1">Members</div>
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4 text-blue-600" />
                                    <span className="text-slate-900">{tripInfo.currentMembers} people</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right - Input Form */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <MapPin className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Starting Airport</h2>
                            </div>

                            <input
                                type="text"
                                value={airport}
                                onChange={(e) => setAirport(e.target.value)}
                                placeholder="e.g., JFK, LAX, ORD"
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            />
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <DollarSign className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Your Budget</h2>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-baseline gap-2 mb-3">
                                    <span className="text-4xl text-slate-900">${budget.toLocaleString()}</span>
                                    <span className="text-slate-500">per person</span>
                                </div>
                                <input
                                    type="range"
                                    min="1000"
                                    max="20000"
                                    step="100"
                                    value={budget}
                                    onChange={(e) => setBudget(Number(e.target.value))}
                                    className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                                />
                            </div>
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Zap className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Points (Optional)</h2>
                            </div>

                            <input
                                type="number"
                                value={points}
                                onChange={(e) => setPoints(Number(e.target.value))}
                                placeholder="Enter total points"
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            />
                        </div>

                        <button
                            onClick={handleJoin}
                            disabled={!airport}
                            className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-400/20 font-semibold text-lg"
                        >
                            Join Trip
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
