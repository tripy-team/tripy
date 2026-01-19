'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, CreditCard, Users, Plane, TrendingUp } from 'lucide-react';
import { TripCard } from '@/components/trip-card';
import { Trip } from '@/types';
import { trips as tripsAPI } from '@/lib/api';

interface ApiTrip {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  createdBy: string;
  role?: string;
  memberCount?: number;
  destinations?: string[];
  firstDestination?: string;
}

export default function Dashboard() {
    const [viewMode, setViewMode] = useState<'trips' | 'explore'>('trips');
    const [trips, setTrips] = useState<Trip[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Note: Authentication is handled by the AppLayout component

    useEffect(() => {
        const fetchTrips = async () => {
            try {
                setIsLoading(true);
                const response = await tripsAPI.list();
                
                // Transform API trips to display format
                const transformedTrips: Trip[] = response.trips.map((trip: ApiTrip) => {
                    // Format dates
                    const startDate = trip.startDate ? new Date(trip.startDate) : null;
                    const endDate = trip.endDate ? new Date(trip.endDate) : null;
                    const now = new Date();
                    
                    let datesStr = 'TBD';
                    if (startDate && endDate) {
                        datesStr = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                    } else if (startDate) {
                        datesStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                    
                    // Determine status
                    const isCompleted = endDate ? endDate < now : false;
                    const status: 'completed' | 'upcoming' | 'planning' = isCompleted ? 'completed' : (trip.status === 'active' ? 'upcoming' : 'planning');
                    
                    // Determine trip type (group if multiple members, solo otherwise)
                    const memberCount = trip.memberCount || 1;
                    const tripType: 'solo' | 'group' = memberCount > 1 ? 'group' : 'solo';
                    
                    // Get destination name or use first destination
                    const destinationName = trip.firstDestination || trip.title || 'Trip';
                    
                    // Generate optimized image URL (will be loaded via image-utils)
                    // For now, use a placeholder that will be optimized by the component
                    const thumbnail = `https://source.unsplash.com/400x300/?${encodeURIComponent(destinationName)}`;
                    
                    return {
                        id: trip.tripId,
                        name: trip.title || destinationName,
                        destination: destinationName,
                        dates: datesStr,
                        status: status,
                        type: tripType,
                        pointsUsed: 0, // TODO: Calculate from points data
                        cashSaved: 0, // TODO: Calculate from points data
                        thumbnail: thumbnail,
                        members: memberCount,
                        hotel: '', // TODO: Get from itinerary data
                        flightClass: '' // TODO: Get from itinerary data
                    };
                });
                
                setTrips(transformedTrips);
            } catch (err) {
                console.error('Error fetching trips:', err);
                // Keep empty array on error (don't show dummy data)
                setTrips([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTrips();
    }, []);

    const completedTrips = trips.filter(t => t.status === 'completed');
    const upcomingTrips = trips.filter(t => t.status === 'upcoming');
    const confirmedTrips = trips.filter(t => (t.status === 'upcoming' || t.status === 'planning') as boolean);

    // Calculate stats
    const totalCompletedTrips = completedTrips.length;
    const totalUpcomingAndConfirmed = confirmedTrips.length;
    const totalPointsUsed = trips.reduce((sum, trip) => sum + trip.pointsUsed, 0);
    const totalCashSaved = trips.reduce((sum, trip) => sum + trip.cashSaved, 0);

    if (isLoading) {
        return (
            <div className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
                <div className="max-w-7xl mx-auto px-8 py-8">
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-4 text-slate-600">Loading trips...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">You&apos;re maximizing your points!</h3>
                            <p className="text-slate-600">You&apos;ve saved <span className="font-bold text-green-600">${totalCashSaved.toLocaleString()}</span> by using {totalPointsUsed.toLocaleString()} points instead of cash</p>
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
                    <div className="flex items-center justify-center h-64 text-slate-400">
                        <p>No trips yet. Create your first trip to get started!</p>
                    </div>
                )}
            </div>
        </div>
    );
}

