'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, DollarSign, Zap, MapPin, CreditCard, Sparkles } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, users as usersAPI } from '@/lib/api';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import DateRangePicker from '@/components/date-range-picker';

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
}

export default function TestSoloSetup() {
  const router = useRouter();
  
  // Budget State
  const [maxBudget, setMaxBudget] = useState<number | ''>('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([]);

  // Date State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isOneWay, setIsOneWay] = useState(false);

  // Location State
  const [startDestination, setStartDestination] = useState('');
  const [endDestination, setEndDestination] = useState('');
  const [destination, setDestination] = useState('');

  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationDays, setDurationDays] = useState(0);

  // Calculate total points
  const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  // Load user profile on mount
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        setIsLoadingProfile(true);
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
      } finally {
        setIsLoadingProfile(false);
      }
    };

    loadUserProfile();
  }, []);

  // Calculate Duration
  useEffect(() => {
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      setDurationDays(diffDays > 0 ? diffDays : 0);
    } else {
      setDurationDays(0);
    }
  }, [startDate, endDate]);

  const handleGenerate = async () => {
    // Validate required fields
    if (!startDestination) {
      setError('Please select a departure city');
      return;
    }
    if (!endDestination) {
      setError('Please select an arrival city');
      return;
    }
    if (!destination) {
      setError('Please select a destination');
      return;
    }
    if (!startDate) {
      setError('Please select a start date');
      return;
    }
    if (!isOneWay && !endDate) {
      setError('Please select an end date');
      return;
    }
    if (maxBudget === '') {
      setError('Please enter a budget');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 1. Create trip
      const tripTitle = `Test Solo Trip to ${destination}`;
      const trip = await createTrip({
        title: tripTitle,
        start_date: startDate,
        end_date: isOneWay ? '' : endDate,
        include_hotels: true,
        max_budget: typeof maxBudget === 'number' ? maxBudget : undefined,
      });

      console.log('Trip created:', trip);

      // 2. Add start destination (departure airport)
      if (startDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: startDestination,
          must_include: true,
          excluded: false,
        });
        console.log('Start destination added:', startDestination);
      }

      // 3. Add end destination (arrival airport)
      if (endDestination) {
        await addDestination({
          trip_id: trip.tripId,
          name: endDestination,
          must_include: true,
          excluded: false,
        });
        console.log('End destination added:', endDestination);
      }

      // 4. Add destination city
      if (destination) {
        await addDestination({
          trip_id: trip.tripId,
          name: destination,
          must_include: false,
          excluded: false,
        });
        console.log('Destination added:', destination);
      }

      // 5. Add credit card points
      for (const card of creditCards) {
        await upsertPoints({
          trip_id: trip.tripId,
          program: card.program,
          balance: card.points,
        });
        console.log('Points added:', card.program, card.points);
      }

      console.log('All data saved. Navigating to results...');

      // 6. Navigate to results
      router.push(`/solo/results?trip_id=${trip.tripId}`);
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
          <h1 className="text-5xl mb-3 tracking-tight text-slate-900 font-bold">Test Solo Trip Setup</h1>
          <p className="text-lg text-slate-600">Simplified interface for testing backend optimizer</p>
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
                <h2 className="text-2xl text-slate-900 font-semibold">Budget</h2>
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

                {/* Credit Card List */}
                {creditCards.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm text-slate-600 font-medium">Your Cards</h3>
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-blue-600" />
                        <span className="text-slate-900 font-medium">{totalPoints.toLocaleString()} points</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {creditCards.map(card => (
                        <div
                          key={card.id}
                          className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard className="w-4 h-4 text-blue-600" />
                            <div>
                              <div className="text-sm text-slate-900 font-medium">{card.program}</div>
                              <div className="text-xs text-slate-600">{card.points.toLocaleString()} points</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

              <div className="space-y-6">
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">
                    Start and End Date
                  </label>
                  <DateRangePicker
                    startDate={startDate}
                    endDate={endDate}
                    onStartDateChange={setStartDate}
                    onEndDateChange={setEndDate}
                    isOneWay={isOneWay}
                  />
                </div>

                <div className="flex items-center gap-2">
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
              </div>
            </div>

            {/* Departure & Arrival Airports */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Departure & Arrival</h2>
                  <p className="text-sm text-slate-500">Select your departure and arrival airports</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Start Airport */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Departure Airport
                  </label>
                  <AirportAutocomplete
                    value={startDestination}
                    onValueChange={setStartDestination}
                    placeholder="e.g., JFK, LAX"
                    onSelect={(airportCode) => {
                      setStartDestination(airportCode);
                    }}
                  />
                </div>
                
                {/* End Airport */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Arrival Airport
                  </label>
                  <AirportAutocomplete
                    value={endDestination}
                    onValueChange={setEndDestination}
                    placeholder="e.g., CDG, LHR"
                    onSelect={(airportCode) => {
                      setEndDestination(airportCode);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Destination City */}
            <div className="relative z-10 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl text-slate-900 font-semibold">Destination</h2>
                  <p className="text-sm text-slate-500">Where do you want to visit?</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Destination City
                  </label>
                  <DestinationAutocomplete
                    value={destination}
                    onChange={setDestination}
                    autoFocus
                    onSelect={(city) => {
                      if (city) {
                        setDestination(city);
                      }
                    }}
                    placeholder="Search and select a city..."
                  />
                </div>

                {destination && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl border border-blue-200">
                    <MapPin className="w-4 h-4 text-blue-600" />
                    <span className="text-slate-900">{destination}</span>
                  </div>
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
                  <h3 className="text-xl">Test Trip Summary</h3>
                </div>

                <div className="space-y-6">
                  <div className="pt-6 border-t border-blue-500/30">
                    <div className="text-sm text-blue-100 mb-2">Configuration</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-100">Duration</span>
                        <span>{durationDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Budget</span>
                        <span>
                          {maxBudget !== '' 
                            ? `$${typeof maxBudget === 'number' ? maxBudget.toLocaleString() : maxBudget}`
                            : 'Not set'
                          }
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Points</span>
                        <span>{totalPoints.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Departure</span>
                        <span>{startDestination || 'Not set'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Arrival</span>
                        <span>{endDestination || 'Not set'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-100">Destination</span>
                        <span>{destination || 'Not set'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!startDestination || !endDestination || !destination || !startDate || (!isOneWay && !endDate) || maxBudget === '' || isGenerating}
                className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg shadow-lg shadow-yellow-400/20 font-semibold"
              >
                <Zap className="w-5 h-5" />
                <span>{isGenerating ? 'Generating...' : 'Test Optimizer'}</span>
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <p className="text-sm text-slate-500 text-center">
                This will test the backend optimizer with your inputs
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
