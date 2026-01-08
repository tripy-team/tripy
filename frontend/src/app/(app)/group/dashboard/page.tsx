'use client';

import { useRouter } from 'next/navigation';
import { Users, DollarSign, Zap, MapPin, CheckCircle, Clock, Sparkles } from 'lucide-react';

export default function GroupDashboard() {
    const router = useRouter();

    // TODO: Fetch trip details, members, destinations, and points summary
    // Endpoints:
    // - POST /trips/get - Get trip details (trip_id from URL or context)
    // - POST /trips/members - Get all members
    // - POST /destinations/list - Get destinations
    // - POST /points/summary - Get aggregated points data
    const members = [
        { id: 1, name: 'Sarah Chen', initials: 'SC', budget: 5000, points: 120000, airport: 'JFK', status: 'complete' },
        { id: 2, name: 'Michael Rodriguez', initials: 'MR', budget: 4500, points: 95000, airport: 'LAX', status: 'complete' },
        { id: 3, name: 'Emma Thompson', initials: 'ET', budget: 6000, points: 0, airport: 'ORD', status: 'complete' },
        { id: 4, name: 'David Kim', initials: 'DK', budget: 5200, points: 100000, airport: 'SFO', status: 'complete' },
    ];

    const completedMembers = members.filter(m => m.status === 'complete');
    const totalBudget = completedMembers.reduce((sum, m) => sum + m.budget, 0);
    const totalPoints = completedMembers.reduce((sum, m) => sum + m.points, 0);
    const isReady = completedMembers.length === members.length;

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Group Trip Dashboard</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">European Adventure 2025</h1>
                    <p className="text-slate-600">
                        {completedMembers.length} of {members.length} members ready
                    </p>
                </div>

                {/* Stats */}
                <div className="grid md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <Users className="w-4 h-4" />
                            <span className="text-sm">Total Members</span>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{members.length}</div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <DollarSign className="w-4 h-4" />
                            <span className="text-sm">Total Budget</span>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">${totalBudget.toLocaleString()}</div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <Zap className="w-4 h-4" />
                            <span className="text-sm">Total Points</span>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{(totalPoints / 1000).toFixed(0)}k</div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-sm">Ready</span>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">
                            {completedMembers.length}/{members.length}
                        </div>
                    </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Members List */}
                    <div className="lg:col-span-2">
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                            <h2 className="text-2xl mb-6 text-slate-900 font-semibold">Members</h2>

                            <div className="space-y-3">
                                {members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-xl"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-semibold">
                                                {member.initials}
                                            </div>

                                            <div>
                                                <div className="font-semibold mb-1 text-slate-900">{member.name}</div>
                                                {member.status === 'complete' ? (
                                                    <div className="flex items-center gap-4 text-sm text-slate-600">
                                                        <span className="flex items-center gap-1">
                                                            <DollarSign className="w-3 h-3" />
                                                            ${member.budget.toLocaleString()}
                                                        </span>
                                                        {member.points > 0 && (
                                                            <span className="flex items-center gap-1">
                                                                <Zap className="w-3 h-3" />
                                                                {(member.points / 1000).toFixed(0)}k
                                                            </span>
                                                        )}
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="w-3 h-3" />
                                                            {member.airport}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 text-sm text-orange-600">
                                                        <Clock className="w-3 h-3" />
                                                        <span>Pending setup</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {member.status === 'complete' ? (
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                        ) : (
                                            <Clock className="w-5 h-5 text-orange-500" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                            <h3 className="text-lg mb-4 text-slate-900 font-semibold">Destinations</h3>
                            <div className="space-y-2">
                                {/* TODO: Replace with destinations from API */}
                                {['Paris', 'Barcelona', 'Rome', 'Amsterdam'].map((city) => (
                                    <div key={city} className="flex items-center gap-2 text-slate-600">
                                        <MapPin className="w-4 h-4 text-blue-600" />
                                        <span>{city}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {isReady ? (
                            <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 shadow-xl shadow-blue-600/20">
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="w-5 h-5" />
                                    <h3 className="text-lg font-semibold">Ready to Generate</h3>
                                </div>
                                <p className="text-sm text-blue-100 mb-6">
                                    All members have completed their profiles. Generate optimized itineraries for your group!
                                </p>
                                <button
                                    onClick={async () => {
                                        // TODO: Generate itineraries before navigating
                                        // Endpoint: POST /itinerary/generate
                                        // Data: trip_id (from URL or context)
                                        // Then navigate to /group/results
                                        router.push('/group/results');
                                    }}
                                    className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors mb-3 shadow-lg shadow-yellow-400/20 font-semibold"
                                >
                                    Generate Itineraries
                                </button>
                                <p className="text-xs text-blue-100 text-center">Or jump to:</p>
                                <div className="flex gap-2 mt-2">
                                    <button
                                        onClick={() => router.push('/group/voting')}
                                        className="flex-1 px-3 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-xs"
                                    >
                                        Voting
                                    </button>
                                    <button
                                        onClick={() => router.push('/group/comparison')}
                                        className="flex-1 px-3 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-xs"
                                    >
                                        Compare
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200">
                                <div className="flex items-center gap-2 mb-4">
                                    <Clock className="w-5 h-5 text-slate-600" />
                                    <h3 className="text-lg text-slate-900 font-semibold">Waiting for Members</h3>
                                </div>
                                <p className="text-sm text-slate-600">
                                    {members.length - completedMembers.length} member(s) still need to complete their profile
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
