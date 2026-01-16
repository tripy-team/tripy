'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Calendar, CreditCard, Users, Plane, TrendingUp } from 'lucide-react';
import { TripCard } from '@/components/trip-card';
import { ExploreMap } from '@/components/explore-map';

export default function Dashboard() {
    const router = useRouter();
    const [viewMode, setViewMode] = useState<'trips' | 'explore'>('trips');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is logged in
        const token = localStorage.getItem('auth_token');
        if (!token) {
            // User is not logged in, redirect to landing page
            router.push('/');
        } else {
            setLoading(false);
        }
    }, [router]);

    // Show loading state while checking auth
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="text-slate-600">Loading...</div>
                </div>
            </div>
        );
    }

    // TODO: Replace with API call to fetch user's trips
    // Endpoint needed: GET /trips (list user trips) or POST /trips/get for each trip
    // Also fetch user profile: GET /users/me
    // Mock trip data
    const trips = [
        {
            id: '1',
            name: 'Tokyo Adventure',
            destination: 'Tokyo, Japan',
            dates: 'Dec 20 - Dec 28, 2024',
            status: 'completed' as const,
            type: 'solo' as const,
            pointsUsed: 85000,
            cashSaved: 1200,
            thumbnail: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
            members: 1,
            hotel: 'Park Hyatt Tokyo',
            flightClass: 'Business'
        },
        {
            id: '2',
            name: 'European Summer',
            destination: 'Paris, France',
            dates: 'Jun 15 - Jun 25, 2025',
            status: 'upcoming' as const,
            type: 'group' as const,
            pointsUsed: 120000,
            cashSaved: 2400,
            thumbnail: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
            members: 4,
            hotel: 'Hôtel Plaza Athénée',
            flightClass: 'Economy'
        },
        {
            id: '3',
            name: 'Bali Retreat',
            destination: 'Bali, Indonesia',
            dates: 'Mar 10 - Mar 20, 2025',
            status: 'upcoming' as const,
            type: 'solo' as const,
            pointsUsed: 65000,
            cashSaved: 850,
            thumbnail: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&q=80',
            members: 1,
            hotel: 'Four Seasons Resort Bali',
            flightClass: 'Economy'
        },
        {
            id: '4',
            name: 'Iceland Northern Lights',
            destination: 'Reykjavik, Iceland',
            dates: 'Nov 12 - Nov 18, 2024',
            status: 'completed' as const,
            type: 'solo' as const,
            pointsUsed: 75000,
            cashSaved: 950,
            thumbnail: 'https://images.unsplash.com/photo-1504829857797-ddff29c27927?w=800&q=80',
            members: 1,
            hotel: 'ION Adventure Hotel',
            flightClass: 'Economy'
        },
        {
            id: '5',
            name: 'Santorini Escape',
            destination: 'Santorini, Greece',
            dates: 'Sep 5 - Sep 12, 2024',
            status: 'completed' as const,
            type: 'group' as const,
            pointsUsed: 95000,
            cashSaved: 1600,
            thumbnail: 'https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?w=800&q=80',
            members: 2,
            hotel: 'Katikies Hotel',
            flightClass: 'Business'
        }
    ];

    const completedTrips = trips.filter(t => t.status === 'completed');
    const upcomingTrips = trips.filter(t => t.status === 'upcoming');
    const confirmedTrips = trips.filter(t => t.status === 'upcoming' || t.status === 'planning');

    // Calculate stats
    const totalCompletedTrips = completedTrips.length;
    const totalUpcomingAndConfirmed = confirmedTrips.length;
    const totalPointsUsed = trips.reduce((sum, trip) => sum + trip.pointsUsed, 0);
    const totalCashSaved = trips.reduce((sum, trip) => sum + trip.cashSaved, 0);

    return (
        <div className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl mb-2 text-slate-900 font-bold">Welcome back!</h1>
                    <p className="text-slate-600">Manage your trips and discover new destinations</p>
                </div>

                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                <Plane className="w-5 h-5 text-white" />
                            </div>
                            <div className="text-sm text-blue-100">Completed Trips</div>
                        </div>
                        <div className="text-4xl text-white font-bold">{totalCompletedTrips}</div>
                        <div className="text-sm text-blue-100 mt-1">total completed</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="text-sm text-slate-600">Upcoming + Confirmed</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{totalUpcomingAndConfirmed}</div>
                        <div className="text-sm text-slate-500 mt-1">trips planned</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                                <CreditCard className="w-5 h-5 text-yellow-600" />
                            </div>
                            <div className="text-sm text-slate-600">Points Used</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{totalPointsUsed.toLocaleString()}</div>
                        <div className="text-sm text-slate-500 mt-1">across all trips</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="text-sm text-slate-600">Cash Saved</div>
                        </div>
                        <div className="text-3xl text-green-600 font-semibold">${totalCashSaved.toLocaleString()}</div>
                        <div className="text-sm text-slate-500 mt-1">vs paying cash</div>
                    </div>
                </div>

                {/* Value Proposition Banner */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 mb-8 border border-green-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">You're maximizing your points!</h3>
                            <p className="text-slate-600">You've saved <span className="font-bold text-green-600">${totalCashSaved.toLocaleString()}</span> by using {totalPointsUsed.toLocaleString()} points instead of cash</p>
                        </div>
                        <div className="hidden md:block">
                            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-8 h-8 text-white" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* View Toggle */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setViewMode('trips')}
                        className={`px-6 py-3 rounded-xl transition-all font-medium ${viewMode === 'trips'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-600 hover:text-blue-600'
                            }`}
                    >
                        My Trips
                    </button>
                    <button
                        onClick={() => setViewMode('explore')}
                        className={`px-6 py-3 rounded-xl transition-all font-medium ${viewMode === 'explore'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-600 hover:text-blue-600'
                            }`}
                    >
                        Explore Destinations
                    </button>
                </div>

                {/* Content Area */}
                {viewMode === 'trips' ? (
                    <div>
                        {/* Quick Actions */}
                        <div className="mb-8 flex gap-4">
                            <Link
                                href="/solo/setup"
                                className="flex-1 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 hover:shadow-xl transition-all group"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <Plane className="w-6 h-6" />
                                            <span className="text-xl font-semibold">Plan Solo Trip</span>
                                        </div>
                                        <p className="text-blue-100 text-sm">Optimize your points for a personal adventure</p>
                                    </div>
                                    <Plus className="w-8 h-8 opacity-50 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </Link>

                            <Link
                                href="/group/setup"
                                className="flex-1 bg-gradient-to-br from-yellow-400 to-yellow-500 text-slate-900 rounded-2xl p-6 hover:shadow-xl transition-all group"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <Users className="w-6 h-6" />
                                            <span className="text-xl font-semibold">Plan Group Trip</span>
                                        </div>
                                        <p className="text-slate-700 text-sm">Collaborate and vote on destinations together</p>
                                    </div>
                                    <Plus className="w-8 h-8 opacity-50 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </Link>
                        </div>

                        {/* Upcoming Trips */}
                        {upcomingTrips.length > 0 && (
                            <div className="mb-8">
                                <h2 className="text-2xl mb-4 text-slate-900 font-semibold">Upcoming Trips</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {upcomingTrips.map(trip => (
                                        <TripCard key={trip.id} trip={trip} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Completed Trips */}
                        {completedTrips.length > 0 && (
                            <div>
                                <h2 className="text-2xl mb-4 text-slate-900 font-semibold">Completed Trips</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {completedTrips.map(trip => (
                                        <TripCard key={trip.id} trip={trip} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empty State */}
                        {trips.length === 0 && (
                            <div className="text-center py-16">
                                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Plane className="w-10 h-10 text-blue-600" />
                                </div>
                                <h3 className="text-2xl mb-2 text-slate-900 font-semibold">No trips yet</h3>
                                <p className="text-slate-600 mb-6">Start planning your next adventure</p>
                                <div className="flex gap-4 justify-center">
                                    <Link
                                        href="/solo/setup"
                                        className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium"
                                    >
                                        Plan Solo Trip
                                    </Link>
                                    <Link
                                        href="/group/setup"
                                        className="px-6 py-3 bg-white text-blue-600 border-2 border-blue-600 rounded-xl hover:bg-blue-50 transition-all font-medium"
                                    >
                                        Plan Group Trip
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <ExploreMap />
                )}
            </div>
        </div>
    );
}

