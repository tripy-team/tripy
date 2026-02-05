'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Calendar, CreditCard, Plane, TrendingUp, Loader2 } from 'lucide-react';
import { TripCard } from '@/components/trip-card';
import { Trip } from '@/types';
import { trips as tripsAPI, users } from '@/lib/api';

// Initial batch size for fast loading
const INITIAL_LOAD_LIMIT = 9;
const LOAD_MORE_BATCH_SIZE = 12;

// User savings stats
interface UserSavingsStats {
    totalSavings: number;
    totalPointsUsed: number;
}

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

// Transform API trip to display format - outside component for performance
function transformApiTrip(trip: ApiTrip): Trip {
    const startDate = trip.startDate ? new Date(trip.startDate) : null;
    const endDate = trip.endDate ? new Date(trip.endDate) : null;
    const now = new Date();
    
    let datesStr = 'TBD';
    if (startDate && endDate) {
        datesStr = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (startDate) {
        datesStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    
    const isCompleted = endDate ? endDate < now : false;
    const status: 'completed' | 'upcoming' | 'planning' = isCompleted ? 'completed' : (trip.status === 'active' ? 'upcoming' : 'planning');
    const memberCount = trip.memberCount || 1;
    const tripType: 'solo' | 'group' = memberCount > 1 ? 'group' : 'solo';
    const destinationName = trip.firstDestination || trip.title || 'Trip';
    
    return {
        id: trip.tripId,
        name: trip.title || destinationName,
        destination: destinationName,
        dates: datesStr,
        status: status,
        type: tripType,
        pointsUsed: 0,
        cashSaved: 0,
        thumbnail: '',
        members: memberCount
    };
}

export default function Dashboard() {
    const [trips, setTrips] = useState<Trip[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [totalTrips, setTotalTrips] = useState(0);
    const [userSavings, setUserSavings] = useState<UserSavingsStats>({
        totalSavings: 0,
        totalPointsUsed: 0
    });

    // Initial load - fetch trips and user savings
    useEffect(() => {
        const fetchTrips = async () => {
            try {
                setIsLoading(true);
                const response = await tripsAPI.list({
                    limit: INITIAL_LOAD_LIMIT,
                    offset: 0,
                    includeDetails: false
                });
                
                const transformedTrips: Trip[] = response.trips.map(transformApiTrip);
                setTrips(transformedTrips);
                setTotalTrips(response.total || transformedTrips.length);
                setHasMore(response.has_more || false);
            } catch (err) {
                console.error('Error fetching trips:', err);
                setTrips([]);
            } finally {
                setIsLoading(false);
            }
        };

        const fetchUserSavings = async () => {
            try {
                // Calculate and fetch user savings from completed trips
                const savingsData = await users.calculateSavings();
                setUserSavings({
                    totalSavings: savingsData.total_savings || 0,
                    totalPointsUsed: savingsData.total_points_used || 0
                });
            } catch (err) {
                console.error('Error fetching user savings:', err);
                // Fallback: try to get cached savings from profile
                try {
                    const savingsResult = await users.getSavings();
                    setUserSavings({
                        totalSavings: savingsResult.total_savings || 0,
                        totalPointsUsed: savingsResult.total_points_used || 0
                    });
                } catch {
                    // Silently fail - stats will show 0
                }
            }
        };

        fetchTrips();
        fetchUserSavings();
    }, []);

    // Load more trips
    const loadMoreTrips = useCallback(async () => {
        if (isLoadingMore || !hasMore) return;
        
        try {
            setIsLoadingMore(true);
            const response = await tripsAPI.list({
                limit: LOAD_MORE_BATCH_SIZE,
                offset: trips.length,
                includeDetails: false
            });
            
            const newTrips = response.trips.map(transformApiTrip);
            setTrips(prev => [...prev, ...newTrips]);
            setHasMore(response.has_more || false);
        } catch (err) {
            console.error('Error loading more trips:', err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [trips.length, hasMore, isLoadingMore]);

    // Memoized filtered trips
    const completedTrips = useMemo(() => trips.filter(t => t.status === 'completed'), [trips]);
    const upcomingTrips = useMemo(() => trips.filter(t => t.status === 'upcoming' || t.status === 'planning'), [trips]);

    // Calculate stats (memoized)
    const stats = useMemo(() => ({
        totalCompletedTrips: completedTrips.length,
        totalUpcomingAndConfirmed: upcomingTrips.length,
        totalPointsUsed: userSavings.totalPointsUsed,
        totalCashSaved: userSavings.totalSavings
    }), [completedTrips.length, upcomingTrips.length, userSavings]);

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
                        <div className="text-4xl text-white font-bold">{stats.totalCompletedTrips}</div>
                        <div className="text-sm text-blue-100 mt-1">total completed</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="text-sm text-slate-600">Upcoming + Confirmed</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{stats.totalUpcomingAndConfirmed}</div>
                        <div className="text-sm text-slate-500 mt-1">trips planned</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                                <CreditCard className="w-5 h-5 text-yellow-600" />
                            </div>
                            <div className="text-sm text-slate-600">Points Used</div>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">{stats.totalPointsUsed.toLocaleString()}</div>
                        <div className="text-sm text-slate-500 mt-1">across all trips</div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="text-sm text-slate-600">Cash Saved</div>
                        </div>
                        <div className="text-3xl text-green-600 font-semibold">${stats.totalCashSaved.toLocaleString()}</div>
                        <div className="text-sm text-slate-500 mt-1">vs paying cash</div>
                    </div>
                </div>

                {/* Value Proposition Banner */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 mb-8 border border-green-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">You&apos;re maximizing your points!</h3>
                            <p className="text-slate-600">You&apos;ve saved <span className="font-bold text-green-600">${stats.totalCashSaved.toLocaleString()}</span> by using {stats.totalPointsUsed.toLocaleString()} points instead of cash</p>
                        </div>
                        <div className="hidden md:block">
                            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-8 h-8 text-white" />
                            </div>
                        </div>
                    </div>
                </div>

                <div>
                    {/* Quick Actions */}
                    <div className="mb-8">
                        <Link
                            href="/solo/setup"
                            className="block bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Plane className="w-6 h-6" />
                                        <span className="text-xl font-semibold">Plan a Trip</span>
                                    </div>
                                    <p className="text-blue-100 text-sm">Optimize your points for your next adventure</p>
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
                        <div className="mb-8">
                            <h2 className="text-2xl mb-4 text-slate-900 font-semibold">Completed Trips</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {completedTrips.map(trip => (
                                    <TripCard key={trip.id} trip={trip} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Load More Button */}
                    {hasMore && (
                        <div className="flex justify-center mt-8 mb-8">
                            <button
                                onClick={loadMoreTrips}
                                disabled={isLoadingMore}
                                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
                            >
                                {isLoadingMore ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading more trips...
                                    </>
                                ) : (
                                    <>
                                        Load More Trips
                                        <span className="text-xs text-blue-200">
                                            ({totalTrips - trips.length} remaining)
                                        </span>
                                    </>
                                )}
                            </button>
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
                            <Link
                                href="/solo/setup"
                                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium inline-block"
                            >
                                Plan a Trip
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

