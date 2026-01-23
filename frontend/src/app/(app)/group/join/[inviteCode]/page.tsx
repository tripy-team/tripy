'use client';

import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Zap, Users, Calendar, Plane, MessageSquare, Bed, Backpack, Armchair, Coffee, Wine, Crown, BedDouble, Star, User, Baby, Info, Copy, ChevronDown } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI } from '@/lib/api';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';

interface TripInfo {
    name: string;
    admin: string;
    cities: string[];
    duration: number;
    startDate: string;
    currentMembers: number;
}

interface AdditionalTraveler {
    id: string;
    name: string;
    email: string;
}

export default function GroupMemberJoin({ params }: { params: Promise<{ inviteCode: string }> }) {
    const { inviteCode } = use(params);
    const router = useRouter();
    const [budget, setBudget] = useState(5000);
    const [points, setPoints] = useState(100000);

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
    const [hotelClass, setHotelClass] = useState('4');
    const [roomOccupancy, setRoomOccupancy] = useState(1);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [meetupNote, setMeetupNote] = useState('');

    const [tripInfo, setTripInfo] = useState<TripInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isJoining, setIsJoining] = useState(false);
    const [existingMembers, setExistingMembers] = useState<Array<{
        id: string;
        name: string;
        role: string;
        flights?: { start: string; end: string; roundTrip: boolean; flightClass: string };
        accommodation?: { hotelClass: string; occupancy: number };
        dates?: { start: string; end: string };
    }>>([]);

    // Match State Tracking
    const [flightMatchId, setFlightMatchId] = useState('');
    const [accommodationMatchId, setAccommodationMatchId] = useState('');
    const [datesMatchId, setDatesMatchId] = useState('');

    useEffect(() => {
        const fetchTripInfo = async () => {
            try {
                setIsLoading(true);
                const trip = await tripsAPI.getByInvite(inviteCode);

                const startDate = trip.startDate ? new Date(trip.startDate) : null;
                const endDate = trip.endDate ? new Date(trip.endDate) : null;
                const duration = startDate && endDate
                    ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                const startDateStr = startDate
                    ? startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'TBD';

                const cities = (trip.destinations || []) as string[];
                const admin = 'Trip Organizer';

                setTripInfo({
                    name: trip.title || 'Group Trip',
                    admin: admin,
                    cities: cities,
                    duration: duration,
                    startDate: startDateStr,
                    currentMembers: trip.memberCount || 1,
                });

                // Fetch existing members if trip has tripId
                if (trip.tripId) {
                    try {
                        const membersResponse = await tripsAPI.listMembers(trip.tripId);
                        // Transform members for the dropdown
                        // Note: We'll need to fetch member preferences separately or from trip member data
                        // For now, using mock structure that matches Figma
                        setExistingMembers(membersResponse.members.map((m: { userId?: string; name?: string; role?: string }, idx: number) => ({
                            id: m.userId || `m${idx}`,
                            name: m.name || `Member ${idx + 1}`,
                            role: m.role || 'Member',
                            // TODO: Fetch actual preferences from member data
                            flights: { start: 'JFK', end: 'CDG', roundTrip: true, flightClass: 'economy' },
                            accommodation: { hotelClass: '4', occupancy: 1 },
                            dates: { start: trip.startDate || '', end: trip.endDate || '' },
                        })));
                    } catch (err) {
                        console.error('Error fetching members:', err);
                        // Continue without member data
                    }
                }
            } catch (err) {
                console.error('Error fetching trip info:', err);
                setTripInfo(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTripInfo();
    }, [inviteCode]);

    const handleCopyFlights = (memberId: string) => {
        const member = existingMembers.find(m => m.id === memberId);
        if (member && member.flights) {
            setStartAirport(member.flights.start);
            setEndAirport(member.flights.end);
            setIsRoundTrip(member.flights.roundTrip);
            setFlightClass(member.flights.flightClass);
            setFlightMatchId(memberId);
        }
    };

    const handleCopyAccommodation = (memberId: string) => {
        const member = existingMembers.find(m => m.id === memberId);
        if (member && member.accommodation) {
            setHotelClass(member.accommodation.hotelClass);
            setRoomOccupancy(member.accommodation.occupancy);
            setAccommodationMatchId(memberId);
        }
    };

    const handleCopyDates = (memberId: string) => {
        const member = existingMembers.find(m => m.id === memberId);
        if (member && member.dates) {
            setStartDate(member.dates.start);
            setEndDate(member.dates.end);
            setDatesMatchId(memberId);
        }
    };

    const handleJoin = async () => {
        try {
            setIsJoining(true);

            const joinResult = await tripsAPI.join(inviteCode);
            const tripId = joinResult.tripId;

            if (points > 0) {
                await pointsAPI.upsert({
                    trip_id: tripId,
                    program: 'User Points',
                    balance: points,
                });
            }

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
                                            SC
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
                                                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-6">
                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Departure Airport</label>
                                        <AirportAutocomplete
                                            value={startAirport}
                                            onValueChange={(val) => {
                                                setStartAirport(val);
                                                setFlightMatchId('');
                                            }}
                                            placeholder="e.g., JFK, LAX, or search by airport name"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Preferred Arrival Airport</label>
                                        <AirportAutocomplete
                                            value={endAirport}
                                            onValueChange={(val) => {
                                                setEndAirport(val);
                                                setFlightMatchId('');
                                            }}
                                            placeholder="e.g., CDG, LHR, or search by airport name"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mb-4">
                                    <label className="flex items-center gap-2 cursor-pointer select-none group">
                                        <input
                                            type="checkbox"
                                            checked={isRoundTrip}
                                            onChange={(e) => {
                                                setIsRoundTrip(e.target.checked);
                                                setFlightMatchId('');
                                            }}
                                            className="w-4 h-4 text-blue-600 bg-white rounded border-blue-400 focus:ring-blue-600 focus:ring-offset-0"
                                        />
                                        <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Round Trip</span>
                                    </label>
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
                            </div>
                        </div>

                        {/* Accommodation */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Bed className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Accommodation</h2>
                            </div>

                            {existingMembers.length > 0 && (
                                <div className="mb-8 flex flex-col sm:flex-row items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                                    <div className="hidden sm:flex flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg items-center justify-center">
                                        <Copy className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0 text-center sm:text-left">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-0.5">Same as friend?</div>
                                        <div className="text-xs text-slate-500 truncate">Copy hotel preferences from another traveler</div>
                                    </div>
                                    <div className="relative w-full sm:w-[220px]">
                                        <select
                                            className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-blue-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent cursor-pointer hover:border-blue-300 transition-colors"
                                            onChange={(e) => handleCopyAccommodation(e.target.value)}
                                            value={accommodationMatchId}
                                        >
                                            <option value="">Select member...</option>
                                            {existingMembers.map(m => (
                                                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-8">
                                {/* Hotel Class */}
                                <div>
                                    <label className="block text-sm text-slate-600 mb-4 font-medium uppercase tracking-wider">Comfort Level Preference</label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {[
                                            { value: '3', label: 'Standard', desc: 'Clean, comfortable bases', stars: 3 },
                                            { value: '4', label: 'Upscale', desc: 'Amenities & great locations', stars: 4 },
                                            { value: '5', label: 'Luxury', desc: 'Top-tier service & design', stars: 5 },
                                        ].map((option) => {
                                            const isSelected = hotelClass === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    onClick={() => {
                                                        setHotelClass(option.value);
                                                        setAccommodationMatchId('');
                                                    }}
                                                    className={`relative p-4 rounded-2xl border-2 transition-all text-left flex items-start gap-4 group ${
                                                        isSelected
                                                            ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                                                            : 'border-slate-100 hover:border-blue-200 bg-white hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors ${
                                                        isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600'
                                                    }`}>
                                                        {option.value === '5' ? <Crown className="w-5 h-5" /> : <BedDouble className="w-5 h-5" />}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-1 mb-1">
                                                            {Array.from({ length: option.stars }).map((_, i) => (
                                                                <Star key={i} className={`w-3 h-3 fill-current ${isSelected ? 'text-yellow-500' : 'text-yellow-400'}`} />
                                                            ))}
                                                        </div>
                                                        <div className={`font-semibold mb-0.5 text-sm ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                                                            {option.label}
                                                        </div>
                                                        <div className="text-xs text-slate-500 leading-relaxed">{option.desc}</div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-slate-100">
                                    <label className="block text-sm font-medium text-slate-700 mb-3">Room Sharing Preferences</label>
                                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                                        <div>
                                            <div className="text-sm font-medium text-slate-900">Travelers per Room</div>
                                            <div className="text-xs text-slate-500">How many people are you sharing with?</div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button
                                                onClick={() => {
                                                    setRoomOccupancy(Math.max(1, roomOccupancy - 1));
                                                    setAccommodationMatchId('');
                                                }}
                                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                                            >
                                                -
                                            </button>
                                            <div className="w-8 text-center font-semibold text-lg text-slate-900">
                                                {roomOccupancy}
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setRoomOccupancy(Math.min(4, roomOccupancy + 1));
                                                    setAccommodationMatchId('');
                                                }}
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
                                <h2 className="text-2xl text-slate-900 font-semibold">Travel Dates</h2>
                            </div>

                            {existingMembers.length > 0 && (
                                <div className="mb-8 flex flex-col sm:flex-row items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                                    <div className="hidden sm:flex flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg items-center justify-center">
                                        <Copy className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0 text-center sm:text-left">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-0.5">Same as friend?</div>
                                        <div className="text-xs text-slate-500 truncate">Copy dates from another traveler</div>
                                    </div>
                                    <div className="relative w-full sm:w-[220px]">
                                        <select
                                            className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-blue-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent cursor-pointer hover:border-blue-300 transition-colors"
                                            onChange={(e) => handleCopyDates(e.target.value)}
                                            value={datesMatchId}
                                        >
                                            <option value="">Select member...</option>
                                            {existingMembers.map(m => (
                                                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            )}

                            <div className="grid md:grid-cols-2 gap-6 mb-4">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Start Date</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => {
                                            setStartDate(e.target.value);
                                            setDatesMatchId('');
                                        }}
                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">End Date</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => {
                                            setEndDate(e.target.value);
                                            setDatesMatchId('');
                                        }}
                                        min={startDate}
                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                    />
                                </div>
                            </div>

                            <p className="text-sm text-slate-500">
                                Tip: You can arrive earlier or stay longer than the group trip.
                            </p>
                        </div>

                        {/* Meetup Note */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <MessageSquare className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Meetup Preferences</h2>
                            </div>

                            <div className="space-y-4">
                                <p className="text-slate-600 text-sm">
                                    Let the group know when you&apos;ll be joining them and any specific meetup plans.
                                </p>
                                <textarea
                                    value={meetupNote}
                                    onChange={(e) => setMeetupNote(e.target.value)}
                                    placeholder="e.g., I'll be arriving a few days early in Paris and would love to meet up for dinner on the 15th..."
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent h-32 resize-none"
                                />
                            </div>
                        </div>

                        {/* Budget & Points */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <DollarSign className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-2xl text-slate-900 font-semibold">Budget & Points</h2>
                            </div>

                            <div className="grid md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <label className="block text-sm font-medium text-slate-700">Budget Limit</label>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl text-slate-900 font-bold">${budget.toLocaleString()}</span>
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

                                <div className="space-y-4">
                                    <label className="block text-sm font-medium text-slate-700">Available Points</label>
                                    <div className="relative">
                                        <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-600" />
                                        <input
                                            type="number"
                                            value={points}
                                            onChange={(e) => setPoints(Number(e.target.value))}
                                            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleJoin}
                            disabled={!startAirport || !endDate || !startDate || isJoining}
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
