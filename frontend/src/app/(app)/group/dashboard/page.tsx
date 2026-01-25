'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
    Users, DollarSign, Zap, MapPin, CheckCircle, Clock, Sparkles, Plus, X, 
    Copy, Check, RefreshCw, Share2, Settings, Loader2 
} from 'lucide-react';
import { 
    trips as tripsAPI, 
    destinations as destinationsAPI, 
    points as pointsAPI,
    Trip,
    Destination,
    PointsSummary
} from '@/lib/api';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';

interface GroupMember {
    userId: string;
    role: 'owner' | 'member';
    status: 'pending' | 'complete';
    name?: string;
    email?: string;
    budget?: number;
    points?: number;
    airport?: string;
}

function GroupDashboardContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
    
    // Loading & Error states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Trip data
    const [trip, setTrip] = useState<Trip | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [pointsSummary, setPointsSummary] = useState<PointsSummary | null>(null);
    
    // UI state
    const [newDestination, setNewDestination] = useState('');
    const [isAddingDestination, setIsAddingDestination] = useState(false);
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Fetch all trip data
    const fetchTripData = useCallback(async () => {
        if (!tripId) {
            setError('No trip ID provided. Please select a trip from My Trips.');
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            // Fetch trip details, members, destinations, and points in parallel
            const [tripData, membersData, destinationsData, pointsData] = await Promise.all([
                tripsAPI.get(tripId),
                tripsAPI.listMembers(tripId),
                destinationsAPI.list(tripId),
                pointsAPI.summary(tripId),
            ]);

            setTrip(tripData);
            
            // Transform members data
            const transformedMembers: GroupMember[] = membersData.members.map(m => ({
                userId: m.userId,
                role: m.role as 'owner' | 'member',
                status: (m.status || 'pending') as 'pending' | 'complete',
                name: m.name || `User ${m.userId.slice(0, 6)}`,
                budget: 0, // Will be populated from member preferences
                points: 0,
                airport: '',
            }));
            setMembers(transformedMembers);

            // Filter out start/end destinations for display
            const tripDestinations = destinationsData.destinations.filter(
                d => !d.isStart && !d.isEnd
            );
            setDestinations(tripDestinations);
            
            setPointsSummary(pointsData);

            // Generate invite link
            if (tripData.inviteCode) {
                const frontendUrl = typeof window !== 'undefined' 
                    ? window.location.origin 
                    : 'https://tripy.app';
                setInviteLink(`${frontendUrl}/group/join/${tripData.inviteCode}`);
            }

        } catch (err) {
            console.error('Error fetching trip data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load trip data');
        } finally {
            setIsLoading(false);
        }
    }, [tripId]);

    useEffect(() => {
        fetchTripData();
    }, [fetchTripData]);

    // Calculate totals
    const completedMembers = members.filter(m => m.status === 'complete');
    const totalBudget = completedMembers.reduce((sum, m) => sum + (m.budget || 0), 0);
    const totalPoints = pointsSummary?.totalPoints || 0;
    const isReady = members.length > 0 && completedMembers.length === members.length;

    // Add destination
    const handleAddDestination = async () => {
        if (!newDestination.trim() || !tripId) return;
        
        // Check if destination already exists
        if (destinations.some(d => d.name.toLowerCase() === newDestination.trim().toLowerCase())) {
            return;
        }

        setIsAddingDestination(true);
        try {
            await destinationsAPI.add({
                trip_id: tripId,
                name: newDestination.trim(),
                must_include: false,
                excluded: false,
            });
            
            // Refresh destinations
            const destinationsData = await destinationsAPI.list(tripId);
            const tripDestinations = destinationsData.destinations.filter(
                d => !d.isStart && !d.isEnd
            );
            setDestinations(tripDestinations);
            setNewDestination('');
        } catch (err) {
            console.error('Error adding destination:', err);
        } finally {
            setIsAddingDestination(false);
        }
    };

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

    // Generate itineraries
    const handleGenerateItineraries = async () => {
        if (!tripId) return;
        
        setIsGenerating(true);
        try {
            // Navigate to payment/results page
            router.push(`/group/payment?tripId=${tripId}`);
        } catch (err) {
            console.error('Error generating itineraries:', err);
        } finally {
            setIsGenerating(false);
        }
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
            <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading trip data...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <X className="w-8 h-8 text-red-600" />
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
        );
    }

    return (
        <div data-testid="group-dashboard-page" data-slot="GroupDashboard" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Group Trip Dashboard</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">
                                {trip?.title || 'Group Trip'}
                            </h1>
                            <p className="text-slate-600">
                                {completedMembers.length} of {members.length} members ready
                                {trip?.startDate && ` · ${new Date(trip.startDate).toLocaleDateString()}`}
                                {trip?.endDate && ` - ${new Date(trip.endDate).toLocaleDateString()}`}
                            </p>
                        </div>
                        <button
                            onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Trip Settings"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Invite Banner */}
                {inviteLink && (
                    <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Share2 className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <div className="font-medium text-slate-900">Invite your friends</div>
                                <div className="text-sm text-slate-600 font-mono">{inviteLink}</div>
                            </div>
                        </div>
                        <button
                            onClick={copyInviteLink}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? 'Copied!' : 'Copy Link'}
                        </button>
                    </div>
                )}

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
                        <div className="text-3xl text-slate-900 font-semibold">
                            {totalBudget > 0 ? `$${totalBudget.toLocaleString()}` : '—'}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <Zap className="w-4 h-4" />
                            <span className="text-sm">Total Points</span>
                        </div>
                        <div className="text-3xl text-slate-900 font-semibold">
                            {totalPoints > 0 ? `${(totalPoints / 1000).toFixed(0)}k` : '—'}
                        </div>
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
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-2xl text-slate-900 font-semibold">Members</h2>
                                <button
                                    onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    Manage Group
                                </button>
                            </div>

                            {members.length === 0 ? (
                                <div className="text-center py-8">
                                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                    <p className="text-slate-600">No members yet. Share the invite link to add members.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {members.map((member) => (
                                        <div
                                            key={member.userId}
                                            className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-xl"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-semibold">
                                                    {getInitials(member.name || 'U')}
                                                </div>

                                                <div>
                                                    <div className="font-semibold mb-1 text-slate-900 flex items-center gap-2">
                                                        {member.name || `User ${member.userId.slice(0, 6)}`}
                                                        {member.role === 'owner' && (
                                                            <span className="text-xs px-2 py-0.5 bg-blue-200 text-blue-700 rounded-full">
                                                                Admin
                                                            </span>
                                                        )}
                                                    </div>
                                                    {member.status === 'complete' ? (
                                                        <div className="flex items-center gap-4 text-sm text-slate-600">
                                                            {member.budget && member.budget > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <DollarSign className="w-3 h-3" />
                                                                    ${member.budget.toLocaleString()}
                                                                </span>
                                                            )}
                                                            {member.points && member.points > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <Zap className="w-3 h-3" />
                                                                    {(member.points / 1000).toFixed(0)}k
                                                                </span>
                                                            )}
                                                            {member.airport && (
                                                                <span className="flex items-center gap-1">
                                                                    <MapPin className="w-3 h-3" />
                                                                    {member.airport}
                                                                </span>
                                                            )}
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
                            )}
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* Destinations */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                            <h3 className="text-lg mb-4 text-slate-900 font-semibold">Destinations</h3>
                            
                            {destinations.length === 0 ? (
                                <p className="text-slate-500 text-sm mb-4">No destinations added yet.</p>
                            ) : (
                                <div className="space-y-3 mb-4">
                                    {destinations.map((dest) => (
                                        <div key={dest.destinationId} className="flex items-center justify-between group">
                                            <div className="flex items-center gap-2 text-slate-600">
                                                <MapPin className="w-4 h-4 text-blue-600" />
                                                <span>{dest.name}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <DestinationAutocomplete
                                    value={newDestination}
                                    onChange={setNewDestination}
                                    onSelect={(city) => {
                                        setNewDestination(city);
                                        // Auto-add when selected from autocomplete
                                        if (city && !destinations.some(d => d.name.toLowerCase() === city.toLowerCase())) {
                                            setNewDestination(city);
                                        }
                                    }}
                                    placeholder="Add city..."
                                    className="flex-1"
                                />
                                <button
                                    onClick={handleAddDestination}
                                    disabled={!newDestination.trim() || isAddingDestination}
                                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {isAddingDestination ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Plus className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Points Summary */}
                        {pointsSummary && pointsSummary.items.length > 0 && (
                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                <h3 className="text-lg mb-4 text-slate-900 font-semibold">Points Pool</h3>
                                <div className="space-y-2">
                                    {pointsSummary.items.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <span className="text-slate-600">{item.program}</span>
                                            <span className="font-medium text-slate-900">
                                                {(item.balance || 0).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between">
                                        <span className="font-medium text-slate-900">Total</span>
                                        <span className="font-bold text-blue-600">
                                            {pointsSummary.totalPoints.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Generate CTA */}
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
                                    onClick={handleGenerateItineraries}
                                    disabled={isGenerating}
                                    className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors mb-3 shadow-lg shadow-yellow-400/20 font-semibold disabled:opacity-50"
                                >
                                    {isGenerating ? 'Generating...' : 'Generate Itineraries'}
                                </button>
                                <p className="text-xs text-blue-100 text-center">Or jump to:</p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    <button
                                        onClick={() => router.push(`/group/itinerary?tripId=${tripId}`)}
                                        className="flex-1 min-w-0 px-3 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-xs"
                                    >
                                        Itinerary
                                    </button>
                                    <button
                                        onClick={() => router.push(`/group/comparison?tripId=${tripId}`)}
                                        className="flex-1 min-w-0 px-3 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-xs"
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
                                    {members.length === 0 
                                        ? 'Share the invite link to add members to your trip.'
                                        : `${members.length - completedMembers.length} member(s) still need to complete their profile`
                                    }
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function GroupDashboard() {
    return (
        <Suspense fallback={
            <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading...</p>
                </div>
            </div>
        }>
            <GroupDashboardContent />
        </Suspense>
    );
}
