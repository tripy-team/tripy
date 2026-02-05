'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
    Users, DollarSign, Zap, MapPin, CheckCircle, Clock, Sparkles, Plus, X, 
    Copy, Check, RefreshCw, Share2, Settings, Loader2, Receipt, UserPlus,
    UserCheck, UserX, Ban, Calendar, Trash2, Plane, Home, ArrowRightLeft, Lock
} from 'lucide-react';
import { 
    trips as tripsAPI, 
    destinations as destinationsAPI, 
    points as pointsAPI,
    users as usersAPI,
    Trip,
    Destination,
    PointsSummary
} from '@/lib/api';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import { formatProgramName } from '@/lib/programLabels';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface MemberPointsBalance {
    program: string;
    balance: number;
}

/**
 * Format points as a range for non-organizers (privacy)
 * e.g., 45000 -> "25k-50k"
 */
function formatPointsRange(points: number): string {
    if (points <= 0) return '0';
    if (points < 10000) return '<10k';
    if (points < 25000) return '10k-25k';
    if (points < 50000) return '25k-50k';
    if (points < 100000) return '50k-100k';
    if (points < 250000) return '100k-250k';
    if (points < 500000) return '250k-500k';
    return '500k+';
}

interface GroupMember {
    userId: string;
    role: 'owner' | 'member';
    status: 'pending' | 'complete' | 'denied';
    name?: string;
    email?: string;
    budget?: number;
    points?: number;
    airport?: string;
    arrivalAirport?: string;
    isRoundTrip?: boolean;
    pointsBalances?: MemberPointsBalance[];
    lifecycleState?: string;
    // Party size (travelers in this member's booking)
    adults?: number;
    children?: number;
    partySize?: number;
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
    const [startDestination, setStartDestination] = useState<Destination | null>(null);
    const [endDestination, setEndDestination] = useState<Destination | null>(null);
    const [pointsSummary, setPointsSummary] = useState<PointsSummary | null>(null);
    const [currentUserMember, setCurrentUserMember] = useState<GroupMember | null>(null);
    
    // UI state
    const [newDestination, setNewDestination] = useState('');
    const [isAddingDestination, setIsAddingDestination] = useState(false);
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    
    // Current user role state
    const [isCurrentUserOwner, setIsCurrentUserOwner] = useState(false);
    
    // Strategy payment state (for showing transfer strategy to non-organizers)
    const [isStrategyPaid, setIsStrategyPaid] = useState(false);
    
    // Member approval state
    const [approvingMemberId, setApprovingMemberId] = useState<string | null>(null);
    const [denyingMemberId, setDenyingMemberId] = useState<string | null>(null);
    
    // Destination management state
    const [removingDestinationId, setRemovingDestinationId] = useState<string | null>(null);
    const [updatingDestinationId, setUpdatingDestinationId] = useState<string | null>(null);

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

            // Fetch trip details, members, destinations, points, current user profile, and strategy status in parallel
            const [tripData, membersData, destinationsData, pointsData, profile, strategyStatus] = await Promise.all([
                tripsAPI.get(tripId),
                tripsAPI.listMembers(tripId),
                destinationsAPI.list(tripId),
                pointsAPI.summary(tripId),
                usersAPI.getProfile(),
                tripsAPI.getStrategyStatus(tripId).catch(() => ({ strategy_paid: false })),
            ]);

            setTrip(tripData);
            setIsStrategyPaid(strategyStatus.strategy_paid || tripData.strategyPaid || false);
            
            // Build points lookup by userId
            const pointsByUser: Record<string, MemberPointsBalance[]> = {};
            const totalPointsByUser: Record<string, number> = {};
            
            for (const item of pointsData.items || []) {
                const userId = item.userId;
                const program = item.program;
                const balance = item.balance || 0;
                
                if (userId && program && balance > 0) {
                    if (!pointsByUser[userId]) {
                        pointsByUser[userId] = [];
                        totalPointsByUser[userId] = 0;
                    }
                    pointsByUser[userId].push({ program, balance });
                    totalPointsByUser[userId] += balance;
                }
            }
            
