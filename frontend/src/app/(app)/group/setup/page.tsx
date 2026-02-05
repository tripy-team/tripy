'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, MapPin, Calendar, X, Copy, Check, ArrowRight, RefreshCw, Baby, User, Info, Plane, Luggage, Plus } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, users as usersAPI, trips as tripsAPI } from '@/lib/api';
import PointsAllocation from '@/components/PointsAllocation';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
}

export default function GroupTripSetup() {
  const router = useRouter();
  
  // Budget State
  const [maxBudget, setMaxBudget] = useState<number | ''>('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([]);
  const [pointsToUse, setPointsToUse] = useState<Record<string, number>>({}); // program -> points to use for this trip
  const [showPointsAllocationModal, setShowPointsAllocationModal] = useState(false);
  
  // Date State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Multi-city leg dates: each element is the departure date for that leg (when 2+ destinations)
  const [legDates, setLegDates] = useState<string[]>([]);

  // Cities State
  const [cities, setCities] = useState<string[]>([]);
  const [newCity, setNewCity] = useState('');
  const [showAddDestination, setShowAddDestination] = useState(false);
  
  // Start and End Destination State
  const [startDestination, setStartDestination] = useState('');
  const [endDestination, setEndDestination] = useState('');
  const [isRoundTrip, setIsRoundTrip] = useState(false);


  // Flight Time Preferences
  const [departureTimePreference, setDepartureTimePreference] = useState<'any' | 'morning' | 'afternoon' | 'evening' | 'night'>('any');
  const [arrivalTimePreference, setArrivalTimePreference] = useState<'any' | 'morning' | 'afternoon' | 'evening' | 'night'>('any');

  // Travel Style State
  const [flightClass, setFlightClass] = useState('economy');
  const [bags, setBags] = useState(1);

  // Party Size State
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);

  // Invite State
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total points to use for this trip
  const totalPointsToUse = creditCards.reduce((sum, card) => sum + (pointsToUse[card.program] ?? card.points), 0);

  // Scroll to top on mount and keep it at top
  useEffect(() => {
    // Immediate scroll with smooth behavior disabled for instant effect
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Also use scrollTo with instant behavior
    if (typeof window !== 'undefined' && window.document) {
      window.document.documentElement.scrollTop = 0;
      window.document.body.scrollTop = 0;
    }
    
    // Scroll again after a brief delay to ensure it stays at top
    const timeoutId = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (typeof window !== 'undefined' && window.document) {
        window.document.documentElement.scrollTop = 0;
        window.document.body.scrollTop = 0;
      }
    }, 100);
    
    // And one more after components are fully rendered (before chatbot focus)
    const timeoutId2 = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (typeof window !== 'undefined' && window.document) {
        window.document.documentElement.scrollTop = 0;
        window.document.body.scrollTop = 0;
      }
    }, 500);
    
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(timeoutId2);
    };
  }, []);

  // Sync end destination with start destination if round trip
  useEffect(() => {
    if (isRoundTrip && startDestination) {
      setEndDestination(startDestination);
    }
  }, [startDestination, isRoundTrip]);

  // Load user profile on mount
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        setIsLoadingProfile(true);
        const profile = await usersAPI.getProfile();
        
        // Max budget is now per-trip, not stored in profile
        // User will set it manually for each trip
        
        if (profile.credit_cards && profile.credit_cards.length > 0) {
          setCreditCards(profile.credit_cards.map(card => ({
            id: card.id,
            program: card.program,
            points: card.points,
          })));
        }
      } catch (err) {
        console.error('Error loading user profile:', err);
        // Use defaults if profile load fails
      } finally {
        setIsLoadingProfile(false);
      }
    };

    loadUserProfile();
  }, []);

  // Save credit cards when they change
  useEffect(() => {
    if (!isLoadingProfile) {
      const saveProfile = async () => {
        try {
          await usersAPI.updateProfile({
            credit_cards: creditCards,
          });
        } catch (err) {
          console.error('Error saving user profile:', err);
        }
      };

      // Debounce saves to avoid too many API calls
      const timeoutId = setTimeout(saveProfile, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [creditCards, isLoadingProfile]);

  const removeCity = (city: string) => {
    const index = cities.indexOf(city);
    setCities(cities.filter(c => c !== city));
    if (index >= 0) {
      setLegDates(prev => {
        const newDates = [...prev];
        newDates.splice(index + 1, 1);
        return newDates;
      });
    }
  };

  const isMultiCity = cities.length >= 2;

  const updateLegDate = (index: number, date: string) => {
    setLegDates(prev => {
      const newDates = [...prev];
      while (newDates.length <= index) newDates.push('');
      newDates[index] = date;
      return newDates;
    });
  };

  const getMinDateForLeg = (index: number): string => {
    if (index === 0) return new Date().toISOString().split('T')[0];
    const prevDate = legDates[index - 1];
    if (prevDate) {
      const prev = new Date(prevDate);
      prev.setDate(prev.getDate() + 1);
      return prev.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  };

  // Sync legDates when switching to 2+ destinations
  useEffect(() => {
    if (isMultiCity && legDates.length === 0 && startDate) {
      setLegDates([startDate]);
    }
    if (!isMultiCity && legDates.length > 0 && legDates[0]) {
      setStartDate(legDates[0]);
    }
  }, [isMultiCity, startDate, legDates]);

  const handleCreateTrip = async () => {
    // Validate required fields
    if (!startDestination) {
      setError('Please fill in the start destination');
      return;
    }
    if (!endDestination) {
      setError('Please fill in the end destination');
      return;
    }
    if (cities.length < 1) {
      setError('Please add at least 1 destination city');
      return;
    }
    
    // Validate budget - now required for group trips
    if (maxBudget === '' || maxBudget <= 0) {
      setError('Please enter a maximum budget for your group trip');
      return;
    }
    
    if (!startDate) {
      setError('Please select a departure date');
      return;
    }
    if (!endDate) {
      setError('Please select a return/arrival date');
      return;
    }
    if (cities.length >= 2) {
      for (let i = 0; i < cities.length - 1; i++) {
        if (!legDates[i + 1]) {
          setError(`Please select a departure date from ${cities[i]}`);
          return;
        }
      }
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 1. Create trip
      const tripTitle = cities.length > 0 
        ? `Group Trip to ${cities[0]}${cities.length > 1 ? ` + ${cities.length - 1} more` : ''}` 
        : 'Group Trip';
      const trip = await createTrip({
        title: tripTitle,
        start_date: startDate,
        end_date: endDate,
        max_budget: maxBudget,
        // Include organizer's party size
        adults: adults,
        children: children,
      });

      // 2. Add start destination if provided
      if (startDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: startDestination,
          must_include: true,
          excluded: false,
          is_start: true,
          is_end: false,
        });
      }

      // 3. Add end destination if provided
      if (endDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: endDestination,
          must_include: true,
          excluded: false,
          is_start: false,
          is_end: true,
        });
      }

      // 4. Add other destinations
      for (const city of cities) {
        await addDestination({
          trip_id: trip.tripId,
          name: city,
          must_include: false,
          excluded: false,
        });
      }

      // 5. Add credit card points (use allocated amount, or all if not set)
      for (const card of creditCards) {
        await upsertPoints({
          trip_id: trip.tripId,
          program: card.program,
          balance: pointsToUse[card.program] ?? card.points,
        });
      }

      // 6. Get invite code
      const inviteResponse = await tripsAPI.invite(trip.tripId);
      
      // Store trip ID and invite info
      setCurrentTripId(trip.tripId);
      setInviteCode(inviteResponse.inviteCode);
      
      // Set invite link
      const frontendUrl = typeof window !== 'undefined' 
        ? window.location.origin 
        : 'tripy.app';
      const link = `${frontendUrl}/group/join/${inviteResponse.inviteCode}`;
      setInviteLink(link);
      setShowInviteModal(true);
    } catch (err) {
      console.error('Error creating trip:', err);
      setError(err instanceof Error ? err.message : 'Failed to create trip. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateInvite = async () => {
    if (!currentTripId) return;
    
    setIsRegenerating(true);
    try {
      const response = await tripsAPI.regenerateInvite(currentTripId);
      setInviteCode(response.inviteCode);
      
      const frontendUrl = typeof window !== 'undefined' 
        ? window.location.origin 
        : 'tripy.app';
      const newLink = `${frontendUrl}/group/join/${response.inviteCode}`;
      setInviteLink(newLink);
      setCopied(false); // Reset copied state
    } catch (err) {
      console.error('Error regenerating invite code:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate invite code');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleContinue = () => {
    if (currentTripId) {
      router.push(`/group/dashboard?tripId=${currentTripId}`);
    } else {
      router.push('/group/dashboard');
    }
  };

  return (
    <div data-testid="group-setup-page" data-slot="GroupTripSetup" className="min-h-full p-6 md:p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-2 font-medium">
            <Users className="w-4 h-4" />
            <span>Group Trip</span>
          </div>
          <h1 className="text-3xl md:text-4xl tracking-tight text-slate-900 font-bold">Plan Your Group Trip</h1>
          <p className="text-slate-500 mt-1">Find the best deals using your group&apos;s points</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Main Form */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. TRAVELERS - Compact horizontal bar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-6 md:gap-10">
                {/* Adults */}
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-slate-700 font-medium">Adults</span>
                  <div className="flex items-center gap-2 ml-1">
                    <button 
                      type="button"
                      onClick={() => setAdults(Math.max(1, adults - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900">{adults}</span>
                    <button 
                      type="button"
                      onClick={() => setAdults(adults + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Children */}
                <div className="flex items-center gap-3">
                  <Baby className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-slate-700 font-medium">Children</span>
                  <div className="flex items-center gap-2 ml-1">
                    <button 
                      type="button"
                      onClick={() => setChildren(Math.max(0, children - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900">{children}</span>
                    <button 
                      type="button"
                      onClick={() => setChildren(children + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Bags per person */}
                <div className="flex items-center gap-3">
                  <Luggage className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-slate-700 font-medium">Bags</span>
                  <div className="flex items-center gap-2 ml-1">
                    <button
                      type="button"
                      onClick={() => setBags(Math.max(0, bags - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900">{bags}</span>
                    <button
                      type="button"
                      onClick={() => setBags(Math.min(4, bags + 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
              
              {adults > 1 && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900">
                    <span className="font-semibold">Note:</span> Additional adults here are part of your booking and don&apos;t contribute points. If they have points, they should join via group travel invite link.
                  </div>
                </div>
              )}
            </div>
            
            {/* Your Route - Unified flight booking interface */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Plane className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl text-slate-900 font-semibold">Your Route</h2>
                  <p className="text-sm text-slate-500">Build your trip by adding destinations and dates</p>
                </div>
              </div>

              <div className="relative">
                {/* Timeline connector line */}
                <div className="absolute left-[11px] top-8 bottom-8 w-0.5 bg-blue-200 z-0" />
                
                <div className="space-y-0 relative z-10">
                  {/* START LOCATION */}
                  <div className="flex gap-6 pb-4">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10" />
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Start Location
                        </label>
                        <AirportAutocomplete
                          value={startDestination}
                          onValueChange={setStartDestination}
                          placeholder="e.g., New York (JFK)"
                          onSelect={(airportCode) => {
                            setStartDestination(airportCode);
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Departure Date
                        </label>
                        <SingleDatePicker
                          value={startDate}
                          onChange={(date) => {
                            setStartDate(date);
                            if (isMultiCity) updateLegDate(0, date);
                          }}
                          minDate={new Date().toISOString().split('T')[0]}
                          placeholder="Select date"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* INTERMEDIATE DESTINATIONS */}
                  {cities.map((city, index) => {
                    const isLastCity = index === cities.length - 1;
                    return (
                      <div key={`city-${index}`} className="flex gap-6 py-4">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center">
                          <div className="w-6 h-6 rounded-full bg-blue-500 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                            <span className="text-[8px] text-white font-bold">{index + 1}</span>
                          </div>
                        </div>
                        
                        {/* Content */}
                        <div className={`flex-1 ${isMultiCity && !isLastCity ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''} -mt-1`}>
                          <div className="relative">
                            <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                              Destination {index + 1}
                            </label>
                            <div className="flex gap-2">
                              <div className="flex-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-slate-900 font-medium">
                                {city}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCity(city)}
                                className="px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                title="Remove destination"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {/* When 2+ destinations, show departure date for each intermediate stop (not the last) */}
                          {isMultiCity && !isLastCity && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                                Departure Date
                              </label>
                              <SingleDatePicker
                                value={legDates[index + 1] || ''}
                                onChange={(date) => updateLegDate(index + 1, date)}
                                minDate={getMinDateForLeg(index + 1)}
                                placeholder="Select date"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* ADD DESTINATION BUTTON */}
                  <div className="flex gap-6 py-4">
                    {/* Timeline connector */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-white border-2 border-dashed border-slate-300 z-10" />
                    </div>
                    
                    {/* Add button and dropdown */}
                    <div className="flex-1 -mt-1 relative">
                      <button
                        type="button"
                        onClick={() => setShowAddDestination(!showAddDestination)}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Add Another Destination
                      </button>
                      
                      {/* Dropdown popup */}
                      {showAddDestination && (
                        <>
                          {/* Backdrop to close on click outside */}
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => {
                              setShowAddDestination(false);
                              setNewCity('');
                            }}
                          />
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-50">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                                Search for a city
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddDestination(false);
                                  setNewCity('');
                                }}
                                className="text-slate-400 hover:text-slate-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <DestinationAutocomplete
                              value={newCity}
                              onChange={setNewCity}
                              autoFocus
                              onSelect={(city) => {
                                if (city && !cities.includes(city)) {
                                  setCities(prevCities => [...prevCities, city]);
                                  setNewCity('');
                                  setShowAddDestination(false);
                                }
                              }}
                              placeholder="e.g., Paris, Rome, Tokyo..."
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* FINAL DESTINATION */}
                  <div className="flex gap-6 pt-4">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                        <MapPin className="w-3 h-3 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Final Destination
                        </label>
                        {isRoundTrip ? (
                          <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600">
                            {startDestination || 'Same as start location'}
                          </div>
                        ) : (
                          <AirportAutocomplete
                            value={endDestination}
                            onValueChange={setEndDestination}
                            placeholder="e.g., New York (JFK)"
                            onSelect={(airportCode) => {
                              setEndDestination(airportCode);
                            }}
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          {isRoundTrip ? 'Return Date' : 'Arrival Date'}
                        </label>
                        <SingleDatePicker
                          value={endDate}
                          onChange={(date) => setEndDate(date)}
                          minDate={isMultiCity && cities.length > 0 ? getMinDateForLeg(cities.length) : (startDate || new Date().toISOString().split('T')[0])}
                          placeholder="Select date"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Options */}
              <div className="mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={isRoundTrip}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsRoundTrip(checked);
                      if (checked) {
                        setEndDestination(startDestination);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Start and end at same location
                  </span>
                </label>
                
              </div>
              
              <p className="mt-4 text-xs text-slate-500">
                Small and regional airports are supported. We include connecting flights when needed.
              </p>
            </div>
            
            {/* 3. TRAVEL STYLE & PREFERENCES */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg text-slate-900 font-semibold mb-4">Travel Style & Preferences</h2>
              
              <div className="space-y-5">
                {/* Cabin Class */}
                <div>
                  <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Cabin Class</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'basic_economy', label: 'Basic Economy' },
                      { value: 'economy', label: 'Economy' },
                      { value: 'premium', label: 'Premium Economy' },
                      { value: 'business', label: 'Business' },
                      { value: 'first', label: 'First' },
                    ].map((option) => {
                      const isSelected = flightClass === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFlightClass(option.value)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            isSelected 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time Preferences - Combined */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Prefer to Depart</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'any', label: 'Anytime' },
                        { value: 'morning', label: 'Morning' },
                        { value: 'afternoon', label: 'Afternoon' },
                        { value: 'evening', label: 'Evening' },
                      ].map((option) => {
                        const isSelected = departureTimePreference === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setDepartureTimePreference(option.value as typeof departureTimePreference)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Prefer to Arrive</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'any', label: 'Anytime' },
                        { value: 'morning', label: 'Morning' },
                        { value: 'afternoon', label: 'Afternoon' },
                        { value: 'evening', label: 'Evening' },
                      ].map((option) => {
                        const isSelected = arrivalTimePreference === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setArrivalTimePreference(option.value as typeof arrivalTimePreference)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column - Budget, Points & Actions */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 space-y-4">
              
              {/* Budget - Required */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">
                  Maximum Budget <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 font-bold text-lg">$</span>
                  <input
                    type="number"
                    value={maxBudget}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : '';
                      setMaxBudget(val);
                    }}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="Enter your budget"
                    min="1"
                    required
                    className="w-full pl-10 pr-4 py-3 bg-blue-50 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold text-slate-900 text-lg"
                  />
                </div>
                {maxBudget === '' && (
                  <p className="text-xs text-slate-500 mt-2">Required to create the trip</p>
                )}
              </div>

              {/* Points */}
              {creditCards.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">Your Points</label>
                    <button
                      type="button"
                      onClick={() => setShowPointsAllocationModal(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Adjust
                    </button>
                  </div>
                  <div className="space-y-2">
                    {creditCards.slice(0, 3).map(card => {
                      const toUse = pointsToUse[card.program] ?? card.points;
                      return (
                        <div key={card.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 truncate">{card.program}</span>
                          <span className="text-slate-900 font-medium">{toUse.toLocaleString()}</span>
                        </div>
                      );
                    })}
                    {creditCards.length > 3 && (
                      <button 
                        type="button"
                        onClick={() => setShowPointsAllocationModal(true)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        +{creditCards.length - 3} more
                      </button>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-sm text-slate-600">Total to use</span>
                    <span className="text-xl font-bold text-blue-600">{totalPointsToUse.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleCreateTrip}
                disabled={!startDestination || !endDestination || cities.length < 1 || !startDate || !endDate || maxBudget === '' || isGenerating}
                className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base font-semibold shadow-lg shadow-blue-500/20"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Creating trip...</span>
                  </>
                ) : (
                  <>
                    <Users className="w-5 h-5" />
                    <span>Create & Invite Friends</span>
                  </>
                )}
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              
              <p className="text-xs text-slate-500 text-center">
                We&apos;ll find the best options using your group&apos;s points and budget
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 animate-in fade-in zoom-in duration-200">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Trip Created Successfully!</h2>
                    <p className="text-slate-600">Your group trip is ready. Share this link to invite members.</p>
                </div>

                <div className="space-y-4 mb-6">
                    {/* Invite Code */}
                    <div>
                        <label className="block text-sm text-slate-600 mb-2 font-medium">Invite Code</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={inviteCode}
                                readOnly
                                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-lg font-bold text-center"
                            />
                            <button
                                onClick={handleRegenerateInvite}
                                disabled={isRegenerating}
                                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-xl transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                title="Generate new invite code"
                            >
                                {isRegenerating ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Generating...</span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="w-4 h-4" />
                                    <span>New Code</span>
                                  </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Invite Link */}
                    <div>
                        <label className="block text-sm text-slate-600 mb-2 font-medium">Invite Link</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={inviteLink}
                                readOnly
                                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 font-mono text-sm"
                            />
                            <button
                                onClick={copyInvite}
                                className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium flex items-center gap-2"
                            >
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleContinue}
                    className="w-full py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
                >
                    <span>Continue to Dashboard</span>
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
      )}

      {/* Points Allocation Modal */}
      {showPointsAllocationModal && creditCards.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPointsAllocationModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-xl font-bold text-slate-900">Allocate points for this trip</h2>
              <p className="text-sm text-slate-600 mt-1">Choose how many points to use from each card. Default is use all.</p>
            </div>
            <div className="overflow-y-auto flex-1 p-6">
              <PointsAllocation
                availablePoints={creditCards.map(c => ({ program: c.program, points: c.points, id: c.id }))}
                allocatedPoints={Object.fromEntries(creditCards.map(c => [c.program, pointsToUse[c.program] ?? c.points]))}
                onAllocationChange={(allocations) => setPointsToUse(allocations)}
                showCategoryIcons
              />
            </div>
            <div className="p-6 border-t border-slate-200 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowPointsAllocationModal(false)}
                className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
