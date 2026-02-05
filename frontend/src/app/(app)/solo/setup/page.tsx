'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Calendar, Zap, MapPin, Plane, Luggage, Clock, Users, User, Baby, Plus } from 'lucide-react';
import { solo, users as usersAPI, ExtractedTripInfo } from '@/lib/api';
import TripChatbotInline from '@/components/trip-chatbot-inline';
import { searchAndFormatAirport } from '@/lib/airport-formatter';
import { searchAndFormatCities } from '@/lib/city-formatter';
import PointsAllocation from '@/components/PointsAllocation';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import DateRangePicker from '@/components/date-range-picker';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
}

export default function SoloTripSetup() {
  const router = useRouter();

  // Party Size State
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  
  // Budget State
  const [maxBudget, setMaxBudget] = useState<number | ''>('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([]);
  const [pointsToUse, setPointsToUse] = useState<Record<string, number>>({}); // program -> points to use for this trip
  const [showPointsAllocationModal, setShowPointsAllocationModal] = useState(false);

  // Date & Duration State
  const [isFlexible, setIsFlexible] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isOneWay, setIsOneWay] = useState(false);
  const [flexibleDuration, setFlexibleDuration] = useState(7); // Default days if flexible
  
  // Multi-city leg dates: each element is the departure date for that leg
  // Leg 0: origin → city[0], Leg 1: city[0] → city[1], ..., Last leg: city[n-1] → final destination
  const [legDates, setLegDates] = useState<string[]>([]);

  // Cities State
  const [cities, setCities] = useState<string[]>([]);
  const [newCity, setNewCity] = useState('');
  const [showAddDestination, setShowAddDestination] = useState(false);
  
  // Start and End Destination State (now supports multiple airports)
  const [startAirports, setStartAirports] = useState<string[]>([]);
  const [endAirports, setEndAirports] = useState<string[]>([]);
  const [isRoundTrip, setIsRoundTrip] = useState(false);

  // Travel Style State
  const [flightClass, setFlightClass] = useState('economy');
  const [bags, setBags] = useState(1);

  // Optimization Mode - always use OOP (budget-constrained), UI removed
  const optimizationMode = 'oop' as const;

  // Flight Time Preferences
  const [departureTimePreference, setDepartureTimePreference] = useState<'any' | 'morning' | 'afternoon' | 'evening' | 'night'>('any');
  const [arrivalTimePreference, setArrivalTimePreference] = useState<'any' | 'morning' | 'afternoon' | 'evening' | 'night'>('any');

  // Estimates
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [durationDays, setDurationDays] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total points from all cards; total allocated for this trip
  const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);
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

  // Sync end airports with start airports if round trip
  // This ensures end airports ALWAYS match start when round trip is enabled
  useEffect(() => {
    if (isRoundTrip) {
      // Always sync when round trip is enabled and start airports change
      setEndAirports(startAirports);
    }
  }, [startAirports, isRoundTrip]);

  // Handle extracted trip info from chatbot
  const handleExtract = async (info: ExtractedTripInfo) => {
    // Extract and format start destination as airport code
    if (info.startDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.startDestination);
        // Add to start airports if not already present
        setStartAirports(prev => prev.includes(airportCode) ? prev : [...prev, airportCode]);
      } catch (error) {
        console.error('Error formatting start destination:', error);
        // Try to add raw value if it looks like an IATA code
        if (/^[A-Z]{3}$/i.test(info.startDestination.trim())) {
          const code = info.startDestination.trim().toUpperCase();
          setStartAirports(prev => prev.includes(code) ? prev : [...prev, code]);
        }
      }
    }

    // Extract and format end destination as airport code
    if (info.endDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.endDestination);
        // Add to end airports if not already present
        setEndAirports(prev => prev.includes(airportCode) ? prev : [...prev, airportCode]);
        
        // Auto-detect round trip if start and end are the same
        if (info.startDestination && info.endDestination) {
          const startNorm = info.startDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          const endNorm = info.endDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          if (startNorm === endNorm) {
            setIsRoundTrip(true);
          }
        }
      } catch (error) {
        console.error('Error formatting end destination:', error);
        // Try to add raw value if it looks like an IATA code
        if (/^[A-Z]{3}$/i.test(info.endDestination.trim())) {
          const code = info.endDestination.trim().toUpperCase();
          setEndAirports(prev => prev.includes(code) ? prev : [...prev, code]);
        }
      }
    }

    // Extract cities (destinations) - search and format with airport codes
    if (info.cities && info.cities.length > 0) {
      try {
        const formattedCities = await searchAndFormatCities(info.cities);
        if (formattedCities && formattedCities.length > 0) {
          setCities(prevCities => {
            const newCities = formattedCities.filter(city => city && !prevCities.includes(city));
            return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
          });
        } else {
          // If formatting returns empty, use original cities
          setCities(prevCities => {
            const newCities = info.cities.filter(city => city && !prevCities.includes(city));
            return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
          });
        }
      } catch (error) {
        console.error('Error formatting cities:', error);
        // Fallback to unformatted cities - ensure they're added
        setCities(prevCities => {
          const newCities = info.cities.filter(city => city && !prevCities.includes(city));
          return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
        });
      }
    }

    // Extract dates - populate dates section
    if (info.startDate) {
      setStartDate(info.startDate);
    }
    if (info.endDate) {
      setEndDate(info.endDate);
    }
    if (info.duration !== undefined && info.duration !== null && !info.startDate && !info.endDate) {
      setIsFlexible(true);
      setFlexibleDuration(info.duration);
    }
    if (info.isFlexible !== undefined && info.isFlexible !== null) {
      setIsFlexible(info.isFlexible);
    }

    // Extract budget - populate budget section
          if (info.maxBudget !== undefined && info.maxBudget !== null) {
            setMaxBudget(info.maxBudget);
          }

    // Extract credit cards - populate credit cards section
    if (info.creditCards && info.creditCards.length > 0) {
      setCreditCards(prevCards => {
        const newCards = info.creditCards!.map((card, index) => ({
          id: `extracted-${Date.now()}-${index}`,
          program: card.program,
          points: card.points,
        }));
        // Filter out duplicates based on program name
        const existingPrograms = new Set(prevCards.map(c => c.program));
        const uniqueNewCards = newCards.filter(c => !existingPrograms.has(c.program));
        return uniqueNewCards.length > 0 ? [...prevCards, ...uniqueNewCards] : prevCards;
      });
    }

    // Extract travel style preferences
    if (info.flightClass) {
      setFlightClass(info.flightClass);
    }
  };

  // Calculate Duration
  useEffect(() => {
    if (isFlexible) {
      setDurationDays(flexibleDuration);
    } else {
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        setDurationDays(diffDays > 0 ? diffDays : 0);
      } else {
        setDurationDays(0);
      }
    }
  }, [startDate, endDate, isFlexible, flexibleDuration]);

  // Real-time cost calculation
  useEffect(() => {
    const baseCostPerDay = 200;
    const baseCostPerCity = 300;
    const estimated = (durationDays * baseCostPerDay) + (cities.length * baseCostPerCity);
    setEstimatedCost(estimated);
    setEstimatedPoints(Math.floor(estimated * 25)); // Rough points calculation
  }, [durationDays, cities.length]);

  const removeCity = (city: string) => {
    setCities(cities.filter(c => c !== city));
  };

  const removeCreditCard = (id: string) => {
    setCreditCards(creditCards.filter(card => card.id !== id));
  };

  // Compute flight legs for multi-city trips
  // Returns array of {from, to} objects representing each flight segment
  const getFlightLegs = () => {
    if (startAirports.length === 0 || cities.length === 0) return [];
    
    const legs: Array<{ from: string; to: string; index: number }> = [];
    
    // First leg: origin airports → first city
    const startDisplay = startAirports.length > 1 
      ? startAirports.join(', ') 
      : startAirports[0];
    legs.push({ from: startDisplay, to: cities[0], index: 0 });
    
    // Middle legs: city[i] → city[i+1]
    for (let i = 0; i < cities.length - 1; i++) {
      legs.push({ from: cities[i], to: cities[i + 1], index: i + 1 });
    }
    
    // Last leg: last city → final destination (if not one-way with same end)
    const lastCity = cities[cities.length - 1];
    const finalAirports = isRoundTrip ? startAirports : endAirports;
    const finalDisplay = finalAirports.length > 1
      ? finalAirports.join(', ')
      : finalAirports[0] || '';
    if (finalDisplay && finalDisplay !== lastCity) {
      legs.push({ from: lastCity, to: finalDisplay, index: cities.length });
    }
    
    return legs;
  };

  const flightLegs = getFlightLegs();
  const isMultiCity = cities.length > 1;

  // Update leg date at specific index
  const updateLegDate = (index: number, date: string) => {
    setLegDates(prev => {
      const newDates = [...prev];
      // Ensure array is long enough
      while (newDates.length <= index) {
        newDates.push('');
      }
      newDates[index] = date;
      return newDates;
    });
  };

  // Sync legDates when switching between simple and multi-city mode
  // When going from simple to multi-city, populate first leg with startDate
  useEffect(() => {
    if (isMultiCity && legDates.length === 0 && startDate) {
      setLegDates([startDate]);
    }
    // When going back to single city, sync startDate from first leg
    if (!isMultiCity && legDates.length > 0 && legDates[0]) {
      setStartDate(legDates[0]);
    }
  }, [isMultiCity, startDate, legDates]);

  // Get minimum date for a leg (must be after previous leg's date)
  const getMinDateForLeg = (index: number): string => {
    if (index === 0) {
      return new Date().toISOString().split('T')[0]; // Today
    }
    const prevDate = legDates[index - 1];
    if (prevDate) {
      // Add 1 day to previous date
      const prev = new Date(prevDate);
      prev.setDate(prev.getDate() + 1);
      return prev.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  };

  const handleGenerate = async () => {
    // Validate required fields
    if (startAirports.length === 0) {
      setError('Please select at least one departure airport');
      return;
    }
    if (!isRoundTrip && endAirports.length === 0) {
      setError('Please select at least one arrival airport');
      return;
    }
    // Round trip requires at least one destination; one-way can be direct (departure → arrival, no cities)
    if (isRoundTrip && cities.length < 1) {
      setError('Please add at least 1 destination city for a round trip');
      return;
    }
    
    // Validate budget - now required
    if (maxBudget === '' || maxBudget <= 0) {
      setError('Please enter a maximum budget for your trip');
      return;
    }
    
    // Validate dates
    if (!isFlexible) {
      if (!startDate) {
        setError('Please select a departure date');
        return;
      }
      // One-way trips only need departure date; arrival/return date is not used
      if (!isRoundTrip) {
        // One-way: no return/arrival date required
      } else if (!endDate) {
        setError('Please select a return/arrival date');
        return;
      }
      // For multi-city, validate intermediate dates (except the last city which uses endDate)
      if (cities.length > 1) {
        for (let i = 0; i < cities.length - 1; i++) {
          if (!legDates[i + 1]) {
            setError(`Please select a departure date from ${cities[i]}`);
            return;
          }
        }
      }
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 1. Create trip using the new solo API with all preferences
      const tripTitle = cities.length > 0 
        ? `Solo Trip to ${cities[0]}${cities.length > 1 ? ` + ${cities.length - 1} more` : ''}` 
        : 'Solo Trip';
      
      // Use startDate and endDate directly since they're now always set in the new UI
      const effectiveStartDate = startDate;
      const effectiveEndDate = endDate;
      
      // For API, join multiple airports with comma for origin/finalDestination
      const originAirports = startAirports.join(',');
      const finalAirports = isRoundTrip ? startAirports.join(',') : endAirports.join(',');
      
      const trip = await solo.createTrip({
        title: tripTitle,
        tripType: isRoundTrip ? 'round_trip' : 'one_way',
        dateMode: isFlexible ? 'flexible' : 'fixed',
        origin: originAirports,
        destinations: cities,
        finalDestination: finalAirports,
        startDate: isFlexible ? undefined : effectiveStartDate,
        // One-way trips only use departure date; do not send arrival/return date
        endDate: isFlexible ? undefined : (isRoundTrip ? effectiveEndDate : undefined),
        durationDays: isFlexible ? flexibleDuration : undefined,
        maxBudget: maxBudget,
        adults: adults,
        children: children,
        bags: bags,
        flightClass: flightClass as 'basic_economy' | 'economy' | 'premium' | 'business' | 'first',
        optimizationMode: optimizationMode,
        departureTimePreference: departureTimePreference,
        arrivalTimePreference: arrivalTimePreference,
        // Pass leg dates for multi-city trips
        legDates: isMultiCity ? legDates : undefined,
      });

      // 2. Add credit card points (use allocated amount, or all if not set)
      if (creditCards.length > 0) {
        const pointsBalances = creditCards.map(card => ({
          program: card.program,
          balance: pointsToUse[card.program] ?? card.points,
        }));
        await solo.upsertPoints(trip.tripId, pointsBalances);
      }

      // 3. Navigate to results page for optimization
      router.push(`/solo/results?trip_id=${trip.tripId}`);
    } catch (err) {
      console.error('Error generating itinerary:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <div data-testid="solo-setup-page" data-slot="SoloTripSetup" className="min-h-full p-6 md:p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl tracking-tight text-slate-900 font-bold">Book Your Flight</h1>
          <p className="text-slate-500 mt-1">Find the best deals using your points</p>
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
                          Departure Airport(s)
                        </label>
                        <MultiAirportAutocomplete
                          value={startAirports}
                          onChange={setStartAirports}
                          placeholder="e.g., JFK, EWR, LGA"
                          maxSelections={5}
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
                            // Also update first leg date for multi-city
                            updateLegDate(0, date);
                          }}
                          minDate={new Date().toISOString().split('T')[0]}
                          placeholder="Select date"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* INTERMEDIATE DESTINATIONS */}
                  {cities.map((city, index) => {
                    // Don't show departure date for the last city - it's represented by the end date
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
                        <div className={`flex-1 ${isLastCity ? '' : 'grid grid-cols-1 md:grid-cols-2 gap-4'} -mt-1`}>
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
                                onClick={() => {
                                  removeCity(city);
                                  // Remove the corresponding leg date
                                  setLegDates(prev => {
                                    const newDates = [...prev];
                                    newDates.splice(index + 1, 1);
                                    return newDates;
                                  });
                                }}
                                className="px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                title="Remove destination"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {/* Only show departure date for non-last cities in multi-city trips */}
                          {!isLastCity && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                                Departure Date
                              </label>
                              <SingleDatePicker
                                value={legDates[index + 1] || ''}
                                onChange={(date) => updateLegDate(index + 1, date)}
                                minDate={getMinDateForLeg(index + 1)}
                                disabled={isFlexible}
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
                          Arrival Airport(s)
                        </label>
                        {isRoundTrip ? (
                          <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600 min-h-[46px] flex items-center">
                            {startAirports.length > 0 
                              ? `Same as departure (${startAirports.join(', ')})` 
                              : 'Same as departure airport(s)'}
                          </div>
                        ) : (
                          <MultiAirportAutocomplete
                            value={endAirports}
                            onChange={setEndAirports}
                            placeholder="e.g., JFK, EWR, LGA"
                            maxSelections={5}
                          />
                        )}
                      </div>
                      {/* Arrival/return date: only for round trip; one-way uses departure date only */}
                      {isRoundTrip && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                            Return Date
                          </label>
                          <SingleDatePicker
                            value={endDate}
                            onChange={(date) => setEndDate(date)}
                            minDate={cities.length > 0 ? getMinDateForLeg(cities.length) : (startDate || new Date().toISOString().split('T')[0])}
                            placeholder="Select date"
                          />
                        </div>
                      )}
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
                        setEndAirports(startAirports);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Start and end at same airport(s)
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
                    className={`w-full pl-10 pr-4 py-3 bg-blue-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold text-slate-900 text-lg ${
                      maxBudget === '' ? 'border-blue-200' : 'border-blue-200'
                    }`}
                  />
                </div>
                {maxBudget === '' && (
                  <p className="text-xs text-slate-500 mt-2">Required to optimize your trip</p>
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
                onClick={handleGenerate}
                disabled={startAirports.length === 0 || (!isRoundTrip && endAirports.length === 0) || (isRoundTrip && cities.length < 1) || (!isFlexible && (!startDate || (isRoundTrip && !endDate))) || maxBudget === '' || isGenerating}
                className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base font-semibold shadow-lg shadow-blue-500/20"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Searching flights...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    <span>Search Flights</span>
                  </>
                )}
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              
              <p className="text-xs text-slate-500 text-center">
                We&apos;ll find the best options using your points and budget
              </p>
            </div>
          </div>
        </div>
      </div>

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
                maxTotalPoints={estimatedPoints > 0 ? estimatedPoints : undefined}
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