            // Transform members data with points
            const transformedMembers: GroupMember[] = membersData.members.map(m => {
                // Extract budget and party size from member data
                const memberData = m as { 
                    userId: string; 
                    role: string; 
                    status?: string; 
                    name?: string;
                    max_cash_budget?: number;
                    budget?: number;
                    departure_airport?: string;
                    arrival_airport?: string;
                    is_round_trip?: boolean;
                    lifecycle_state?: string;
                    adults?: number;
                    children?: number;
                    party_size?: number;
                };
                const memberBudget = memberData.max_cash_budget ?? memberData.budget ?? 0;
                const memberAirport = memberData.departure_airport || '';
                const memberArrivalAirport = memberData.arrival_airport || '';
                const memberIsRoundTrip = memberData.is_round_trip ?? true; // Default to round trip
                const lifecycleState = memberData.lifecycle_state || '';
                const memberAdults = memberData.adults ?? 1;
                const memberChildren = memberData.children ?? 0;
                const memberPartySize = memberData.party_size ?? (memberAdults + memberChildren);
                
                // Determine status based on lifecycle_state or fallback to status field
                let memberStatus: 'pending' | 'complete' | 'denied' = 'pending';
                if (lifecycleState === 'inactive') {
                    memberStatus = 'denied';
                } else if (lifecycleState === 'approved_for_planning' || lifecycleState === 'approved_for_booking') {
                    memberStatus = 'complete';
                } else if (m.status === 'complete' || m.status === 'active') {
                    // For owners who might have status=complete but no lifecycle_state yet
                    memberStatus = m.role === 'owner' ? 'complete' : (m.status as 'pending' | 'complete');
                }
                
                return {
                    userId: m.userId,
                    role: m.role as 'owner' | 'member',
                    status: memberStatus,
                    name: m.name || `User ${m.userId.slice(0, 6)}`,
                    budget: memberBudget,
                    points: totalPointsByUser[m.userId] || 0,
                    airport: memberAirport,
                    arrivalAirport: memberArrivalAirport,
                    isRoundTrip: memberIsRoundTrip,
                    pointsBalances: pointsByUser[m.userId] || [],
                    lifecycleState: lifecycleState,
                    adults: memberAdults,
                    children: memberChildren,
                    partySize: memberPartySize,
                };
            });
            setMembers(transformedMembers);
            
            // Check if current user is the owner and store their member data
            const currentUserId = profile.userId;
            const currentMember = membersData.members.find(m => m.userId === currentUserId);
            setIsCurrentUserOwner(currentMember?.role === 'owner');
            
            // Store current user's member data for personalized route
            const currentUserData = transformedMembers.find(m => m.userId === currentUserId);
            setCurrentUserMember(currentUserData || null);

            // Separate start, end, and visit destinations
            const startDest = destinationsData.destinations.find(d => d.isStart);
            const endDest = destinationsData.destinations.find(d => d.isEnd);
            const tripDestinations = destinationsData.destinations.filter(
                d => !d.isStart && !d.isEnd
            );
            
            setStartDestination(startDest || null);
            setEndDestination(endDest || null);
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

    // Calculate totals (exclude denied members)
    const activeMembers = members.filter(m => m.status !== 'denied');
    const completedMembers = members.filter(m => m.status === 'complete');
    const pendingMembers = members.filter(m => m.status === 'pending');
    const totalBudget = completedMembers.reduce((sum, m) => sum + (m.budget || 0), 0);
    const totalPoints = pointsSummary?.totalPoints || 0;
    const isReady = activeMembers.length > 0 && completedMembers.length === activeMembers.length;

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

    // Remove destination
    const handleRemoveDestination = async (destinationId: string, destinationName: string) => {
        if (!tripId) return;
        
        const confirmed = confirm(`Are you sure you want to remove ${destinationName} from the trip?`);
        if (!confirmed) return;
        
        setRemovingDestinationId(destinationId);
        try {
            await destinationsAPI.remove(tripId, destinationId);
            
            // Refresh destinations
            const destinationsData = await destinationsAPI.list(tripId);
            const tripDestinations = destinationsData.destinations.filter(
                d => !d.isStart && !d.isEnd
            );
            setDestinations(tripDestinations);
        } catch (err) {
            console.error('Error removing destination:', err);
            alert('Failed to remove destination. Please try again.');
        } finally {
            setRemovingDestinationId(null);
        }
    };

