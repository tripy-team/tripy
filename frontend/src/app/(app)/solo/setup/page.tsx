'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Calendar, DollarSign, Zap, MapPin, Sparkles, CreditCard, MessageCircle, Plane, Backpack, Armchair, Coffee, Wine, Crown, BedDouble, Star } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, generateItinerary, users as usersAPI } from '@/lib/api';
import TripChatbotInline from '@/components/trip-chatbot-inline';
import { ExtractedTripInfo } from '@/lib/trip-extractor';
import CityAutocomplete from '@/components/city-autocomplete';
import { searchAndFormatCity, searchAndFormatCities } from '@/lib/city-formatter';
import DateRangePicker from '@/components/date-range-picker';

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
}

export default function SoloTripSetup() {
  const router = useRouter();
  
  // Budget State
  const [minBudget, setMinBudget] = useState<number | ''>('');
  const [maxBudget, setMaxBudget] = useState<number | ''>('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([]);

  // Date & Duration State
  const [isFlexible, setIsFlexible] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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

  // Estimates
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [durationDays, setDurationDays] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total points from all cards
  const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);

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
        
        if (profile.min_budget !== undefined && profile.min_budget !== null) {
          setMinBudget(profile.min_budget);
        }
        if (profile.max_budget !== undefined && profile.max_budget !== null) {
          setMaxBudget(profile.max_budget);
        }
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

  // Save budget and credit cards when they change
  useEffect(() => {
    if (!isLoadingProfile) {
      const saveProfile = async () => {
        try {
          await usersAPI.updateProfile({
            min_budget: minBudget === '' ? undefined : minBudget,
            max_budget: maxBudget === '' ? undefined : maxBudget,
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
  }, [minBudget, maxBudget, creditCards, isLoadingProfile]);

  // Sync end destination with start destination if round trip
  useEffect(() => {
    if (isRoundTrip && startDestination) {
      setEndDestination(startDestination);
    }
  }, [startDestination, isRoundTrip]);

  // Handle extracted trip info from chatbot
  const handleExtract = async (info: ExtractedTripInfo) => {
    // Extract and format start destination with airport code
    if (info.startDestination) {
      try {
        const formatted = await searchAndFormatCity(info.startDestination);
        setStartDestination(formatted);
      } catch (error) {
        console.error('Error formatting start destination:', error);
        setStartDestination(info.startDestination);
      }
    }

    // Extract and format end destination with airport code
    if (info.endDestination) {
      try {
        const formatted = await searchAndFormatCity(info.endDestination);
        setEndDestination(formatted);
      } catch (error) {
        console.error('Error formatting end destination:', error);
        setEndDestination(info.endDestination);
      }
    }

    // Extract cities (destinations) - search and format with airport codes
    if (info.cities && info.cities.length > 0) {
      try {
        const formattedCities = await searchAndFormatCities(info.cities);
        const newCities = formattedCities.filter(city => !cities.includes(city));
        if (newCities.length > 0) {
          setCities([...cities, ...newCities]);
        }
      } catch (error) {
        console.error('Error formatting cities:', error);
        // Fallback to unformatted cities
        const newCities = info.cities.filter(city => !cities.includes(city));
        if (newCities.length > 0) {
          setCities([...cities, ...newCities]);
        }
      }
    }

    // Extract dates - populate dates section
    if (info.startDate) {
      setStartDate(info.startDate);
    }
    if (info.endDate) {
      setEndDate(info.endDate);
    }
    if (info.duration && !info.startDate && !info.endDate) {
      setIsFlexible(true);
      setFlexibleDuration(info.duration);
    }
    if (info.isFlexible !== undefined) {
      setIsFlexible(info.isFlexible);
    }

    // Extract budget - populate budget section
    if (info.minBudget !== undefined) {
      setMinBudget(info.minBudget);
    }
    if (info.maxBudget !== undefined) {
      setMaxBudget(info.maxBudget);
    }

    // Extract credit cards - populate credit cards section
    if (info.creditCards && info.creditCards.length > 0) {
      const newCards = info.creditCards.map((card, index) => ({
        id: `extracted-${Date.now()}-${index}`,
        program: card.program,
        points: card.points,
      }));
      setCreditCards([...creditCards, ...newCards]);
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
    if (!isFlexible && (!startDate || !endDate)) {
      setError('Please select travel dates');
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
        end_date: isFlexible ? '' : endDate,
      });

      // 2. Add start destination if provided
      if (startDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: startDestination,
          must_include: true, // Start destination should be included
          excluded: false,
        });
      }

      // 3. Add end destination if provided
      if (endDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: endDestination,
          must_include: true, // End destination should be included
          excluded: false,
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

      // 5. Add credit card points
      for (const card of creditCards) {
        await upsertPoints({
          trip_id: trip.tripId,
          program: card.program,
          balance: card.points,
        });
      }

      // 6. Generate itinerary
      await generateItinerary(trip.tripId);

      // 7. Navigate to results page with trip_id
      router.push(`/solo/results?tripId=${trip.tripId}`);
    } catch (err) {
      console.error('Error generating itinerary:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl mb-3 tracking-tight text-slate-900 font-bold">Configure your trip</h1>
          <p className="text-lg text-slate-600">Set your preferences and we&apos;ll generate optimized itineraries</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Inputs */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Budget */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-2xl text-slate-900">Budget Range</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-slate-600 mb-3 font-medium">Total Budget Range</label>
                  <div className="flex items-center gap-4">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                      <input
                        type="number"
                        value={minBudget}
                        onChange={(e) => setMinBudget(e.target.value ? Number(e.target.value) : '')}
                        placeholder="Min"
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-medium text-slate-900"
                      />
                    </div>
                    <div className="text-slate-400">to</div>
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                      <input
                        type="number"
                        value={maxBudget}
                        onChange={(e) => setMaxBudget(e.target.value ? Number(e.target.value) : '')}
                        placeholder="Max"
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-medium text-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Credit Card List */}
                {creditCards.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm text-slate-600 font-medium">Your Cards</h3>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Zap className="w-4 h-4 text-blue-600" />
                        <span className="text-slate-900 font-medium">{totalPoints.toLocaleString()} total pts</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {creditCards.map(card => (
                        <div
                          key={card.id}
                          className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl group hover:bg-blue-100 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard className="w-4 h-4 text-blue-600" />
                            <div>
                              <div className="text-sm text-slate-900 font-medium">{card.program}</div>
                              <div className="text-xs text-slate-600">{card.points.toLocaleString()} points</div>
                            </div>
                          </div>
                          <button
                            onClick={() => removeCreditCard(card.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4 text-slate-600 hover:text-slate-900" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Travel Style */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Plane className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Travel Style</h2>
                  <p className="text-sm text-slate-500">Customize your comfort level</p>
                </div>
              </div>

              <div className="space-y-8">
                {/* Flight Class */}
                <div>
                  <label className="block text-sm text-slate-600 mb-4 font-medium uppercase tracking-wider">Flight Preference</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-6">
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
                          onClick={() => setFlightClass(option.value)}
                          className={`relative p-5 rounded-2xl border-2 transition-all text-left flex flex-col gap-3 group h-full ${
                            isSelected 
                              ? 'border-blue-600 bg-blue-50/50 shadow-sm' 
                              : 'border-slate-100 hover:border-blue-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600'
                          }`}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <div>
                            <div className={`font-semibold text-lg ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                              {option.label}
                            </div>
                            <div className="text-sm text-slate-500 mt-1">{option.desc}</div>
                          </div>
                          {isSelected && (
                            <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hotel Class */}
                <div>
                  <label className="block text-sm text-slate-600 mb-4 font-medium uppercase tracking-wider">Accommodation Level</label>
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
                          onClick={() => setHotelClass(option.value)}
                          className={`relative p-4 rounded-2xl border-2 transition-all text-left flex items-start gap-4 group ${
                            isSelected 
                              ? 'border-blue-600 bg-blue-50/50 shadow-sm' 
                              : 'border-slate-100 hover:border-blue-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600'
                          }`}>
                            {option.value === '5' ? <Crown className="w-6 h-6" /> : <BedDouble className="w-6 h-6" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-1 mb-1">
                              {Array.from({ length: option.stars }).map((_, i) => (
                                <Star key={i} className={`w-3 h-3 fill-current ${isSelected ? 'text-yellow-500' : 'text-yellow-400'}`} />
                              ))}
                            </div>
                            <div className={`font-semibold mb-0.5 ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                              {option.label}
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed">{option.desc}</div>
                          </div>
                        </button>
                      );
                    })}
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
                <h2 className="text-2xl text-slate-900">Dates</h2>
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
                  />
                </div>

                {/* Flexible Dates Checkbox */}
                <div className="flex items-center justify-start pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none group inline-flex">
                    <input
                      type="checkbox"
                      checked={isFlexible}
                      onChange={(e) => setIsFlexible(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Flexible dates</span>
                  </label>
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

            {/* Start and End Destinations */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm mb-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-2xl text-slate-900">Route</h2>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Start Destination */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Start Destination
                  </label>
                  <CityAutocomplete
                    value={startDestination}
                    onChange={setStartDestination}
                    onSelect={(city) => {
                      setStartDestination(city);
                    }}
                    placeholder="Select starting city..."
                  />
                </div>
                
                {/* End Destination */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    End Destination
                  </label>
                  <CityAutocomplete
                    value={endDestination}
                    onChange={setEndDestination}
                    onSelect={(city) => {
                      setEndDestination(city);
                    }}
                    placeholder="Select ending city..."
                    disabled={isRoundTrip}
                  />
                </div>

                <div className="flex items-center justify-start pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none group inline-flex">
                    <input
                      type="checkbox"
                      checked={isRoundTrip}
                      onChange={(e) => {
                        setIsRoundTrip(e.target.checked);
                        if (e.target.checked) {
                          setEndDestination(startDestination);
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Start and end at same location</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Cities */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-2xl text-slate-900">Destinations</h2>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <CityAutocomplete
                    value={newCity}
                    onChange={setNewCity}
                    onSelect={(city) => {
                      if (city && !cities.includes(city)) {
                        setCities([...cities, city]);
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

            {/* Trip Assistant */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900">Trip Assistant</h2>
                  <p className="text-sm text-slate-600">Tell me about your trip and I&apos;ll help fill out the form</p>
                </div>
              </div>

              <TripChatbotInline onExtract={handleExtract} />
            </div>
          </div>

          {/* Right Column - Summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 space-y-6">
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
                          {minBudget !== '' && maxBudget !== '' 
                            ? `$${typeof minBudget === 'number' ? minBudget.toLocaleString() : minBudget} - $${typeof maxBudget === 'number' ? maxBudget.toLocaleString() : maxBudget}`
                            : 'Not set'
                          }
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Total Points</span>
                        <span>{totalPoints.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!startDestination || !endDestination || cities.length < 1 || (!isFlexible && (!startDate || !endDate)) || isGenerating}
                className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg shadow-lg shadow-yellow-400/20 font-semibold"
              >
                <Zap className="w-5 h-5" />
                <span>{isGenerating ? 'Generating...' : 'Generate Itineraries'}</span>
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <p className="text-sm text-slate-500 text-center">
                We&apos;ll generate 3-5 optimized routes based on your preferences
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
