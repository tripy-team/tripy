'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
    Users, Clock, CheckCircle, Copy, Check, RefreshCw, 
    Sparkles, Share2, Settings, Loader2, Mail, ArrowRight,
    Bell, Calendar, MapPin, ExternalLink
} from 'lucide-react';
import { 
    trips as tripsAPI, 
    Trip,
} from '@/lib/api';
import { Navigation } from '@/components/navigation';

interface GroupMember {
    userId: string;
    role: 'owner' | 'member';
    status: 'pending' | 'complete';
    name?: string;
    email?: string;
}

function GroupWaitingContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
    
    // Loading & Error states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Trip data
    const [trip, setTrip] = useState<Trip | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    
    // UI state
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

    // Fetch trip data
    const fetchTripData = useCallback(async (showRefreshing = false) => {
        if (!tripId) {
            setError('No trip ID provided. Please select a trip from My Trips.');
            setIsLoading(false);
            return;
        }

        try {
            if (showRefreshing) {
                setIsRefreshing(true);
            } else {
                setIsLoading(true);
            }
            setError(null);

            // Fetch trip details and members in parallel
            const [tripData, membersData] = await Promise.all([
                tripsAPI.get(tripId),
                tripsAPI.listMembers(tripId),
            ]);

            setTrip(tripData);
            
            // Transform members data
            const transformedMembers: GroupMember[] = membersData.members.map(m => ({
                userId: m.userId,
                role: m.role as 'owner' | 'member',
                status: (m.status || 'pending') as 'pending' | 'complete',
                name: m.name || `User ${m.userId.slice(0, 6)}`,
            }));
            setMembers(transformedMembers);

            // Generate invite link
            if (tripData.inviteCode) {
                const frontendUrl = typeof window !== 'undefined' 
                    ? window.location.origin 
                    : 'https://tripy.app';
                setInviteLink(`${frontendUrl}/group/join/${tripData.inviteCode}`);
            }
            
            setLastRefresh(new Date());

        } catch (err) {
            console.error('Error fetching trip data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load trip data');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [tripId]);

    // Initial fetch
    useEffect(() => {
        fetchTripData();
    }, [fetchTripData]);

    // Auto-refresh every 30 seconds when enabled
    useEffect(() => {
        if (!autoRefreshEnabled || !tripId) return;

        const interval = setInterval(() => {
            fetchTripData(true);
        }, 30000);

        return () => clearInterval(interval);
    }, [autoRefreshEnabled, tripId, fetchTripData]);

    // Calculate member stats
    const completedMembers = members.filter(m => m.status === 'complete');
    const pendingMembers = members.filter(m => m.status === 'pending');
    const isReady = members.length > 0 && completedMembers.length === members.length;
    const progressPercent = members.length > 0 
        ? Math.round((completedMembers.length / members.length) * 100) 
        : 0;

    // Copy invite link
    const copyInviteLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Manual refresh
    const handleRefresh = () => {
        fetchTripData(true);
    };

    // Proceed to payment
    const handleProceed = () => {
        router.push(`/group/payment?tripId=${tripId}`);
    };

    // Get initials from name
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    if (isLoading) {
        return (
            <div>
                <Navigation />
                <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                    <div className="text-center">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading trip status...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div>
                <Navigation />
                <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                    <div className="text-center max-w-md">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-8 h-8 text-red-600" />
                        </div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Unable to Load Trip</h2>
                        <p className="text-slate-600 mb-6">{error}</p>
                        <button
                            onClick={() => router.push('/trips')}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                        >
                            Go to My Trips
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <Navigation />
            <div className="min-h-screen p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-100 rounded-full text-sm text-orange-700 font-medium">
                                <Clock className="w-4 h-4" />
                                <span>Waiting for Members</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                                    title="Refresh status"
                                >
                                    <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                    onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                    title="Trip Settings"
                                >
                                    <Settings className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">
                            {trip?.title || 'Group Trip'}
                        </h1>
                        <p className="text-slate-600">
                            Waiting for all members to complete their travel preferences before generating itineraries.
                        </p>
                        {trip?.startDate && (
                            <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                                <span className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    {new Date(trip.startDate).toLocaleDateString()}
                                    {trip.endDate && ` - ${new Date(trip.endDate).toLocaleDateString()}`}
                                </span>
                                {trip.destinations && trip.destinations.length > 0 && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="w-4 h-4" />
                                        {trip.destinations.slice(0, 3).join(', ')}
                                        {trip.destinations.length > 3 && ` +${trip.destinations.length - 3} more`}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Progress Card */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-slate-900">Member Progress</h2>
                            <div className="text-sm text-slate-500">
                                Last updated: {lastRefresh.toLocaleTimeString()}
                            </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-slate-700">
                                    {completedMembers.length} of {members.length} members ready
                                </span>
                                <span className="text-sm font-semibold text-slate-900">{progressPercent}%</span>
                            </div>
                            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full transition-all duration-500 ${
                                        isReady 
                                            ? 'bg-green-500' 
                                            : 'bg-blue-500'
                                    }`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>

                        {/* Auto-refresh toggle */}
                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <Bell className="w-4 h-4" />
                                <span>Auto-refresh every 30 seconds</span>
                            </div>
                            <button
                                onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                    autoRefreshEnabled ? 'bg-blue-600' : 'bg-slate-300'
                                }`}
                            >
                                <span
                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                        autoRefreshEnabled ? 'translate-x-7' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Members List */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
                        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            Group Members
                        </h2>

                        <div className="space-y-3">
                            {members.map((member) => (
                                <div
                                    key={member.userId}
                                    className={`flex items-center justify-between p-4 rounded-xl border ${
                                        member.status === 'complete'
                                            ? 'bg-green-50 border-green-200'
                                            : 'bg-orange-50 border-orange-200'
                                    }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${
                                            member.status === 'complete' ? 'bg-green-600' : 'bg-orange-500'
                                        }`}>
                                            {getInitials(member.name || 'U')}
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-900 flex items-center gap-2">
                                                {member.name || `User ${member.userId.slice(0, 6)}`}
                                                {member.role === 'owner' && (
                                                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                                                        Admin
                                                    </span>
                                                )}
                                            </div>
                                            <div className={`text-sm ${
                                                member.status === 'complete' 
                                                    ? 'text-green-700' 
                                                    : 'text-orange-700'
                                            }`}>
                                                {member.status === 'complete' 
                                                    ? 'Completed preferences' 
                                                    : 'Waiting for preferences'}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {member.status === 'complete' ? (
                                        <CheckCircle className="w-6 h-6 text-green-600" />
                                    ) : (
                                        <Clock className="w-6 h-6 text-orange-500 animate-pulse" />
                                    )}
                                </div>
                            ))}
                        </div>

                        {pendingMembers.length > 0 && (
                            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                                <div className="flex items-start gap-3">
                                    <Mail className="w-5 h-5 text-blue-600 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-medium text-blue-900">
                                            {pendingMembers.length} member{pendingMembers.length > 1 ? 's' : ''} still need{pendingMembers.length === 1 ? 's' : ''} to complete their preferences
                                        </p>
                                        <p className="text-sm text-blue-700 mt-1">
                                            Share the invite link below so they can join and set up their travel details.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Invite Link Section */}
                    {inviteLink && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
                            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                <Share2 className="w-5 h-5 text-blue-600" />
                                Invite Link
                            </h2>
                            <p className="text-slate-600 text-sm mb-4">
                                Share this link with your group members to let them join the trip and submit their preferences.
                            </p>
                            <div className="flex gap-3">
                                <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-600 font-mono text-sm overflow-x-auto">
                                    {inviteLink}
                                </div>
                                <button
                                    onClick={copyInviteLink}
                                    className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                                >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied!' : 'Copy Link'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Info Card - You can leave */}
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-2xl p-6 mb-6">
                        <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                            <ExternalLink className="w-5 h-5 text-slate-600" />
                            You can leave and come back anytime
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-600">
                            <li className="flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Your trip is saved. You can close this page and return later.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Access your trip anytime from <strong>My Trips</strong> in the navigation.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>When all members are ready, come back to generate your optimized itinerary.</span>
                            </li>
                        </ul>
                    </div>

                    {/* Action Section */}
                    {isReady ? (
                        <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl p-6 text-white shadow-xl shadow-green-600/20">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                                    <Sparkles className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold">All Members Ready!</h3>
                                    <p className="text-green-100 text-sm">
                                        Everyone has completed their preferences
                                    </p>
                                </div>
                            </div>
                            <p className="text-green-100 mb-6">
                                Your group is ready to generate optimized itineraries. Proceed to payment to 
                                unlock AI-powered route optimization and point transfer strategies.
                            </p>
                            <button
                                onClick={handleProceed}
                                className="w-full py-4 bg-white text-green-700 rounded-xl font-bold text-lg hover:bg-green-50 transition-colors flex items-center justify-center gap-2"
                            >
                                Proceed to Payment
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                                    <Clock className="w-6 h-6 text-orange-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-900">
                                        Waiting for {pendingMembers.length} more member{pendingMembers.length > 1 ? 's' : ''}
                                    </h3>
                                    <p className="text-slate-600 text-sm">
                                        Share the invite link to speed things up
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handleProceed}
                                disabled
                                className="w-full py-4 bg-slate-200 text-slate-400 rounded-xl font-medium cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                Proceed to Payment
                                <ArrowRight className="w-5 h-5" />
                            </button>
                            <p className="text-xs text-slate-500 text-center mt-3">
                                Available once all members complete their preferences
                            </p>
                        </div>
                    )}

                    {/* Quick Links */}
                    <div className="mt-6 flex flex-wrap gap-3 justify-center">
                        <button
                            onClick={() => router.push(`/group/dashboard?tripId=${tripId}`)}
                            className="text-sm text-slate-600 hover:text-blue-600 underline underline-offset-4"
                        >
                            View Dashboard
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                            onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                            className="text-sm text-slate-600 hover:text-blue-600 underline underline-offset-4"
                        >
                            Manage Group
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                            onClick={() => router.push('/trips')}
                            className="text-sm text-slate-600 hover:text-blue-600 underline underline-offset-4"
                        >
                            My Trips
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function GroupWaiting() {
    return (
        <Suspense fallback={
            <div>
                <Navigation />
                <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                    <div className="text-center">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading...</p>
                    </div>
                </div>
            </div>
        }>
            <GroupWaitingContent />
        </Suspense>
    );
}
