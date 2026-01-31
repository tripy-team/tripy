'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Calendar, DollarSign, Zap, MapPin, Sparkles, CreditCard, MessageCircle, Plane, Backpack, Armchair, Coffee, Wine, Crown, BedDouble, Star, SlidersHorizontal, Luggage, Target, TrendingUp, Scale, Clock, Sunrise, Sun, Sunset, Moon, Users, User, Baby, Info } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, users as usersAPI, ExtractedTripInfo } from '@/lib/api';
import TripChatbotInline from '@/components/trip-chatbot-inline';
import PointsAllocation from '@/components/PointsAllocation';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import DateRangePicker from '@/components/date-range-picker';

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

  // Cities State
  const [cities, setCities] = useState<string[]>([]);
  const [newCity, setNewCity] = useState('');
  
  // Start and End Destination State
  const [startDestination, setStartDestination] = useState('');
  const [endDestination, setEndDestination] = useState('');
  const [isRoundTrip, setIsRoundTrip] = useState(false);

  // Travel Style State
  const [flightClass, setFlightClass] = useState('economy');
  const [hotelClass, setHotelClass] = useState('4');
  const [includeHotels, setIncludeHotels] = useState(true);
  const [bags, setBags] = useState(1);

  // Optimization Mode State
  const [optimizationMode, setOptimizationMode] = useState<'oop' | 'cpp' | 'balanced'>('balanced');

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

  // Sync end destination with start destination if round trip
  // This ensures end destination ALWAYS matches start when round trip is enabled
  useEffect(() => {
    if (isRoundTrip) {
      // Always sync when round trip is enabled and start destination changes
      setEndDestination(startDestination);
    }
  }, [startDestination, isRoundTrip]);

  // Handle extracted trip info from chatbot
  const handleExtract = async (info: ExtractedTripInfo) => {
    // Extract and format start destination as airport code
    if (info.startDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.startDestination);
        setStartDestination(airportCode);
      } catch (error) {
        console.error('Error formatting start destination:', error);
        setStartDestination(info.startDestination);
      }
    }

    // Extract and format end destination as airport code
    if (info.endDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.endDestination);
        setEndDestination(airportCode);
        
        // 🥚 Auto-detect round trip if start and end are the same
        if (info.startDestination && info.endDestination) {
          const startNorm = info.startDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          const endNorm = info.endDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          if (startNorm === endNorm) {
            setIsRoundTrip(true);
          }
        }
      } catch (error) {
        console.error('Error formatting end destination:', error);
        setEndDestination(info.endDestination);
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
    if (info.hotelClass) {
      setHotelClass(info.hotelClass);
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

  const handleGenerate = async () => {
    // Validate required fields
    if (!startDestination || !endDestination) {
      setError('Please fill in both start and end destinations');
      return;
    }
    if (cities.length < 1) {
      setError('Please add at least 1 destination city');
      return;
    }
    if (!isFlexible && !startDate) {
      setError('Please select a start date');
      return;
    }
    if (!isFlexible && !isOneWay && !endDate) {
      setError('Please select an end date');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 1. Create trip
      const tripTitle = cities.length > 0 
        ? `Solo Trip to ${cities[0]}` 
        : 'Solo Trip';
      const trip = await createTrip({
        title: tripTitle,
        start_date: isFlexible ? '' : startDate,
        end_date: isFlexible || isOneWay ? '' : endDate,
        include_hotels: false,
        max_budget: maxBudget === '' ? undefined : (typeof maxBudget === 'number' ? maxBudget : undefined),
        duration_days: isFlexible ? flexibleDuration : undefined,
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

      // 6. Navigate to results; payment step is shown there when no itinerary yet
      router.push(`/solo/results?trip_id=${trip.tripId}`);
    } catch (err) {
      console.error('Error generating itinerary:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <div data-testid="solo-setup-page" data-slot="SoloTripSetup" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl mb-3 tracking-tight text-slate-900 font-bold">Configure your trip</h1>
          <p className="text-lg text-slate-600">Set your preferences and we&apos;ll generate optimized itineraries</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Inputs */}
          <div className="lg:col-span-2 space-y-6">

            {/* Party Size */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Your Travel Party</h2>
                  <p className="text-sm text-slate-500">Who is traveling with you?</p>
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
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-slate-900 pl-1">Additional Traveler Details</h3>
                    {Array.from({ length: adults - 1 }).map((_, index) => (
                      <div key={index} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Adult {index + 2}</div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Full Name</label>
                            <input 
                              type="text" 
                              placeholder="e.g. John Doe"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm" 
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Email Address (optional)</label>
                            <input 
                              type="email" 
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
            
            {/* Budget */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-2xl text-slate-900 font-semibold">Budget Range</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-slate-600 mb-3 font-medium">Maximum Budget</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                    <input
                      type="number"
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value ? Number(e.target.value) : '')}
                      placeholder="Enter maximum budget"
                      className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-medium text-slate-900"
                    />
                  </div>
                </div>

                {/* Credit Card List - click to allocate points */}
                {creditCards.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm text-slate-600 font-medium">Your Cards</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <button
                          type="button"
                          onClick={() => setShowPointsAllocationModal(true)}
                          className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium"
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                          Allocate points
                        </button>
                        <span className="text-slate-400">·</span>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-blue-600" />
                          <span className="text-slate-900 font-medium">{totalPointsToUse.toLocaleString()} to use</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {creditCards.map(card => {
                        const toUse = pointsToUse[card.program] ?? card.points;
                        const isCustom = toUse !== card.points;
                        return (
                          <div
                            key={card.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setShowPointsAllocationModal(true)}
                            onKeyDown={(e) => e.key === 'Enter' && setShowPointsAllocationModal(true)}
                            className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl group hover:bg-blue-100 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <CreditCard className="w-4 h-4 text-blue-600" />
                              <div>
                                <div className="text-sm text-slate-900 font-medium">{card.program}</div>
                                <div className="text-xs text-slate-600">
                                  {isCustom
                                    ? `${toUse.toLocaleString()} of ${card.points.toLocaleString()} to use`
                                    : `${card.points.toLocaleString()} points`}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeCreditCard(card.id); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -m-1"
                              >
                                <X className="w-4 h-4 text-slate-600 hover:text-slate-900" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Travel Style */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Plane className="w-4 h-4 text-blue-600" />
                </div>
                <h2 className="text-xl text-slate-900 font-semibold">Travel Style</h2>
              </div>

              <div className="space-y-5">
                {/* Flight Class - Compact pill buttons */}
                <div>
                  <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Flight Class</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'basic_economy', label: 'Basic', icon: Backpack },
                      { value: 'economy', label: 'Economy', icon: Armchair },
                      { value: 'premium', label: 'Premium', icon: Coffee },
                      { value: 'business', label: 'Business', icon: Wine },
                      { value: 'first', label: 'First', icon: Crown },
                    ].map((option) => {
                      const Icon = option.icon;
                      const isSelected = flightClass === option.value;
                      return (
                        <button
                          key={option.value}
                          onClick={() => setFlightClass(option.value)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                            isSelected 
                              ? 'bg-blue-600 text-white shadow-sm' 
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hotel toggle + class in one row */}
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeHotels}
                      onChange={(e) => setIncludeHotels(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span className="text-sm text-slate-700 font-medium">Include hotels</span>
                  </label>

                  {/* Hotel Class - Compact pills, only when hotels enabled */}
                  {includeHotels && (
                    <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
                      {[
                        { value: '3', label: '3★' },
                        { value: '4', label: '4★' },
                        { value: '5', label: '5★' },
                      ].map((option) => {
                        const isSelected = hotelClass === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setHotelClass(option.value)}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
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
                  )}
                </div>

                {/* Number of Bags - Compact inline */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Luggage className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-700 font-medium">Checked bags</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBags(Math.max(0, bags - 1))}
                      className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-semibold text-slate-900 text-sm">{bags}</span>
                    <button
                      type="button"
                      onClick={() => setBags(Math.min(6, bags + 1))}
                      className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
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
                <h2 className="text-2xl text-slate-900 font-semibold">Dates</h2>
              </div>

              <div className="space-y-6">
                {/* Travel Dates - Always visible */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">
                    Travel Dates
                  </label>
                  <DateRangePicker
                    startDate={startDate}
                    endDate={endDate}
                    onStartDateChange={setStartDate}
                    onEndDateChange={setEndDate}
                    isOneWay={isOneWay}
                  />
                </div>

                {/* Flexible Dates and One-way Trip Checkboxes */}
                <div className="flex flex-wrap items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none group inline-flex">
                    <input
                      type="checkbox"
                      checked={isFlexible}
                      onChange={(e) => setIsFlexible(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Flexible dates</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none group inline-flex">
                    <input
                      type="checkbox"
                      checked={isOneWay}
                      onChange={(e) => {
                        setIsOneWay(e.target.checked);
                        if (e.target.checked) {
                          setEndDate('');
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">One-way trip</span>
                  </label>
                </div>

                {/* Flight Time Preferences */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 min-w-[90px]">
                      <Plane className="w-3.5 h-3.5" />
                      <span>Depart</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'any', label: 'Any', icon: Clock },
                        { value: 'morning', label: 'Morning', icon: Sunrise, hint: '5a-12p' },
                        { value: 'afternoon', label: 'Afternoon', icon: Sun, hint: '12p-5p' },
                        { value: 'evening', label: 'Evening', icon: Sunset, hint: '5p-9p' },
                        { value: 'night', label: 'Night', icon: Moon, hint: '9p-5a' },
                      ].map((option) => {
                        const Icon = option.icon;
                        const isSelected = departureTimePreference === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setDepartureTimePreference(option.value as typeof departureTimePreference)}
                            title={option.hint}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 min-w-[90px]">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Arrive</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'any', label: 'Any', icon: Clock },
                        { value: 'morning', label: 'Morning', icon: Sunrise, hint: '5a-12p' },
                        { value: 'afternoon', label: 'Afternoon', icon: Sun, hint: '12p-5p' },
                        { value: 'evening', label: 'Evening', icon: Sunset, hint: '5p-9p' },
                        { value: 'night', label: 'Night', icon: Moon, hint: '9p-5a' },
                      ].map((option) => {
                        const Icon = option.icon;
                        const isSelected = arrivalTimePreference === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setArrivalTimePreference(option.value as typeof arrivalTimePreference)}
                            title={option.hint}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Duration Slider - Shown when flexible dates is checked */}
                {isFlexible && (
                  <div className="pt-4 border-t border-slate-100 animate-in fade-in slide-in-from-top-2">
                     <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Approximate Duration (Days)</label>
                     <div className="flex items-center gap-4">
                        <input
                          type="range"
                          min="3"
                          max="30"
                          value={flexibleDuration}
                          onChange={(e) => setFlexibleDuration(Number(e.target.value))}
                          className="flex-1 h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                        />
                        <div className="w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-center font-semibold text-slate-900">
                          {flexibleDuration}
                        </div>
                     </div>
                     <p className="text-xs text-slate-500 mt-2">We&apos;ll find the best dates for a {flexibleDuration}-day trip.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Start and End Destinations - z-40 so autocomplete appears above Destinations (z-10) but below nav (z-50) when scrolling */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm mb-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Departure & Arrival</h2>
                  <p className="text-sm text-slate-500">Choose your starting and ending airports</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Start Destination */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Start Airport
                  </label>
                  <AirportAutocomplete
                    value={startDestination}
                    onValueChange={setStartDestination}
                    placeholder="Search airports (e.g., JFK, LAX, or airport name)..."
                    onSelect={(airportCode) => {
                      setStartDestination(airportCode);
                    }}
                  />
                </div>
                
                {/* End Destination */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    End Airport
                    {isRoundTrip && (
                      <span className="text-xs text-blue-600 ml-2">(same as start)</span>
                    )}
                  </label>
                  {isRoundTrip ? (
                    // Show read-only display when round trip is enabled
                    <div className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-700 cursor-not-allowed">
                      {startDestination || 'Set start airport first'}
                    </div>
                  ) : (
                    <AirportAutocomplete
                      value={endDestination}
                      onValueChange={setEndDestination}
                      placeholder="Search airports (e.g., CDG, LHR, or airport name)..."
                      disabled={false}
                      onSelect={(airportCode) => {
                        setEndDestination(airportCode);
                      }}
                    />
                  )}
                </div>

                <div className="flex items-center justify-start pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none group inline-flex">
                    <input
                      type="checkbox"
                      checked={isRoundTrip}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsRoundTrip(checked);
                        if (checked) {
                          // Sync end destination with start destination
                          setEndDestination(startDestination);
                        }
                        // When unchecking, keep the current end destination (which is the same as start)
                        // User can then change it if they want
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Return to starting airport (round trip)</span>
                  </label>
                </div>
                <p className="col-span-2 text-xs text-slate-500">
                  Small and regional airports (e.g. ITH, BGM) are supported. We include connecting flights and different airlines when needed.
                </p>
              </div>
            </div>

            {/* Cities - relative z-10 so autocomplete dropdown appears above section below */}
            <div className="relative z-10 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Destinations</h2>
                  <p className="text-sm text-slate-500">Which cities would you like to visit?</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <DestinationAutocomplete
                    value={newCity}
                    onChange={setNewCity}
                    autoFocus
                    onSelect={(city) => {
                      if (city && !cities.includes(city)) {
                        setCities(prevCities => {
                          const newCities = [city].filter(c => !prevCities.includes(c));
                          return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
                        });
                        setNewCity('');
                      }
                    }}
                    placeholder="Search and select a city..."
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <div
                      key={city}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl group hover:bg-blue-100 transition-colors border border-blue-200"
                    >
                      <MapPin className="w-4 h-4 text-blue-600" />
                      <span className="text-slate-900">{city}</span>
                      <button
                        onClick={() => removeCity(city)}
                        className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4 text-slate-600" />
                      </button>
                    </div>
                  ))}
                </div>

                {cities.length < 1 && (
                  <p className="text-sm text-slate-500">Add at least 1 city to generate routes</p>
                )}
              </div>
            </div>

          </div>

          {/* Right Column - Summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 space-y-6 self-start">
              {/* Live Summary */}
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-8 shadow-xl shadow-blue-600/20">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-5 h-5" />
                  <h3 className="text-xl">Trip Summary</h3>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="text-sm text-blue-100 mb-1">Estimated Cost</div>
                    <div className="text-3xl">${estimatedCost.toLocaleString()}</div>
                  </div>

                  <div>
                    <div className="text-sm text-blue-100 mb-1">Points Needed</div>
                    <div className="text-3xl">{estimatedPoints.toLocaleString()}</div>
                  </div>

                  <div className="pt-6 border-t border-blue-500/30">
                    <div className="text-sm text-blue-100 mb-2">Your Configuration</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-100">Duration</span>
                        <span>{durationDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Cities</span>
                        <span>{cities.length}</span>
                      </div>
                            <div className="flex justify-between">
                              <span className="text-blue-100">Budget</span>
                              <span>
                                {maxBudget !== '' 
                                  ? `Up to $${typeof maxBudget === 'number' ? maxBudget.toLocaleString() : maxBudget}`
                                  : 'Not set'
                                }
                              </span>
                            </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Points to use</span>
                        <span>{totalPointsToUse.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Optimization Mode Selector */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Optimize for</div>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {[
                    { value: 'oop', label: 'Min Cash', icon: DollarSign, desc: 'Lowest out-of-pocket' },
                    { value: 'cpp', label: 'Max Value', icon: TrendingUp, desc: 'Best points value' },
                    { value: 'balanced', label: 'Balanced', icon: Scale, desc: 'Best overall' },
                  ].map((mode) => {
                    const Icon = mode.icon;
                    const isSelected = optimizationMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        onClick={() => setOptimizationMode(mode.value as 'oop' | 'cpp' | 'balanced')}
                        className={`flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{mode.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-2 text-center">
                  {optimizationMode === 'oop' && 'Minimize your cash spending'}
                  {optimizationMode === 'cpp' && 'Get the best cents-per-point value'}
                  {optimizationMode === 'balanced' && 'Balance cost, time & convenience'}
                </p>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!startDestination || !endDestination || cities.length < 1 || (!isFlexible && (!startDate || (!isOneWay && !endDate))) || isGenerating}
                className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base shadow-lg shadow-yellow-400/20 font-semibold"
              >
                <Zap className="w-5 h-5" />
                <span>{isGenerating ? 'Generating...' : 'Generate Itineraries'}</span>
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
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
