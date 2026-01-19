'use client';

import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Zap, MapPin, Users, Calendar } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI } from '@/lib/api';

interface TripInfo {
    name: string;
    admin: string;
    cities: string[];
    duration: number;
    startDate: string;
    currentMembers: number;
}

export default function GroupMemberJoin({ params }: { params: Promise<{ inviteCode: string }> }) {
    const { inviteCode } = use(params);
    const router = useRouter();
    const [budget, setBudget] = useState(5000);
    const [points, setPoints] = useState(100000);
    const [airport, setAirport] = useState('');
    const [tripInfo, setTripInfo] = useState<TripInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isJoining, setIsJoining] = useState(false);

    useEffect(() => {
        const fetchTripInfo = async () => {
            try {
                setIsLoading(true);
                const trip = await tripsAPI.getByInvite(inviteCode);
                
                // Calculate duration
                const startDate = trip.startDate ? new Date(trip.startDate) : null;
                const endDate = trip.endDate ? new Date(trip.endDate) : null;
                const duration = startDate && endDate 
                    ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                
                // Format start date
                const startDateStr = startDate 
                    ? startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'TBD';
                
                // Get destinations
                const cities = (trip.destinations || []) as string[];
                
                // Get admin name (for now, use createdBy or a placeholder)
                const admin = 'Trip Organizer'; // TODO: Get actual admin name from user service
                
                setTripInfo({
                    name: trip.title || 'Group Trip',
                    admin: admin,
                    cities: cities,
                    duration: duration,
                    startDate: startDateStr,
                    currentMembers: trip.memberCount || 1,
                });
            } catch (err) {
                console.error('Error fetching trip info:', err);
                // Show error or redirect
            } finally {
                setIsLoading(false);
            }
        };

        fetchTripInfo();
    }, [inviteCode]);

    const handleJoin = async () => {
        try {
            setIsJoining(true);
            
            // 1. Join trip with invite code
            const joinResult = await tripsAPI.join(inviteCode);
            const tripId = joinResult.tripId;
            
            // 2. Save user's points if provided
            if (points > 0) {
                await pointsAPI.upsert({
                    trip_id: tripId,
                    program: 'User Points',
                    balance: points,
                });
            }
            
            // 3. TODO: Update user profile with airport (when endpoint is available)
            // await userAPI.updateProfile({ default_home_airport: airport });
            
            // 4. Navigate to group dashboard with trip_id
            router.push(`/group/dashboard?trip_id=${tripId}`);
        } catch (err) {
            console.error('Error joining trip:', err);
            alert('Failed to join trip. Please try again.');
        } finally {
            setIsJoining(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-4 text-slate-600">Loading trip information...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!tripInfo) {
        return (
            <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center py-16">
                        <h1 className="text-2xl mb-4 text-slate-900 font-bold">Invalid Invite Code</h1>
                        <p className="text-slate-600">The invite code you provided is not valid.</p>
                    </div>
                </div>
            </div>
        );
    }

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
                            disabled={!airport || isJoining}
                            className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-400/20 font-semibold text-lg"
                        >
                            {isJoining ? 'Joining...' : 'Join Trip'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
