'use client';

/**
 * Demo page for Dynamic Route Optimization.
 * 
 * Tests the multi-city route optimizer which finds the optimal
 * order of intermediate destinations to minimize out-of-pocket costs.
 */

import { useState, useEffect } from 'react';
import { 
  MapPin, 
  Zap, 
  Calendar,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useDynamicRoute } from '@/lib/hooks/useDynamicRoute';
import { DynamicRouteResults } from '@/components/DynamicRouteResults';
import { users as usersAPI } from '@/lib/api';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface PointsEntry {
  program: string;
  balance: number;
}

export default function DynamicRouteDemo() {
  // Form state
  const [startCity, setStartCity] = useState('FLL');
  const [endCity, setEndCity] = useState('MCO');
  const [intermediateCities, setIntermediateCities] = useState<string[]>(['HND', 'CDG']);
  const [newCity, setNewCity] = useState('');
  const [travelDate, setTravelDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 3);
    return date.toISOString().split('T')[0];
  });
  const [cabinClass, setCabinClass] = useState('economy');
  const [points, setPoints] = useState<PointsEntry[]>([
    { program: 'chase', balance: 200000 },
    { program: 'amex', balance: 100000 },
  ]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  
  // Use the dynamic route hook
  const {
    loading,
    error,
    result,
    optimize,
    reset,
    metrics,
  } = useDynamicRoute({
    startCity,
    endCity,
    intermediateCities,
    points: Object.fromEntries(points.map(p => [p.program, p.balance])),
    travelDate,
    cabinClass,
  });
  
  // Load user points on mount
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        setIsLoadingProfile(true);
        const profile = await usersAPI.getProfile();
        
        if (profile.credit_cards && profile.credit_cards.length > 0) {
          setPoints(profile.credit_cards.map(card => ({
            program: card.program.toLowerCase().replace(/\s+/g, '_'),
            balance: card.points,
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
  
  const handleAddCity = () => {
    const trimmed = newCity.trim().toUpperCase();
    if (trimmed.length >= 3 && !intermediateCities.includes(trimmed)) {
      setIntermediateCities([...intermediateCities, trimmed]);
      setNewCity('');
    }
  };
  
  const handleRemoveCity = (index: number) => {
    setIntermediateCities(intermediateCities.filter((_, i) => i !== index));
  };
  
  const handleUpdatePoints = (index: number, balance: number) => {
    const updated = [...points];
    updated[index].balance = balance;
    setPoints(updated);
  };
  
  const handleAddPoints = () => {
    setPoints([...points, { program: '', balance: 0 }]);
  };
  
  const handleRemovePoints = (index: number) => {
    setPoints(points.filter((_, i) => i !== index));
  };
  
  const handleUpdateProgram = (index: number, program: string) => {
    const updated = [...points];
    updated[index].program = program.toLowerCase().replace(/\s+/g, '_');
    setPoints(updated);
  };
  
  const totalPoints = points.reduce((sum, p) => sum + p.balance, 0);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Dynamic Route Optimizer
          </h1>
          <p className="text-slate-600">
            Find the optimal order of destinations to minimize out-of-pocket costs
          </p>
        </div>
        
        {/* Input Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Trip Configuration
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            {/* Fixed Cities */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Start City (Fixed)
              </label>
              <input
                type="text"
                value={startCity}
                onChange={(e) => setStartCity(e.target.value.toUpperCase())}
                placeholder="FLL"
                maxLength={4}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                End City (Fixed)
              </label>
              <input
                type="text"
                value={endCity}
                onChange={(e) => setEndCity(e.target.value.toUpperCase())}
                placeholder="MCO"
                maxLength={4}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
              />
            </div>
          </div>
          
          {/* Intermediate Cities */}
          <div className="mt-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Intermediate Cities (Order will be optimized)
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {intermediateCities.map((city, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
                >
                  {city}
                  <button
                    onClick={() => handleRemoveCity(index)}
                    className="ml-1 p-0.5 hover:bg-blue-200 rounded-full"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCity()}
                placeholder="Add city (e.g., NRT, LHR)"
                maxLength={4}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
              />
              <button
                onClick={handleAddCity}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
          
          {/* Date & Cabin */}
          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                Travel Date
              </label>
              <SingleDatePicker
                compact
                value={travelDate}
                onChange={setTravelDate}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Cabin Class
              </label>
              <select
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First Class</option>
              </select>
            </div>
          </div>
          
          {/* Points */}
          <div className="mt-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Zap className="w-4 h-4 inline mr-1" />
              Your Points ({totalPoints.toLocaleString()} total)
            </label>
            <div className="space-y-3">
              {points.map((entry, index) => (
                <div key={index} className="flex gap-2">
                  <select
                    value={entry.program}
                    onChange={(e) => handleUpdateProgram(index, e.target.value)}
                    className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select program</option>
                    <option value="chase">Chase Ultimate Rewards</option>
                    <option value="amex">Amex Membership Rewards</option>
                    <option value="citi">Citi ThankYou Points</option>
                    <option value="capital_one">Capital One Miles</option>
                    <option value="bilt">Bilt Rewards</option>
                  </select>
                  <input
                    type="number"
                    value={entry.balance || ''}
                    onChange={(e) => handleUpdatePoints(index, parseInt(e.target.value) || 0)}
                    placeholder="Points"
                    className="w-32 px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => handleRemovePoints(index)}
                    className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleAddPoints}
              className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add points program
            </button>
          </div>
          
          {/* Route Preview */}
          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <div className="text-sm text-slate-500 mb-2">Route to optimize:</div>
            <div className="flex flex-wrap items-center gap-2 text-lg font-medium text-slate-900">
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-lg">{startCity}</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              {intermediateCities.length > 0 ? (
                <>
                  <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg">
                    [{intermediateCities.join(', ')}]
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </>
              ) : (
                <span className="text-slate-400 italic">Add intermediate cities</span>
              )}
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg">{endCity}</span>
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {intermediateCities.length > 0 && (
                <>Evaluating {Math.min(120, factorial(intermediateCities.length))} route permutations</>
              )}
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={optimize}
              disabled={loading || intermediateCities.length === 0}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Optimize Route
                </>
              )}
            </button>
            
            {result && (
              <button
                onClick={reset}
                className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
              >
                Clear Results
              </button>
            )}
          </div>
        </div>
        
        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-8 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-800">Optimization Error</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}
        
        {/* Loading State */}
        {loading && (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center mb-8">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Optimizing Your Route...
            </h3>
            <p className="text-slate-600">
              Fetching flight data and calculating optimal ordering
            </p>
          </div>
        )}
        
        {/* Results */}
        {result && !loading && (
          <DynamicRouteResults
            result={result}
            onSelectRoute={(route) => {
              console.log('Selected route:', route);
              // Could navigate to booking or show more details
            }}
          />
        )}
      </div>
    </div>
  );
}

// Helper function to calculate factorial for permutation count
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
