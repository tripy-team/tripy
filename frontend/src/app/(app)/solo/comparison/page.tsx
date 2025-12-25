'use client';

import { useRouter } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, TrendingUp, ArrowLeft, Check } from 'lucide-react';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCost: number;
    pointsCost: number;
    score: number;
}

export default function SoloComparison() {
    const router = useRouter();

    // Default mock data for comparison
    const itineraries: Itinerary[] = [
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
    ];

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Results</span>
                    </button>

                    <h1 className="text-4xl mb-3 tracking-tight">Compare Routes</h1>
                    <p className="text-neutral-600">Side-by-side comparison of your selected itineraries</p>
                </div>

                {/* Comparison Table */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
                    <div className="grid" style={{ gridTemplateColumns: `200px repeat(${itineraries.length}, 1fr)` }}>
                        {/* Header Row */}
                        <div className="bg-neutral-50 border-b border-neutral-200 p-6"></div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="bg-neutral-50 border-b border-l border-neutral-200 p-6">
                                <h3 className="text-xl mb-2">{itinerary.name}</h3>
                                <div className="flex items-center gap-1.5 text-sm text-neutral-600">
                                    <TrendingUp className="w-4 h-4" />
                                    <span>Score: {itinerary.score}/100</span>
                                </div>
                            </div>
                        ))}

                        {/* Cities */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <MapPin className="w-4 h-4 text-neutral-600" />
                                <span>Cities & Duration</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="space-y-2">
                                    {itinerary.cities.map((city, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <span className="text-neutral-900">{city.name}</span>
                                            <span className="text-neutral-600">{city.days} days</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Number of Cities */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <MapPin className="w-4 h-4 text-neutral-600" />
                                <span>Number of Cities</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.cities.length}</div>
                            </div>
                        ))}

                        {/* Total Days */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Clock className="w-4 h-4 text-neutral-600" />
                                <span>Total Duration</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.cities.reduce((sum, c) => sum + c.days, 0)} days</div>
                            </div>
                        ))}

                        {/* Total Cost */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <DollarSign className="w-4 h-4 text-neutral-600" />
                                <span>Total Cost</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">${itinerary.totalCost.toLocaleString()}</div>
                            </div>
                        ))}

                        {/* Cost Per Day */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <DollarSign className="w-4 h-4 text-neutral-600" />
                                <span>Cost Per Day</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => {
                            const totalDays = itinerary.cities.reduce((sum, c) => sum + c.days, 0);
                            const costPerDay = Math.floor(itinerary.totalCost / totalDays);
                            return (
                                <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                    <div className="text-2xl">${costPerDay.toLocaleString()}</div>
                                </div>
                            );
                        })}

                        {/* Points */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Zap className="w-4 h-4 text-neutral-600" />
                                <span>Points Required</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                <div className="text-sm text-neutral-600 mt-1">{itinerary.pointsCost.toLocaleString()} pts</div>
                            </div>
                        ))}

                        {/* Score */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <TrendingUp className="w-4 h-4 text-neutral-600" />
                                <span>AI Optimization Score</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.score}/100</div>
                                <div className="mt-2">
                                    <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-neutral-900 transition-all"
                                            style={{ width: `${itinerary.score}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Best For */}
                        <div className="p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Check className="w-4 h-4 text-neutral-600" />
                                <span>Best For</span>
                            </div>
                        </div>
                        {itineraries.map((itinerary) => {
                            const totalDays = itinerary.cities.reduce((sum, c) => sum + c.days, 0);
                            const costPerDay = Math.floor(itinerary.totalCost / totalDays);

                            let bestFor = '';
                            if (itinerary.cities.length > 4) {
                                bestFor = 'Exploring many destinations';
                            } else if (costPerDay < 250) {
                                bestFor = 'Budget-conscious travelers';
                            } else if (itinerary.score >= 90) {
                                bestFor = 'Balanced experience';
                            } else {
                                bestFor = 'Flexibility and variety';
                            }

                            return (
                                <div key={itinerary.id} className="border-l border-neutral-200 p-6">
                                    <div className="text-sm text-neutral-900">{bestFor}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between mt-8">
                    <button
                        onClick={() => router.back()}
                        className="px-6 py-3 bg-white border border-neutral-200 text-neutral-900 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                        Back to All Routes
                    </button>

                    <button
                        onClick={() => {/* Navigate to booking */ }}
                        className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors"
                    >
                        Select & Book
                    </button>
                </div>
            </div>
        </div>
    );
}
