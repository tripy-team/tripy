'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, Calendar, DollarSign, Zap, MapPin, Sparkles, CreditCard, MessageCircle } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, generateItinerary } from '@/lib/api';
import TripChatbotInline from '@/components/trip-chatbot-inline';
import { ExtractedTripInfo } from '@/lib/trip-extractor';
import CityAutocomplete from '@/components/city-autocomplete';
import DateRangePicker from '@/components/date-range-picker';

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
}

export default function SoloTripSetup() {
  const router = useRouter();
  
  // Budget State
  const [minBudget, setMinBudget] = useState(1000);
  const [maxBudget, setMaxBudget] = useState(5000);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([
    { id: '1', program: 'Chase Sapphire Reserve', points: 150000 }
  ]);

  // Date & Duration State
  const [isFlexible, setIsFlexible] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [flexibleDuration, setFlexibleDuration] = useState(7); // Default days if flexible

  // Cities State
  const [cities, setCities] = useState<string[]>(['Paris', 'Barcelona']);
  const [newCity, setNewCity] = useState('');

  // Estimates
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [durationDays, setDurationDays] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total points from all cards
  const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);

  // Handle extracted trip info from chatbot
  const handleExtract = (info: ExtractedTripInfo) => {
    // Extract cities
    if (info.cities && info.cities.length > 0) {
      const newCities = info.cities.filter(city => !cities.includes(city));
      if (newCities.length > 0) {
        setCities([...cities, ...newCities]);
      }
    }

    // Extract dates
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

    // Extract budget
    if (info.minBudget) {
      setMinBudget(info.minBudget);
    }
    if (info.maxBudget) {
      setMaxBudget(info.maxBudget);
    }

    // Extract credit cards
    if (info.creditCards && info.creditCards.length > 0) {
      const newCards = info.creditCards.map((card, index) => ({
        id: `extracted-${Date.now()}-${index}`,
        program: card.program,
        points: card.points,
      }));
      setCreditCards([...creditCards, ...newCards]);
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

  const addCity = () => {
    if (newCity.trim() && !cities.includes(newCity.trim())) {
      setCities([...cities, newCity.trim()]);
      setNewCity('');
    }
  };

  const removeCity = (city: string) => {
    setCities(cities.filter(c => c !== city));
  };

  const removeCreditCard = (id: string) => {
    setCreditCards(creditCards.filter(card => card.id !== id));
  };

  const handleGenerate = async () => {
    if (cities.length < 2 || (!isFlexible && (!startDate || !endDate))) {
      setError('Please fill in all required fields (dates and at least 2 cities)');
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

      // 2. Add destinations
      for (const city of cities) {
        await addDestination({
          trip_id: trip.tripId,
          name: city,
          must_include: false,
          excluded: false,
        });
      }

      // 3. Add credit card points
      for (const card of creditCards) {
        await upsertPoints({
          trip_id: trip.tripId,
          program: card.program,
          balance: card.points,
        });
      }

      // 4. Generate itinerary
      await generateItinerary(trip.tripId);

      // 5. Navigate to results page with trip_id
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
                        onChange={(e) => setMinBudget(Number(e.target.value))}
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
                        onChange={(e) => setMaxBudget(Number(e.target.value))}
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

            {/* Duration & Dates */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-2xl text-slate-900">Duration &amp; Dates</h2>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-slate-600 font-medium">Travel Dates</label>
                  <button
                    onClick={() => setIsFlexible(!isFlexible)}
                    className={`text-sm px-3 py-1.5 rounded-lg transition-colors border ${
                      isFlexible 
                        ? 'bg-blue-600 text-white border-blue-600' 
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                    }`}
                  >
                    Flexible Dates
                  </button>
                </div>

                {!isFlexible ? (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Travel Dates</label>
                    <DateRangePicker
                      startDate={startDate}
                      endDate={endDate}
                      onStartDateChange={setStartDate}
                      onEndDateChange={setEndDate}
                    />
                  </div>
                ) : (
                  <div>
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
                    placeholder="Add a city..."
                  />
                  <button
                    onClick={addCity}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
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

                {cities.length < 2 && (
                  <p className="text-sm text-slate-500">Add at least 2 cities to generate routes</p>
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
                        <span>${minBudget.toLocaleString()} - ${maxBudget.toLocaleString()}</span>
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
                disabled={cities.length < 2 || (!isFlexible && (!startDate || !endDate)) || isGenerating}
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
