'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, Calendar, DollarSign, Zap, MapPin, Sparkles, CreditCard } from 'lucide-react';
import { createTrip, addDestination, upsertPoints, generateItinerary } from '@/lib/api';

interface CreditCardEntry {
    id: string;
    program: string;
    points: number;
}

export default function SoloTripSetup() {
    const router = useRouter();
    const [budget, setBudget] = useState(5000);
    const [creditCards, setCreditCards] = useState<CreditCardEntry[]>([
        { id: '1', program: 'Chase Sapphire Reserve', points: 150000 }
    ]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [cities, setCities] = useState<string[]>(['Paris', 'Barcelona']);
    const [newCity, setNewCity] = useState('');
    const [estimatedCost, setEstimatedCost] = useState(0);
    const [estimatedPoints, setEstimatedPoints] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Add card modal state
    const [showAddCard, setShowAddCard] = useState(false);
    const [newCardProgram, setNewCardProgram] = useState('');
    const [newCardPoints, setNewCardPoints] = useState('');

    // Calculate total points from all cards
    const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);

    // Real-time cost calculation
    useEffect(() => {
        // Calculate duration from dates
        let duration = 0;
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const diffTime = Math.abs(end.getTime() - start.getTime());
            duration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
        }
        
        const baseCostPerDay = 200;
        const baseCostPerCity = 300;
        const estimated = (duration * baseCostPerDay) + (cities.length * baseCostPerCity);
        setEstimatedCost(Math.min(estimated, budget));
        setEstimatedPoints(Math.floor(estimated * 25)); // Rough points calculation
    }, [budget, startDate, endDate, cities.length]);

    const addCity = () => {
        if (newCity.trim() && !cities.includes(newCity.trim())) {
            setCities([...cities, newCity.trim()]);
            setNewCity('');
        }
    };

    const removeCity = (city: string) => {
        setCities(cities.filter(c => c !== city));
    };

    const handleGenerate = async () => {
        if (cities.length < 2 || !startDate || !endDate) {
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
                start_date: startDate,
                end_date: endDate,
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

    const addCreditCard = () => {
        if (newCardProgram.trim() && newCardPoints.trim()) {
            const newCard: CreditCardEntry = {
                id: String(creditCards.length + 1),
                program: newCardProgram.trim(),
                points: Number(newCardPoints.trim())
            };
            setCreditCards([...creditCards, newCard]);
            setNewCardProgram('');
            setNewCardPoints('');
            setShowAddCard(false);
        }
    };

    const removeCreditCard = (id: string) => {
        setCreditCards(creditCards.filter(card => card.id !== id));
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
                                <h2 className="text-2xl text-slate-900">Budget</h2>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <div className="flex items-baseline gap-2 mb-4">
                                        <span className="text-4xl text-slate-900">${budget.toLocaleString()}</span>
                                        <span className="text-slate-500">total budget</span>
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
                                    <div className="flex justify-between text-sm text-slate-500 mt-2">
                                        <span>$1,000</span>
                                        <span>$20,000</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium">Credit Card Points</label>
                                    <button
                                        onClick={() => setShowAddCard(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                                    >
                                        <CreditCard className="w-5 h-5" />
                                        <span>Add Credit Card</span>
                                    </button>
                                </div>

                                {/* Add Credit Card Modal */}
                                {showAddCard && (
                                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full mx-4">
                                            <h2 className="text-2xl mb-6 text-slate-900 font-semibold">Add Credit Card</h2>
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm text-slate-600 mb-2 font-medium">Card/Program Name</label>
                                                    <input
                                                        type="text"
                                                        value={newCardProgram}
                                                        onChange={(e) => setNewCardProgram(e.target.value)}
                                                        placeholder="e.g., Chase Sapphire Reserve"
                                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm text-slate-600 mb-2 font-medium">Points Balance</label>
                                                    <input
                                                        type="number"
                                                        value={newCardPoints}
                                                        onChange={(e) => setNewCardPoints(e.target.value)}
                                                        placeholder="e.g., 150000"
                                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-3 mt-6">
                                                <button
                                                    onClick={() => setShowAddCard(false)}
                                                    className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={addCreditCard}
                                                    className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                                                >
                                                    Add Card
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

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
                                <h2 className="text-2xl text-slate-900">Dates</h2>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium">Start Date</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium">End Date</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        min={startDate || undefined}
                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                    />
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
                                    <input
                                        type="text"
                                        value={newCity}
                                        onChange={(e) => setNewCity(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && addCity()}
                                        placeholder="Add a city..."
                                        className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
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
                                            {startDate && endDate && (() => {
                                                const start = new Date(startDate);
                                                const end = new Date(endDate);
                                                const diffTime = Math.abs(end.getTime() - start.getTime());
                                                const duration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                                                return (
                                                    <div className="flex justify-between">
                                                        <span className="text-blue-100">Duration</span>
                                                        <span>{duration} days</span>
                                                    </div>
                                                );
                                            })()}
                                            <div className="flex justify-between">
                                                <span className="text-blue-100">Cities</span>
                                                <span>{cities.length}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-blue-100">Budget</span>
                                                <span>${budget.toLocaleString()}</span>
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
                                disabled={cities.length < 2 || !startDate || !endDate || isGenerating}
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