    // Update destination departure date
    const handleUpdateDepartureDate = async (
        destinationId: string, 
        departureDate: string | undefined
    ) => {
        if (!tripId) return;
        
        setUpdatingDestinationId(destinationId);
        try {
            await destinationsAPI.update({
                trip_id: tripId,
                destination_id: destinationId,
                departure_date: departureDate || undefined,
            });
            
            // Update local state
            setDestinations(prev => prev.map(d => 
                d.destinationId === destinationId 
                    ? { ...d, departureDate: departureDate }
                    : d
            ));
        } catch (err) {
            console.error('Error updating departure date:', err);
            alert('Failed to update date. Please try again.');
        } finally {
            setUpdatingDestinationId(null);
        }
    };
    
    // Get minimum arrival date for a destination based on previous destination's departure or trip start
    const getMinArrivalDate = (index: number): string => {
        if (index === 0) {
            return trip?.startDate || new Date().toISOString().split('T')[0];
        }
        const prevDest = destinations[index - 1];
        if (prevDest?.departureDate) {
            // Arrival can be same day as previous departure (same-day connection)
            return prevDest.departureDate;
        }
        return trip?.startDate || new Date().toISOString().split('T')[0];
    };
    
    // Get minimum departure date for a destination (can't leave before arriving)
    const getMinDepartureDate = (dest: Destination, index: number): string => {
        if (dest.arrivalDate) {
            return dest.arrivalDate;
        }
        return getMinArrivalDate(index);
    };
    
