'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Edit3, Check, Sparkles, TrendingUp } from 'lucide-react';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCost: number;
    pointsCost: number;
    score: number;
}

export default function SoloResults() {
    const router = useRouter();

    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [comparing, setComparing] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);

    // Generate itineraries
    useEffect(() => {
        setTimeout(() => {
            const generated: Itinerary[] = [
                {
                    id: 1,
                    name: 'Balanced Route',
                    cities: [
                        { name: 'Paris', days: 4 },
                        { name: 'Barcelona', days: 4 },
                        { name: 'Rome', days: 3 },
                        { name: 'Amsterdam', days: 3 },
                    ],
                    totalCost: 4200,
                    pointsCost: 105000,
                    score: 94,
                },
                {
                    id: 2,
                    name: 'Fast-Paced Explorer',
                    cities: [
                        { name: 'Paris', days: 3 },
                        { name: 'Barcelona', days: 2 },
                        { name: 'Rome', days: 3 },
                        { name: 'Amsterdam', days: 2 },
                        { name: 'Berlin', days: 2 },
                        { name: 'Prague', days: 2 },
                    ],
                    totalCost: 3900,
                    pointsCost: 97500,
                    score: 89,
                },
                {
                    id: 3,
                    name: 'Deep Dive',
                    cities: [
                        { name: 'Paris', days: 7 },
                        { name: 'Barcelona', days: 7 },
                    ],
                    totalCost: 3600,
                    pointsCost: 90000,
                    score: 92,
                },
            ];
            setItineraries(generated);
            setSelectedId(1);
            setLoading(false);
        }, 2000);
    }, []);

    const selectedItinerary = itineraries.find(i => i.id === selectedId);

    const updateCityDays = (itineraryId: number, cityIndex: number, days: number) => {
        setItineraries(prev => prev.map(itinerary => {
            if (itinerary.id === itineraryId) {
                const newCities = [...itinerary.cities];
                newCities[cityIndex] = { ...newCities[cityIndex], days };

                // Recalculate costs
                const totalDays = newCities.reduce((sum, c) => sum + c.days, 0);
                const newCost = Math.floor(totalDays * 200 + newCities.length * 300);

                return {
                    ...itinerary,
                    cities: newCities,
                    totalCost: newCost,
                    pointsCost: Math.floor(newCost * 25),
                };
            }
            return itinerary;
        }));
    };

    const toggleCompare = (id: number) => {
        setComparing(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    if (loading) {
        return (
            <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse shadow-xl shadow-blue-600/20">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl mb-2 text-slate-900 font-semibold">Generating your routes</h2>
                    <p className="text-slate-600">Analyzing points, checking availability, optimizing costs...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl mb-2 tracking-tight text-slate-900 font-bold">Your Routes</h1>
                        <p className="text-slate-600">We generated {itineraries.length} optimized itineraries for you</p>
                    </div>

                    {comparing.length > 0 && (
                        <button
                            onClick={() => router.push('/solo/comparison')}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            Compare {comparing.length} Routes
                        </button>
                    )}
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Itinerary Cards */}
                    <div className="lg:col-span-2 space-y-6">
                        {itineraries.map((itinerary) => (
                            <div
                                key={itinerary.id}
                                className={`bg-white border-2 rounded-2xl overflow-hidden transition-all shadow-sm ${selectedId === itinerary.id
                                    ? 'border-blue-600 shadow-lg shadow-blue-600/10'
                                    : 'border-slate-200 hover:border-blue-300'
                                    }`}
                            >
                                <div className="p-6">
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-6">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-2xl text-slate-900 font-semibold">{itinerary.name}</h3>
                                                {itinerary.score >= 90 && (
                                                    <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                                                        <Sparkles className="w-3 h-3 inline mr-1" />
                                                        Best match
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-slate-600">
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-4 h-4" />
                                                    {itinerary.cities.length} cities
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-4 h-4" />
                                                    {itinerary.cities.reduce((sum, c) => sum + c.days, 0)} days
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <TrendingUp className="w-4 h-4" />
                                                    {itinerary.score}/100
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setEditingId(editingId === itinerary.id ? null : itinerary.id)}
                                                className="p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                            >
                                                {editingId === itinerary.id ? (
                                                    <Check className="w-5 h-5 text-green-600" />
                                                ) : (
                                                    <Edit3 className="w-5 h-5 text-slate-600" />
                                                )}
                                            </button>

                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={comparing.includes(itinerary.id)}
                                                    onChange={() => toggleCompare(itinerary.id)}
                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Cities */}
                                    <div className="space-y-3 mb-6">
                                        {itinerary.cities.map((city, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100"
                                            >
                                                <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 font-semibold">
                                                    {index + 1}
                                                </div>

                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <MapPin className="w-4 h-4 text-blue-600" />
                                                        <span className="font-medium text-slate-900">{city.name}</span>
                                                    </div>

                                                    {editingId === itinerary.id && (
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="range"
                                                                min="1"
                                                                max="10"
                                                                value={city.days}
                                                                onChange={(e) => updateCityDays(itinerary.id, index, Number(e.target.value))}
                                                                className="flex-1 h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                                                            />
                                                            <span className="text-sm text-slate-600 w-16 font-medium">{city.days} days</span>
                                                        </div>
                                                    )}

                                                    {editingId !== itinerary.id && (
                                                        <div className="text-sm text-slate-600">{city.days} days</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Stats */}
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-sm">Cost</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">${itinerary.totalCost.toLocaleString()}</div>
                                        </div>

                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <Zap className="w-4 h-4" />
                                                <span className="text-sm">Points</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                        </div>

                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <TrendingUp className="w-4 h-4" />
                                                <span className="text-sm">Score</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">{itinerary.score}</div>
                                        </div>
                                    </div>

                                    {/* Select Button */}
                                    <button
                                        onClick={() => setSelectedId(itinerary.id)}
                                        className={`w-full mt-4 px-6 py-3 rounded-xl transition-all font-medium ${selectedId === itinerary.id
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                                            }`}
                                    >
                                        {selectedId === itinerary.id ? 'Selected' : 'Select This Route'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Right Sidebar - Selected Details */}
                    {selectedItinerary && (
                        <div className="lg:col-span-1">
                            <div className="sticky top-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                <h3 className="text-xl mb-6 text-slate-900 font-semibold">Selected Route</h3>

                                <div className="space-y-6">
                                    <div>
                                        <div className="text-sm text-slate-600 mb-3 font-medium">Route Visualization</div>
                                        <div className="h-40 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100">
                                            <div className="text-center text-blue-400">
                                                <MapPin className="w-8 h-8 mx-auto mb-2" />
                                                <p className="text-sm">Map visualization</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-sm text-slate-600 mb-3 font-medium">Cost Breakdown</div>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-slate-600">Flights</span>
                                                <span className="text-slate-900 font-medium">${Math.floor(selectedItinerary.totalCost * 0.4).toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-600">Hotels</span>
                                                <span className="text-slate-900 font-medium">${Math.floor(selectedItinerary.totalCost * 0.35).toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-600">Activities</span>
                                                <span className="text-slate-900 font-medium">${Math.floor(selectedItinerary.totalCost * 0.25).toLocaleString()}</span>
                                            </div>
                                            <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold">
                                                <span className="text-slate-900">Total</span>
                                                <span className="text-slate-900">${selectedItinerary.totalCost.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <button className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold">
                                        Book This Trip
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
