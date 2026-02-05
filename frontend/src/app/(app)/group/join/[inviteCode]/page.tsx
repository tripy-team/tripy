'use client';

import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Zap, Users, Calendar, Plane, Backpack, Armchair, Coffee, Wine, Crown, User, Baby, Info, Copy, ChevronDown, Luggage, X, Plus } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI, users as usersAPI } from '@/lib/api';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface TripInfo {
    name: string;
    admin: string;
    cities: string[];
    duration: number;
    startDate: string;  // Formatted display string
    rawStartDate: string;  // Raw date string (YYYY-MM-DD)
    rawEndDate: string;    // Raw date string (YYYY-MM-DD)
    currentMembers: number;
}

interface AdditionalTraveler {
    id: string;
    name: string;
    email: string;
}

interface CreditCardEntry {
    id: string;
    program: string;
    points: number;
}

export default function GroupMemberJoin({ params }: { params: Promise<{ inviteCode: string }> }) {
    const { inviteCode } = use(params);
    const router = useRouter();
    const [budget, setBudget] = useState<number | ''>('');
    // Points usage defaults to 'freely' - optimizer can allocate points without asking
    const pointsUsage = 'freely' as const;

    // Credit Card / Points State
    const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([]);
    const [newCardProgram, setNewCardProgram] = useState('');
    const [newCardPoints, setNewCardPoints] = useState<number | ''>('');
    const [showAddCard, setShowAddCard] = useState(false);

    // Party Size State
    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [additionalTravelers, setAdditionalTravelers] = useState<AdditionalTraveler[]>([]);

    // Update additional travelers when adults count changes
    useEffect(() => {
        const additionalCount = adults - 1;
        setAdditionalTravelers(prev => {
            if (additionalCount > prev.length) {
                const newTravelers = Array(additionalCount - prev.length).fill(null).map(() => ({
                    id: Math.random().toString(36).substring(2, 9),
                    name: '',
                    email: ''
                }));
                return [...prev, ...newTravelers];
            } else if (additionalCount < prev.length) {
                return prev.slice(0, additionalCount);
            }
            return prev;
        });
    }, [adults]);

    const updateTraveler = (id: string, field: keyof AdditionalTraveler, value: string) => {
        setAdditionalTravelers(prev => prev.map(t =>
            t.id === id ? { ...t, [field]: value } : t
        ));
    };

    // Travel Details
    const [startAirport, setStartAirport] = useState('');
    const [endAirport, setEndAirport] = useState('');
    const [isRoundTrip, setIsRoundTrip] = useState(true);
    const [flightClass, setFlightClass] = useState('economy');
    const [bags, setBags] = useState(1);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [tripInfo, setTripInfo] = useState<TripInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isJoining, setIsJoining] = useState(false);
    const [existingMembers, setExistingMembers] = useState<Array<{
        id: string;
        name: string;
        role: string;
        flights?: { start: string; end: string; roundTrip: boolean; flightClass: string };
        dates?: { start: string; end: string };
    }>>([]);

    // Match State Tracking
    const [flightMatchId, setFlightMatchId] = useState('');

    // Calculate total points from all cards
    const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);

    const addCreditCard = () => {
        if (newCardProgram && newCardPoints) {
            setCreditCards([...creditCards, {
                id: Math.random().toString(36).substring(2, 9),
                program: newCardProgram,
                points: typeof newCardPoints === 'number' ? newCardPoints : 0
            }]);
            setNewCardProgram('');
            setNewCardPoints('');
            setShowAddCard(false);
        }
    };

    const removeCreditCard = (id: string) => {
        setCreditCards(creditCards.filter(card => card.id !== id));
    };

    // Load user's credit cards from their profile on mount
    useEffect(() => {
        const loadUserProfile = async () => {
            try {
                const profile = await usersAPI.getProfile();
                if (profile.credit_cards && profile.credit_cards.length > 0) {
                    setCreditCards(profile.credit_cards.map(card => ({
                        id: card.id,
                        program: card.program,
                        points: card.points,
                    })));
                }
            } catch (err) {
                console.error('Error loading user profile:', err);
                // Continue without pre-filled points if profile load fails
            }
        };
        loadUserProfile();
    }, []);

    useEffect(() => {
        const fetchTripInfo = async () => {
            try {
                setIsLoading(true);
                const trip = await tripsAPI.getByInvite(inviteCode);

                // Add T12:00:00 to avoid timezone shifts when parsing date-only strings
                const startDate = trip.startDate ? new Date(trip.startDate + 'T12:00:00') : null;
                const endDate = trip.endDate ? new Date(trip.endDate + 'T12:00:00') : null;
                const duration = startDate && endDate
                    ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                const startDateStr = startDate
                    ? startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'TBD';

                const cities = (trip.destinations || []) as string[];
                
                // Helper to extract name from member object
                const extractMemberName = (m: { 
                    name?: string; 
                    fullName?: string;
                    firstName?: string;
                    lastName?: string;
                    first_name?: string;
                    last_name?: string;
                }): string | null => {
                    let memberName = m.name || m.fullName;
                    if (!memberName && (m.firstName || m.first_name)) {
                        const first = m.firstName || m.first_name || '';
                        const last = m.lastName || m.last_name || '';
                        memberName = `${first} ${last}`.trim();
                    }
                    return memberName || null;
                };

                let adminName = 'Trip Organizer';

                // Use members data from the trip response (included by getByInvite endpoint)
                // If not included, make a separate call to listMembers as fallback
                let tripMembers = (trip as { members?: Array<{ userId?: string; name?: string; role?: string }> }).members || [];
                
                // Fallback: If no members came from getByInvite, try fetching them separately
                if (tripMembers.length === 0 && trip.tripId) {
                    try {
                        const membersResponse = await tripsAPI.listMembers(trip.tripId);
                        if (membersResponse.members && membersResponse.members.length > 0) {
                            tripMembers = membersResponse.members;
                        }
                    } catch (err) {
                        console.error('Error fetching members as fallback:', err);
                        // Continue without member data
                    }
                }
                
                if (tripMembers.length > 0) {
                    // Find the owner/organizer and get their name
                    const owner = tripMembers.find((m) => 
                        m.role === 'owner' || m.role === 'admin' || m.role === 'organizer'
                    );
                    if (owner) {
                        const ownerName = extractMemberName(owner as Parameters<typeof extractMemberName>[0]);
                        if (ownerName) {
                            adminName = ownerName;
                        }
                    }

                    // Get trip's start/end airport as fallback for organizer
                    // Keep the exact value the organizer put in (e.g., "SEA" or "Seattle (SEA,BFI)")
                    const tripData = trip as { 
                        startAirport?: string; 
                        endAirport?: string;
                        startDate?: string;
                        endDate?: string;
                    };
                    
                    const tripStartAirport = tripData.startAirport || '';
                    const tripEndAirport = tripData.endAirport || '';
                    
                    // Transform members for the dropdown (for "Same as friend?" feature)
                    // Backend returns: departure_airport, arrival_airport, is_round_trip, flight_class
                    const membersList = tripMembers.map((m, idx) => {
                        const memberName = extractMemberName(m as Parameters<typeof extractMemberName>[0]);
                        
                        // Get member's flight preferences from backend response
                        const memberData = m as { 
                            userId?: string; 
                            name?: string; 
                            role?: string;
                            departure_airport?: string;
                            arrival_airport?: string;
                            is_round_trip?: boolean;
                            flight_class?: string;
                        };
                        
                        // Use member's stored preferences, or fall back to trip's airports for organizer
                        const isOrganizer = m.role === 'owner' || m.role === 'admin' || m.role === 'organizer';
                        const departureAirport = memberData.departure_airport || (isOrganizer ? tripStartAirport : '');
                        const arrivalAirport = memberData.arrival_airport || (isOrganizer ? tripEndAirport : '');
                        
                        return {
                            id: m.userId || `m${idx}`,
                            name: memberName || `Traveler ${idx + 1}`,
                            role: m.role || 'member',
                            // Use member's stored flight preferences (both start and end should match the selected member)
                            flights: { 
                                start: departureAirport, 
                                end: arrivalAirport, 
                                roundTrip: memberData.is_round_trip ?? true, 
                                flightClass: memberData.flight_class || 'economy' 
                            },
                            dates: { start: trip.startDate || '', end: trip.endDate || '' },
                        };
                    });
                    
                    setExistingMembers(membersList);
                }

                setTripInfo({
                    name: trip.title || 'Group Trip',
                    admin: adminName,
                    cities: cities,
                    duration: duration,
                    startDate: startDateStr,
                    rawStartDate: trip.startDate || '',
                    rawEndDate: trip.endDate || '',
                    currentMembers: trip.memberCount || 1,
                });
            } catch (err) {
                console.error('Error fetching trip info:', err);
                setTripInfo(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTripInfo();
    }, [inviteCode]);

    // Format name as "FirstName L." (first name + last initial)
    const formatMemberName = (fullName: string): string => {
        const parts = fullName.trim().split(/\s+/);
        if (parts.length === 0) return fullName;
        if (parts.length === 1) return parts[0];
        const firstName = parts[0];
        const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
        return `${firstName} ${lastInitial}.`;
    };

    const handleCopyFlights = (memberId: string) => {
        const member = existingMembers.find(m => m.id === memberId);
        if (member && member.flights) {
            setStartAirport(member.flights.start);
            setIsRoundTrip(member.flights.roundTrip);
            setFlightClass(member.flights.flightClass);
            setFlightMatchId(memberId);
            // For round trip, end airport should match start airport
            if (member.flights.roundTrip) {
                setEndAirport(member.flights.start);
            } else {
                setEndAirport(member.flights.end);
            }
        }
    };

    // Auto-set dates when trip info loads (default to same day as group)
    useEffect(() => {
        if (tripInfo?.rawStartDate && tripInfo?.rawEndDate && !startDate) {
            setStartDate(tripInfo.rawStartDate);
            setEndDate(tripInfo.rawEndDate);
        }
    }, [tripInfo, startDate]);

    const handleJoin = async () => {
        try {
            setIsJoining(true);

            // 1. Join the trip (with pooling preferences, flight preferences, budget, and party size)
            const joinResult = await tripsAPI.join(inviteCode, {
                points_usage: pointsUsage,
                willing_to_share_points: pointsUsage !== 'do_not_use',
                // Flight preferences for "Same as Friend?" feature
                departure_airport: startAirport,
                arrival_airport: endAirport,
                is_round_trip: isRoundTrip,
                flight_class: flightClass,
                // Budget
                max_cash_budget: typeof budget === 'number' ? budget : undefined,
                // Party size (travelers in this member's booking)
                adults: adults,
                children: children,
            });
            const tripId = joinResult.tripId;

            // 2. Additional member preferences not yet stored:
            // - bags
            // - startDate, endDate
            // - meetupNote
            // - additionalTravelers (names/emails for non-account travelers)

            // 3. Upsert points if user has any credit cards
            if (creditCards.length > 0) {
                for (const card of creditCards) {
                    await pointsAPI.upsert({
                        trip_id: tripId,
                        program: card.program,
                        balance: card.points,
                    });
                }
            }

            // Navigate to dashboard with tripId
            router.push(`/group/dashboard?tripId=${tripId}`);
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
                <div className="max-w-5xl mx-auto">
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
                <div className="max-w-5xl mx-auto">
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
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Joining Group Trip</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">Join {tripInfo.name}</h1>
                    <p className="text-slate-600">Customize your travel plans to overlap with the group</p>
                </div>

                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Left - Trip Info */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm sticky top-8">
                            <h3 className="text-lg mb-6 text-slate-900 font-semibold">Trip Overview</h3>

                            <div className="space-y-4 text-sm">
                                <div>
                                    <div className="text-slate-600 mb-1">Organized by</div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-semibold">
                                            {tripInfo.admin
                                                .split(' ')
                                                .map(part => part.charAt(0).toUpperCase())
                                                .slice(0, 2)
                                                .join('')
                                                || 'TO'}
                                        </div>
                                        <span className="text-slate-900">{tripInfo.admin}</span>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-slate-600 mb-1">Group Duration</div>
                                    <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-blue-600" />
                                        <span className="text-slate-900">{tripInfo.duration} days</span>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-slate-600 mb-1">Group Start Date</div>
                                    <div className="text-slate-900 font-medium">{tripInfo.startDate}</div>
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
                    </div>

                    {/* Right - Input Form */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* A) Travel preferences */}
                        <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 uppercase tracking-wider">
                            <span className="bg-blue-100 px-2 py-0.5 rounded">A</span>
                            <span>Travel preferences</span>
                        </div>
                        {/* Party Size */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Users className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-2xl text-slate-900 font-semibold">Your Travel Party</h2>
                                    <p className="text-sm text-slate-500">Who is joining this trip with you?</p>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-8">
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-slate-200 text-slate-600">
                                            <User className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-slate-900">Adults</div>
                                            <div className="text-xs text-slate-500">Age 13+</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setAdults(Math.max(1, adults - 1))}
                                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                        >
                                            -
                                        </button>
                                        <span className="w-4 text-center font-semibold text-slate-900">{adults}</span>
                                        <button
                                            onClick={() => setAdults(adults + 1)}
                                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-slate-200 text-slate-600">
                                            <Baby className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-slate-900">Children</div>
                                            <div className="text-xs text-slate-500">Ages 0-12</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setChildren(Math.max(0, children - 1))}
                                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                        >
                                            -
                                        </button>
                                        <span className="w-4 text-center font-semibold text-slate-900">{children}</span>
                                        <button
                                            onClick={() => setChildren(children + 1)}
                                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {adults > 1 && (
                                <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="text-sm text-amber-900">
                                            <span className="font-semibold block mb-1">Are they contributing points?</span>
                                            Additional adults added here are considered part of your booking. This means that <strong>they do not have points to contribute</strong>. If they do, they should join using an invite link.
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-medium text-slate-900 pl-1">Additional Traveler Details</h3>
                                        {additionalTravelers.map((traveler, index) => (
                                            <div key={traveler.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Adult {index + 2}</div>
                                                </div>
                                                <div className="grid md:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Full Name</label>
                                                        <input
                                                            type="text"
                                                            value={traveler.name}
                                                            onChange={(e) => updateTraveler(traveler.id, 'name', e.target.value)}
                                                            placeholder="e.g. John Doe"
                                                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Email Address</label>
                                                        <input
                                                            type="email"
                                                            value={traveler.email}
                                                            onChange={(e) => updateTraveler(traveler.id, 'email', e.target.value)}
                                                            placeholder="e.g. john@example.com"
                                                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Flight Details */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Plane className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-2xl text-slate-900 font-semibold">Flight Preferences</h2>
                                    <p className="text-sm text-slate-500 mt-1">Where will you be flying from?</p>
                                </div>
                            </div>

                            {existingMembers.length > 0 && (
                                <div className="mb-8 flex flex-col sm:flex-row items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                                    <div className="hidden sm:flex flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg items-center justify-center">
                                        <Copy className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0 text-center sm:text-left">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-0.5">Same as friend?</div>
                                        <div className="text-xs text-slate-500 truncate">Copy flight details from another traveler</div>
                                    </div>
                                    <div className="relative w-full sm:w-[220px]">
                                        <select
                                            className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-blue-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent cursor-pointer hover:border-blue-300 transition-colors"
                                            onChange={(e) => handleCopyFlights(e.target.value)}
                                            value={flightMatchId}
                                        >
                                            <option value="">Select member...</option>
                                            {existingMembers.map(m => (
                                                <option key={m.id} value={m.id}>{formatMemberName(m.name)}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-6">
                                <div className="flex items-center justify-between mb-4">
                                    <label className="flex items-center gap-2 cursor-pointer select-none group">
                                        <input
                                            type="checkbox"
                                            checked={isRoundTrip}
                                            onChange={(e) => {
                                                setIsRoundTrip(e.target.checked);
                                                setFlightMatchId('');
                                                // For round trip, sync end airport with start airport
                                                if (e.target.checked && startAirport) {
                                                    setEndAirport(startAirport);
                                                }
                                            }}
                                            className="w-4 h-4 text-blue-600 bg-white rounded border-blue-400 focus:ring-blue-600 focus:ring-offset-0"
                                        />
                                        <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Round Trip</span>
                                    </label>
                                </div>

                                <div className={`grid ${isRoundTrip ? 'md:grid-cols-1' : 'md:grid-cols-2'} gap-6`}>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">
                                            {isRoundTrip ? 'Home Airport' : 'Flying From'}
                                        </label>
                                        <p className="text-xs text-slate-400 mb-2">
                                            {isRoundTrip 
                                                ? "Where you'll depart from and return to" 
                                                : "Your departure airport"}
                                        </p>
                                        <AirportAutocomplete
                                            value={startAirport}
                                            onValueChange={(val) => {
                                                setStartAirport(val);
                                                setFlightMatchId('');
                                                // For round trip, keep end airport in sync
                                                if (isRoundTrip) {
                                                    setEndAirport(val);
                                                }
                                            }}
                                            placeholder="e.g., JFK, LAX, or search by airport name"
                                        />
                                    </div>
                                    {!isRoundTrip && (
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Flying To</label>
                                            <p className="text-xs text-slate-400 mb-2">Your final destination airport</p>
                                            <AirportAutocomplete
                                                value={endAirport}
                                                onValueChange={(val) => {
                                                    setEndAirport(val);
                                                    setFlightMatchId('');
                                                }}
                                                placeholder="e.g., CDG, LHR, or search by airport name"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Flight Class Selection */}
                                <div>
                                    <label className="block text-sm text-slate-600 mb-4 font-medium uppercase tracking-wider">Cabin Class Preference</label>
                                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                                        {[
                                            { value: 'basic_economy', label: 'Basic Econ', desc: 'No Carry-on', icon: Backpack },
                                            { value: 'economy', label: 'Economy', desc: 'Best Value', icon: Armchair },
                                            { value: 'premium', label: 'Premium', desc: 'Extra Legroom', icon: Coffee },
                                            { value: 'business', label: 'Business', desc: 'Lie-flat Seats', icon: Wine },
                                            { value: 'first', label: 'First', desc: 'Luxury Suite', icon: Crown },
                                        ].map((option) => {
                                            const Icon = option.icon;
                                            const isSelected = flightClass === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    onClick={() => {
                                                        setFlightClass(option.value);
                                                        setFlightMatchId('');
                                                    }}
                                                    className={`relative p-3 rounded-2xl border-2 transition-all text-left flex flex-col gap-2 group h-full ${
                                                        isSelected
                                                            ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                                                            : 'border-slate-100 hover:border-blue-200 bg-white hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                                        isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600'
                                                    }`}>
                                                        <Icon className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        <div className={`font-semibold text-sm ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                                                            {option.label}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500">{option.desc}</div>
                                                    </div>
                                                    {isSelected && (
                                                        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Number of Bags */}
                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium uppercase tracking-wider">Number of Bags</label>
                                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 max-w-md">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-200 text-slate-600">
                                                <Luggage className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-slate-900">Checked bags</div>
                                                <div className="text-xs text-slate-500">Total for your trip</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setBags(Math.max(0, bags - 1))}
                                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                            >
                                                -
                                            </button>
                                            <span className="w-4 text-center font-semibold text-slate-900">{bags}</span>
                                            <button
                                                type="button"
                                                onClick={() => setBags(Math.min(6, bags + 1))}
                                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Dates */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-2xl text-slate-900 font-semibold">Arrival Date</h2>
                                    <p className="text-sm text-slate-500 mt-1">When will you arrive for the trip?</p>
                                </div>
                            </div>

                            {tripInfo && tripInfo.rawStartDate && (
                                <div className="space-y-4">
                                    {/* Arrival date options */}
                                    <div className="space-y-3">
                                        {(() => {
                                            const groupStart = new Date(tripInfo.rawStartDate + 'T12:00:00');
                                            const options = [
                                                { days: 0, label: 'Same day as group', desc: `Arrive on ${groupStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` },
                                                { days: -1, label: '1 day early', desc: `Arrive on ${new Date(groupStart.getTime() - 86400000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` },
                                                { days: -2, label: '2 days early', desc: `Arrive on ${new Date(groupStart.getTime() - 2 * 86400000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} (timezone buffer)` },
                                            ];
                                            
                                            return options.map((option) => {
                                                const optionDate = new Date(groupStart.getTime() + option.days * 86400000);
                                                const dateStr = optionDate.toISOString().split('T')[0];
                                                const isSelected = startDate === dateStr;
                                                
                                                return (
                                                    <button
                                                        key={option.days}
                                                        type="button"
                                                        onClick={() => {
                                                            setStartDate(dateStr);
                                                            // Auto-set end date to group's end date
                                                            setEndDate(tripInfo.rawEndDate);
                                                        }}
                                                        className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center justify-between ${
                                                            isSelected
                                                                ? 'border-blue-600 bg-blue-50/50'
                                                                : 'border-slate-200 hover:border-blue-200 bg-white'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                                isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                                                            }`}>
                                                                {isSelected && (
                                                                    <div className="w-2 h-2 rounded-full bg-white" />
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div className={`font-medium ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                                                                    {option.label}
                                                                </div>
                                                                <div className="text-sm text-slate-500">{option.desc}</div>
                                                            </div>
                                                        </div>
                                                        {option.days === 0 && (
                                                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                                                                Recommended
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            });
                                        })()}
                                    </div>

                                    {/* Show the return date info */}
                                    <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Calendar className="w-4 h-4 text-slate-400" />
                                            <span className="text-slate-600">Return date:</span>
                                            <span className="font-medium text-slate-900">
                                                {tripInfo.rawEndDate ? new Date(tripInfo.rawEndDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}
                                            </span>
                                            <span className="text-slate-400">(same as group)</span>
                                        </div>
                                    </div>

                                    <p className="text-sm text-slate-500 flex items-start gap-2">
                                        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        Arriving 1-2 days early helps account for timezone differences and flight delays.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* B) Points & accounts */}
                        <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 uppercase tracking-wider">
                            <span className="bg-blue-100 px-2 py-0.5 rounded">B</span>
                            <span>Points & accounts</span>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <DollarSign className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-2xl text-slate-900 font-semibold">Budget & Points</h2>
                                    <p className="text-sm text-slate-500">Connect your points so the group can find the best plan</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <div className="space-y-4">
                                        <label className="block text-sm font-medium text-slate-700">Maximum Budget <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 font-bold text-lg">$</span>
                                            <input
                                                type="number"
                                                value={budget}
                                                onChange={(e) => {
                                                    const val = e.target.value ? Number(e.target.value) : '';
                                                    setBudget(val);
                                                }}
                                                onWheel={(e) => e.currentTarget.blur()}
                                                placeholder="Enter your budget"
                                                min="1"
                                                required
                                                className="w-full pl-10 pr-4 py-3 bg-blue-50 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold text-slate-900 text-lg"
                                            />
                                        </div>
                                        {budget === '' && (
                                            <p className="text-xs text-slate-500">Required to join the trip</p>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-200">
                                    <div className="flex items-center justify-between mb-4">
                                        <label className="block text-sm font-medium text-slate-700">Available Points</label>
                                        <button
                                            type="button"
                                            onClick={() => setShowAddCard(true)}
                                            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                                        >
                                            <Plus className="w-4 h-4" />
                                            Add Points
                                        </button>
                                    </div>

                                    {creditCards.length > 0 ? (
                                        <div className="space-y-3">
                                            {creditCards.map(card => (
                                                <div key={card.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                                            <Zap className="w-5 h-5 text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-slate-900">{card.program}</div>
                                                            <div className="text-sm text-slate-500">{card.points.toLocaleString()} points</div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeCreditCard(card.id)}
                                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}

                                            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                                                <span className="text-sm text-slate-600">Total Points</span>
                                                <span className="text-xl font-bold text-blue-600">{totalPoints.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                            <Zap className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                            <p className="text-sm text-slate-500">No points added yet</p>
                                            <p className="text-xs text-slate-400 mt-1">Add your credit card or loyalty points</p>
                                        </div>
                                    )}

                                    {/* Add Card Modal */}
                                    {showAddCard && (
                                        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAddCard(false)}>
                                            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-between mb-6">
                                                    <h3 className="text-lg font-semibold text-slate-900">Add Points</h3>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAddCard(false)}
                                                        className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                                                    >
                                                        <X className="w-5 h-5" />
                                                    </button>
                                                </div>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">Program Name</label>
                                                        <input
                                                            type="text"
                                                            value={newCardProgram}
                                                            onChange={(e) => setNewCardProgram(e.target.value)}
                                                            placeholder="e.g., Chase Sapphire, Delta SkyMiles"
                                                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">Points Balance</label>
                                                        <input
                                                            type="number"
                                                            value={newCardPoints}
                                                            onChange={(e) => setNewCardPoints(e.target.value ? Number(e.target.value) : '')}
                                                            onWheel={(e) => e.currentTarget.blur()}
                                                            placeholder="e.g., 50000"
                                                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                                        />
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={addCreditCard}
                                                    disabled={!newCardProgram || !newCardPoints}
                                                    className="w-full mt-6 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                                                >
                                                    Add Points
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleJoin}
                            disabled={!startAirport || !startDate || budget === '' || isJoining}
                            className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-400/20 font-semibold text-lg"
                        >
                            {isJoining ? 'Joining...' : 'Confirm & Join Trip'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
