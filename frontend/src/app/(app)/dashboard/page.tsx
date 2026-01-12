'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Calendar, CreditCard, Users, Plane, TrendingUp } from 'lucide-react';
import { TripCard } from '@/components/TripCard';
import { ExploreMap } from '@/components/ExploreMap';

export default function Dashboard() {
    const [viewMode, setViewMode] = useState<'trips' | 'explore'>('trips');

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
            status: 'upcoming' as const,
            type: 'solo' as const,
            pointsUsed: 85000,
            cashSpent: 450,
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
            status: 'planning' as const,
            type: 'group' as const,
            pointsUsed: 120000,
            cashSpent: 890,
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
            cashSpent: 320,
            thumbnail: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&q=80',
            members: 1,
            hotel: 'Four Seasons Resort Bali',
            flightClass: 'Economy'
        },
        {
            id: '4',
            name: 'NYC Business Trip',
            destination: 'New York, USA',
            dates: 'Feb 5 - Feb 8, 2025',
            status: 'planning' as const,
            type: 'solo' as const,
            pointsUsed: 45000,
            cashSpent: 200,
            thumbnail: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80',
            members: 1,
            hotel: 'The St. Regis New York',
            flightClass: 'First Class'
        }
    ];

    const upcomingTrips = trips.filter(t => t.status === 'upcoming');
    const planningTrips = trips.filter(t => t.status === 'planning');

    // Calculate stats
    const totalPointsUsed = trips.reduce((sum, trip) => sum + trip.pointsUsed, 0);
    const totalCashSpent = trips.reduce((sum, trip) => sum + trip.cashSpent, 0);

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
                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Plane className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="text-sm text-slate-600">Total Trips</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{trips.length}</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                                <CreditCard className="w-5 h-5 text-yellow-600" />
                            </div>
                            <div className="text-sm text-slate-600">Points Used</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{totalPointsUsed.toLocaleString()}</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="text-sm text-slate-600">Cash Spent</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">${totalCashSpent}</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="text-sm text-slate-600">Upcoming</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{upcomingTrips.length}</div>
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

                        {/* Planning Trips */}
                        {planningTrips.length > 0 && (
                            <div>
                                <h2 className="text-2xl mb-4 text-slate-900 font-semibold">In Planning</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {planningTrips.map(trip => (
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