    // Get maximum departure date for a destination
    const getMaxDepartureDate = (index: number): string => {
        // Can't depart after the next destination's arrival or trip end
        if (index < destinations.length - 1) {
            const nextDest = destinations[index + 1];
            if (nextDest?.arrivalDate) {
                return nextDest.arrivalDate;
            }
        }
        return trip?.endDate || '';
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

    // Approve a member
    const handleApproveMember = async (memberId: string, memberName: string) => {
        if (!tripId) return;
        
        setApprovingMemberId(memberId);
        try {
            await tripsAPI.adminUpdateLifecycleState(tripId, memberId, 'approved_for_planning');
            
            // Refresh member data
            await fetchTripData();
            
            // Success - member will receive an email notification
        } catch (err) {
            console.error('Error approving member:', err);
            alert('Failed to approve member. Please try again.');
        } finally {
            setApprovingMemberId(null);
        }
    };

    // Deny a member
    const handleDenyMember = async (memberId: string, memberName: string) => {
        if (!tripId) return;
        
        const confirmed = confirm(`Are you sure you want to deny ${memberName}? They will be removed from the trip and notified via email.`);
        if (!confirmed) return;
        
        setDenyingMemberId(memberId);
        try {
            await tripsAPI.adminUpdateLifecycleState(tripId, memberId, 'inactive');
            
            // Refresh member data
            await fetchTripData();
            
            // Success - member will receive an email notification
        } catch (err) {
            console.error('Error denying member:', err);
            alert('Failed to deny member. Please try again.');
        } finally {
            setDenyingMemberId(null);
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
        <div data-testid="group-dashboard-page" data-slot="GroupDashboard" className="min-h-full py-10 px-6 md:px-8 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
            <div className="max-w-6xl mx-auto space-y-10">
                {/* Header */}
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-100 rounded-full text-sm text-blue-700 font-medium">
                            <Users className="w-4 h-4" />
                            <span>Group Trip</span>
                        </div>
                        {isCurrentUserOwner ? (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 rounded-full text-sm text-amber-700 font-medium">
                                <Settings className="w-3.5 h-3.5" />
                                <span>Organizer</span>
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 rounded-full text-sm text-green-700 font-medium">
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Member</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-4xl md:text-5xl mb-4 tracking-tight text-slate-900 font-bold">
                                {trip?.title || 'Group Trip'}
                            </h1>
                            <p className="text-lg text-slate-600">
                                {completedMembers.length} of {activeMembers.length} members ready
                                {trip?.startDate && (
                                    <span className="text-slate-400"> · </span>
                                )}
                                {trip?.startDate && (
                                    <span className="text-blue-600 font-medium">
                                        {new Date(trip.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                )}
                                {trip?.endDate && (
                                    <span className="text-blue-600 font-medium">
                                        {' - '}
                                        {new Date(trip.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                )}
                            </p>
                        </div>
                        {isCurrentUserOwner && (
                            <button
                                onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                                className="p-3 text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm rounded-xl transition-all border border-transparent hover:border-slate-200"
                                title="Trip Settings"
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Invite Banner - Only visible to organizer */}
                {inviteLink && isCurrentUserOwner && (
                    <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shadow-inner">
                                <Share2 className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <div className="font-semibold text-slate-900 mb-0.5">Invite your friends</div>
                                <div className="text-sm text-slate-600 font-mono truncate max-w-[300px] md:max-w-none">{inviteLink}</div>
                            </div>
                        </div>
                        <button
                            onClick={copyInviteLink}
                            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium shadow-sm shadow-blue-600/20"
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? 'Copied!' : 'Copy Link'}
                        </button>
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 text-slate-500 mb-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Users className="w-4 h-4 text-blue-600" />
                            </div>
                            <span className="text-sm font-medium">Members</span>
                        </div>
                        <div className="text-3xl md:text-4xl text-slate-900 font-bold">{members.length}</div>
                    </div>

                    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 text-slate-500 mb-3">
                            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                <DollarSign className="w-4 h-4 text-green-600" />
                            </div>
                            <span className="text-sm font-medium">Budget</span>
                        </div>
                        <div className="text-3xl md:text-4xl text-slate-900 font-bold">
                            {totalBudget > 0 ? `$${totalBudget.toLocaleString()}` : '—'}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 text-slate-500 mb-3">
                            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                                <Zap className="w-4 h-4 text-amber-600" />
                            </div>
                            <span className="text-sm font-medium">Points</span>
                        </div>
                        <div className="text-3xl md:text-4xl text-slate-900 font-bold">
                            {totalPoints > 0 ? `${(totalPoints / 1000).toFixed(0)}k` : '—'}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 text-slate-500 mb-3">
                            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                            </div>
                            <span className="text-sm font-medium">Ready</span>
                        </div>
                        <div className="text-3xl md:text-4xl text-slate-900 font-bold">
                            {completedMembers.length}<span className="text-slate-400 text-2xl">/{activeMembers.length}</span>
                        </div>
                    </div>
                </div>

                {/* Members List - Full Width */}
                <div>
                    <div className="bg-white border border-slate-200/80 rounded-2xl p-6 md:p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Users className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-bold">Members</h2>
                            </div>
                            {isCurrentUserOwner && (
                                <button
                                    onClick={() => router.push(`/group/admin?tripId=${tripId}`)}
                                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    Manage Group
                                </button>
                            )}
                        </div>

                        {members.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Users className="w-8 h-8 text-slate-400" />
                                </div>
                                <p className="text-slate-600 text-lg">No members yet</p>
                                <p className="text-slate-500 text-sm mt-1">Share the invite link to add members to your trip</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {members.map((member) => (
                                    <div
                                        key={member.userId}
                                        className="flex items-center justify-between p-5 bg-gradient-to-r from-slate-50 to-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all"
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
                                                {member.status === 'complete' || (member.pointsBalances && member.pointsBalances.length > 0) ? (
                                                    <div className="flex flex-col gap-1">
                                                        {/* Points Programs - Detailed Display */}
                                                        {member.pointsBalances && member.pointsBalances.length > 0 ? (
                                                            <div className="flex flex-wrap gap-2 text-sm">
                                                                {member.pointsBalances.map((pb, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium"
                                                                        title={`${formatProgramName(pb.program)}: ${pb.balance.toLocaleString()} points`}
                                                                    >
                                                                        <Zap className="w-3 h-3" />
                                                                        {formatProgramName(pb.program)}:{' '}
                                                                        {isCurrentUserOwner 
                                                                            ? `${(pb.balance / 1000).toFixed(0)}k`
                                                                            : formatPointsRange(pb.balance)
                                                                        }
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : member.points && member.points > 0 ? (
                                                            <div className="flex items-center gap-1 text-sm text-slate-600">
                                                                <Zap className="w-3 h-3" />
                                                                {isCurrentUserOwner
                                                                    ? `${(member.points / 1000).toFixed(0)}k points`
                                                                    : formatPointsRange(member.points)
                                                                }
                                                            </div>
                                                        ) : null}
                                                        {/* Other info row */}
                                                        <div className="flex items-center gap-4 text-sm text-slate-600">
                                                            {typeof member.budget === 'number' && (
                                                                <span className="flex items-center gap-1">
                                                                    <DollarSign className="w-3 h-3" />
                                                                    ${member.budget.toLocaleString()}
                                                                </span>
                                                            )}
                                                            {member.airport && (
                                                                <span className="flex items-center gap-1">
                                                                    <MapPin className="w-3 h-3" />
                                                                    {member.airport}
                                                                </span>
                                                            )}
                                                            {member.partySize && member.partySize > 1 && (
                                                                <span className="flex items-center gap-1" title={`${member.adults || 1} adult${(member.adults || 1) > 1 ? 's' : ''}${member.children ? `, ${member.children} child${member.children > 1 ? 'ren' : ''}` : ''}`}>
                                                                    <Users className="w-3 h-3" />
                                                                    {member.partySize} travelers
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : member.status === 'denied' ? (
                                                    <div className="flex items-center gap-1 text-sm text-red-600">
                                                        <Ban className="w-3 h-3" />
                                                        <span>Denied</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 text-sm text-orange-600">
                                                        <Clock className="w-3 h-3" />
                                                        <span>Pending approval</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {member.status === 'complete' ? (
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                        ) : member.status === 'denied' ? (
                                            <Ban className="w-5 h-5 text-red-500" />
                                        ) : isCurrentUserOwner && member.role !== 'owner' ? (
                                            // Show approve/deny buttons for pending non-owner members
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleApproveMember(member.userId, member.name || 'User')}
                                                    disabled={approvingMemberId === member.userId || denyingMemberId === member.userId}
                                                    className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                                                    title="Approve member"
                                                >
                                                    {approvingMemberId === member.userId ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <UserCheck className="w-4 h-4" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleDenyMember(member.userId, member.name || 'User')}
                                                    disabled={approvingMemberId === member.userId || denyingMemberId === member.userId}
                                                    className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                                                    title="Deny member"
                                                >
                                                    {denyingMemberId === member.userId ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <UserX className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </div>
                                        ) : (
                                            <Clock className="w-5 h-5 text-orange-500" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Your Route Section - Full Width, Under Members */}
                <div>
                    <div className="bg-white border border-slate-200/80 rounded-2xl p-6 md:p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                                    <Plane className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-2xl text-slate-900 font-bold">Your Route</h2>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        {currentUserMember?.name ? `Personalized for ${currentUserMember.name}` : 'Your trip itinerary'}
                                    </p>
                                </div>
                            </div>
                            {!isCurrentUserOwner && (
                                <span className="text-xs text-slate-500 bg-slate-100 px-4 py-1.5 rounded-full font-medium">View only</span>
                            )}
                        </div>
                        
                        <div className="relative mb-8">
                            {/* Timeline connector line */}
                            <div className="absolute left-[17px] top-8 bottom-8 w-0.5 bg-gradient-to-b from-slate-300 via-blue-300 to-green-300 z-0" />
                            
                            <div className="space-y-2 relative z-10">
                                {/* START LOCATION - Personalized */}
                                <div className="flex gap-5 py-4">
                                    <div className="flex flex-col items-center flex-shrink-0">
                                        <div className="w-9 h-9 rounded-full bg-slate-700 border-4 border-white shadow-md z-10 flex items-center justify-center">
                                            <Home className="w-4 h-4 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex-1 p-5 bg-gradient-to-r from-slate-100 to-white border border-slate-200 rounded-2xl shadow-sm">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                            <div>
                                                <div className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1.5">Depart From</div>
                                                <div className="text-lg font-semibold text-slate-900">
                                                    {currentUserMember?.airport || startDestination?.name || 'Not set'}
                                                </div>
                                            </div>
                                            {trip?.startDate && (
                                                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-sm text-slate-600 font-medium">
                                                    <Calendar className="w-4 h-4" />
                                                    {new Date(trip.startDate + 'T12:00:00').toLocaleDateString('en-US', { 
                                                        weekday: 'short', 
                                                        month: 'short', 
                                                        day: 'numeric'
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* DESTINATIONS */}
                                {destinations.length === 0 ? (
                                    <div className="flex gap-5 py-4">
                                        <div className="flex flex-col items-center flex-shrink-0">
                                            <div className="w-9 h-9 rounded-full bg-white border-2 border-dashed border-slate-300 z-10" />
                                        </div>
                                        <div className="flex-1 p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                                            <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                            <p className="text-slate-500">
                                                {isCurrentUserOwner 
                                                    ? 'Add destinations below to build your route'
                                                    : 'Waiting for organizer to add destinations'
                                                }
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    destinations.map((dest, index) => {
                                        const isLastDestination = index === destinations.length - 1;
                                        return (
                                            <div key={dest.destinationId} className="flex gap-5 py-4">
                                                {/* Timeline dot */}
                                                <div className="flex flex-col items-center flex-shrink-0">
                                                    <div className="w-9 h-9 rounded-full bg-blue-600 border-4 border-white shadow-md z-10 flex items-center justify-center">
                                                        <span className="text-sm text-white font-bold">{index + 1}</span>
                                                    </div>
                                                </div>
                                                
                                                {/* Content */}
                                                <div className="flex-1 p-5 bg-gradient-to-r from-blue-50 to-white border border-blue-100 rounded-2xl shadow-sm">
                                                    <div className="flex flex-col gap-4">
                                                        {/* Destination header */}
                                                        <div className="flex items-start justify-between">
                                                            <div className="min-w-0">
                                                                <div className="text-xs text-blue-600 uppercase font-bold tracking-wider mb-1.5">
                                                                    {isLastDestination ? 'Final Stop' : `Stop ${index + 1}`}
                                                                </div>
                                                                <div className="text-lg font-semibold text-slate-900">{dest.name}</div>
                                                            </div>
                                                            
                                                            {/* Remove button - only for organizer */}
                                                            {isCurrentUserOwner && (
                                                                <button
                                                                    onClick={() => handleRemoveDestination(dest.destinationId, dest.name)}
                                                                    disabled={removingDestinationId === dest.destinationId}
                                                                    className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Remove destination"
                                                                >
                                                                    {removingDestinationId === dest.destinationId ? (
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                    ) : (
                                                                        <Trash2 className="w-4 h-4" />
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Date display for non-organizers - only show departure date for non-last destinations */}
                                                        {!isCurrentUserOwner && dest.departureDate && !isLastDestination && (
                                                            <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Plane className="w-3.5 h-3.5 text-blue-500" />
                                                                    <span>Depart: {new Date(dest.departureDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        
                                                        {/* Date picker for organizer - only show departure date for non-last destinations */}
                                                        {isCurrentUserOwner && !isLastDestination && (
                                                            <div className="flex flex-wrap gap-4 pt-2 border-t border-blue-100">
                                                                <div className="flex items-center gap-2">
                                                                    <Plane className="w-4 h-4 text-blue-500" />
                                                                    <span className="text-xs text-slate-500 whitespace-nowrap font-medium">Depart:</span>
                                                                    <SingleDatePicker
                                                                        value={dest.departureDate || ''}
                                                                        onChange={(date) => handleUpdateDepartureDate(
                                                                            dest.destinationId, 
                                                                            date || undefined
                                                                        )}
                                                                        disabled={updatingDestinationId === dest.destinationId}
                                                                        minDate={getMinDepartureDate(dest, index)}
                                                                        maxDate={getMaxDepartureDate(index)}
                                                                        compact
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                
                                {/* END LOCATION - Return Home (for round trip) or Arrive At (for one-way) */}
                                <div className="flex gap-5 py-4">
                                    <div className="flex flex-col items-center flex-shrink-0">
                                        <div className="w-9 h-9 rounded-full bg-green-600 border-4 border-white shadow-md z-10 flex items-center justify-center">
                                            <CheckCircle className="w-4 h-4 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex-1 p-5 bg-gradient-to-r from-green-50 to-white border border-green-200 rounded-2xl shadow-sm">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                            <div>
                                                <div className="text-xs text-green-600 uppercase font-bold tracking-wider mb-1.5">
                                                    {currentUserMember?.isRoundTrip !== false ? 'Return Home' : 'Arrive At'}
                                                </div>
                                                <div className="text-lg font-semibold text-slate-900">
                                                    {/* For round trips, return to departure airport; for one-way, use arrival airport or end destination */}
                                                    {currentUserMember?.isRoundTrip !== false 
                                                        ? (currentUserMember?.airport || startDestination?.name || 'Home')
                                                        : (currentUserMember?.arrivalAirport || endDestination?.name || 'Not set')
                                                    }
                                                </div>
                                            </div>
                                            {trip?.endDate && (
                                                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-lg text-sm text-green-700 font-medium">
                                                    <Calendar className="w-4 h-4" />
                                                    {new Date(trip.endDate + 'T12:00:00').toLocaleDateString('en-US', { 
                                                        weekday: 'short', 
                                                        month: 'short', 
                                                        day: 'numeric'
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Add destination - Only organizer can add */}
                        {isCurrentUserOwner && (
                            <div className="flex gap-4 pt-6 border-t border-slate-200">
                                <DestinationAutocomplete
                                    value={newDestination}
                                    onChange={setNewDestination}
                                    onSelect={(city) => {
                                        setNewDestination(city);
                                    }}
                                    placeholder="Search for a city to add..."
                                    className="flex-1"
                                />
                                <button
                                    onClick={handleAddDestination}
                                    disabled={!newDestination.trim() || isAddingDestination}
                                    className="px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-semibold shadow-sm shadow-blue-600/20"
                                >
                                    {isAddingDestination ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Plus className="w-4 h-4" />
                                    )}
                                    Add Destination
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom Section - Points, Settlement, Generate CTA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Points Summary - Enhanced with per-member contributions */}
                    {pointsSummary && pointsSummary.items.length > 0 && (
                        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                                    <Zap className="w-5 h-5 text-amber-600" />
                                </div>
                                <h3 className="text-lg text-slate-900 font-bold">Group Points Pool</h3>
                            </div>
                            
                            {/* Aggregated by program */}
                            <div className="space-y-3">
                                {(() => {
                                    // Aggregate points by program with contributors
                                    const programTotals: Record<string, { total: number; contributors: Array<{ name: string; balance: number; userId: string }> }> = {};
                                    
                                    for (const item of pointsSummary.items) {
                                        const program = item.program || 'Unknown';
                                        const balance = item.balance || 0;
                                        const userId = item.userId || '';
                                        
                                        if (!programTotals[program]) {
                                            programTotals[program] = { total: 0, contributors: [] };
                                        }
                                        programTotals[program].total += balance;
                                        
                                        // Find member name
                                        const member = members.find(m => m.userId === userId);
                                        programTotals[program].contributors.push({
                                            name: member?.name || `User ${userId.slice(0, 6)}`,
                                            balance,
                                            userId,
                                        });
                                    }
                                    
                                    return Object.entries(programTotals).map(([program, data]) => (
                                        <div key={program} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                                            <div className="flex items-center justify-between text-sm mb-1">
                                                <span className="font-medium text-slate-900">{formatProgramName(program)}</span>
                                                <span className="font-semibold text-blue-600">
                                                    {isCurrentUserOwner 
                                                        ? data.total.toLocaleString()
                                                        : formatPointsRange(data.total)
                                                    }
                                                </span>
                                            </div>
                                            {/* Show contributors (only for organizer with detailed view) */}
                                            {isCurrentUserOwner && data.contributors.length > 1 && (
                                                <div className="text-xs text-slate-500 ml-2">
                                                    {data.contributors.map((c, idx) => (
                                                        <span key={c.userId}>
                                                            {c.name}: {(c.balance / 1000).toFixed(0)}k
                                                            {idx < data.contributors.length - 1 ? ', ' : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ));
                                })()}
                            </div>
                            
                            <div className="pt-3 mt-3 border-t border-slate-200 flex items-center justify-between">
                                <span className="font-semibold text-slate-900">Total Group Points</span>
                                <span className="font-bold text-blue-600 text-lg">
                                    {isCurrentUserOwner
                                        ? pointsSummary.totalPoints.toLocaleString()
                                        : formatPointsRange(pointsSummary.totalPoints)
                                    }
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Settlement Card - Group trips only */}
                    {members.length > 1 && (
                        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                                    <Receipt className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg text-slate-900 font-bold">Settlement</h3>
                                    <p className="text-xs text-slate-500">Split costs fairly</p>
                                </div>
                            </div>
                            <p className="text-sm text-slate-600 mb-5">
                                Configure how trip costs are split among {members.length} members and see who owes what.
                            </p>
                            <button
                                onClick={() => router.push(`/group/settlement?tripId=${tripId}`)}
                                className="w-full px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium flex items-center justify-center gap-2 shadow-sm shadow-emerald-600/20"
                            >
                                <DollarSign className="w-4 h-4" />
                                View Settlement
                            </button>
                        </div>
                    )}

                    {/* Transfer Strategy Card - Only visible to non-organizers */}
                    {!isCurrentUserOwner && (
                        <div className={`rounded-2xl p-6 shadow-sm transition-shadow ${
                            isStrategyPaid 
                                ? 'bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-lg shadow-purple-600/20' 
                                : 'bg-white border border-slate-200/80 hover:shadow-md'
                        }`}>
                            <div className="flex items-center gap-3 mb-5">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                    isStrategyPaid ? 'bg-white/20' : 'bg-purple-100'
                                }`}>
                                    {isStrategyPaid ? (
                                        <ArrowRightLeft className="w-5 h-5 text-white" />
                                    ) : (
                                        <Lock className="w-5 h-5 text-purple-600" />
                                    )}
                                </div>
                                <div>
                                    <h3 className={`text-lg font-bold ${isStrategyPaid ? 'text-white' : 'text-slate-900'}`}>
                                        Transfer Strategy
                                    </h3>
                                    <p className={`text-xs ${isStrategyPaid ? 'text-purple-200' : 'text-slate-500'}`}>
                                        {isStrategyPaid ? 'Ready to view' : 'Pending organizer payment'}
                                    </p>
                                </div>
                            </div>
                            <p className={`text-sm mb-5 ${isStrategyPaid ? 'text-purple-100' : 'text-slate-600'}`}>
                                {isStrategyPaid 
                                    ? 'View step-by-step instructions for transferring your points and booking flights.'
                                    : 'The transfer strategy will be available once the organizer completes payment.'
                                }
                            </p>
                            <button
                                onClick={() => router.push(`/group/points-strategy?tripId=${tripId}`)}
                                disabled={!isStrategyPaid}
                                className={`w-full px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
                                    isStrategyPaid
                                        ? 'bg-yellow-400 text-slate-900 hover:bg-yellow-300 shadow-lg shadow-yellow-400/20'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                }`}
                            >
                                {isStrategyPaid ? (
                                    <>
                                        <ArrowRightLeft className="w-4 h-4" />
                                        View Transfer Strategy
                                    </>
                                ) : (
                                    <>
                                        <Lock className="w-4 h-4" />
                                        Awaiting Payment
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Generate CTA - Only visible to organizer */}
                    {isCurrentUserOwner && (
                        isReady ? (
                            <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white rounded-2xl p-6 shadow-xl shadow-blue-600/30">
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                                        <Sparkles className="w-5 h-5 text-yellow-300" />
                                    </div>
                                    <h3 className="text-xl font-bold">Ready to Generate</h3>
                                </div>
                                <p className="text-blue-100 mb-6">
                                    All members have completed their profiles. Generate optimized itineraries for your group!
                                </p>
                                <button
                                    onClick={handleGenerateItineraries}
                                    disabled={isGenerating}
                                    className="w-full px-6 py-3.5 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-300 transition-colors shadow-lg shadow-yellow-400/30 font-bold text-lg disabled:opacity-50"
                                >
                                    {isGenerating ? 'Generating...' : 'Generate Itineraries'}
                                </button>
                            </div>
                        ) : (
                            <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-6 border border-orange-200 shadow-sm">
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                                        <Clock className="w-5 h-5 text-orange-600" />
                                    </div>
                                    <h3 className="text-lg text-slate-900 font-bold">Waiting for Members</h3>
                                </div>
                                <p className="text-slate-600 mb-5">
                                    {activeMembers.length === 0 
                                        ? 'Share the invite link to add members to your trip.'
                                        : pendingMembers.length > 0
                                            ? `${pendingMembers.length} member(s) waiting for approval`
                                            : `${activeMembers.length - completedMembers.length} member(s) still need to complete their profile`
                                    }
                                </p>
                                <button
                                    onClick={() => router.push(`/group/waiting?tripId=${tripId}`)}
                                    className="w-full px-4 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-colors font-medium flex items-center justify-center gap-2 shadow-sm shadow-orange-600/20"
                                >
                                    <Clock className="w-4 h-4" />
                                    View Waiting Status
                                </button>
                                <p className="text-xs text-slate-500 text-center mt-4">
                                    You can leave this page and return anytime
                                </p>
                            </div>
                        )
                    )}
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
