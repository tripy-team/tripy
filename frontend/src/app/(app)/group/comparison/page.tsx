'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Users, Zap, TrendingUp, ArrowLeft, Check } from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, destinations, ItineraryItem } from '@/lib/api';
import { formatAirportDisplay, getCityMapForCodes, isLikelyAirportCode } from '@/lib/airport-formatter';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCostPerPerson: number;
    pointsCost: number;
    score: number;
    withinBudget?: boolean;
    withinPoints?: boolean;
}

export default function GroupComparison() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('trip_id') || '';

    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [groupSize, setGroupSize] = useState(4);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!tripId) {
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                const [itineraryResponse, membersResponse, destinationsResponse] = await Promise.all([
                    itinerariesAPI.get(tripId),
                    tripsAPI.listMembers(tripId),
                    destinations.list(tripId),
                ]);

                const memberCount = membersResponse.members.length || 4;
                setGroupSize(memberCount);

                const destinationMap = new Map<string, string>();
                destinationsResponse.destinations.forEach((dest) => {
                    destinationMap.set(dest.destinationId, dest.name);
                });

                const regularItems = (itineraryResponse.items || []).filter(
                    (i: ItineraryItem & { type?: string }) => {
                        if (['ai_route_suggestions', 'itinerary_smart_tips', 'itinerary_relaxed_info', 'out_of_pocket', 'out_of_pocket_hotels', 'path', 'payments', 'totals'].includes(i.type || '')) return false;
                        const route = i.route || i.cities;
                        return Array.isArray(route) && route.length > 0;
                    }
                );

                const iataCodes: string[] = [];
                for (const i of regularItems) {
                    const r = (i.route || i.cities) as Array<string | { name?: string }> | undefined;
                    if (Array.isArray(r)) {
                        for (const c of r) {
                            const n = typeof c === 'string' ? c : (c as { name?: string })?.name;
                            if (n && isLikelyAirportCode(n)) iataCodes.push(n.trim().toUpperCase());
                        }
                    }
                }
                const codeToCity = await getCityMapForCodes(iataCodes);

                if (regularItems.length > 0) {
                    let transformed: Itinerary[] = regularItems.map((item: ItineraryItem, index: number) => {
                        const route = item.route || item.cities || [];
                        const cities = Array.isArray(route)
                            ? route.map((city: string | { name: string; days: number }) => {
                                let rawName: string;
                                let days: number;
                                if (typeof city === 'string') {
                                    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city);
                                    rawName = isUUID && destinationMap.has(city)
                                        ? destinationMap.get(city)!
                                        : (isUUID ? city : city);
                                    days = 3;
                                } else if (city.name && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city.name)) {
                                    rawName = destinationMap.get(city.name) || city.name;
                                    days = city.days || 3;
                                } else {
                                    rawName = city.name || '';
                                    days = city.days || 3;
                                }
                                const name = formatAirportDisplay(rawName, codeToCity[rawName.trim().toUpperCase()]);
                                return { name, days };
                            })
                            : [];
                        return {
                            id: index + 1,
                            name: (item.name as string) || `Itinerary ${index + 1}`,
                            cities,
                            totalCostPerPerson: (item.totalCostPerPerson as number) || (item.costPerPerson as number) || ((item.totalCost as number) || 0) / memberCount,
                            pointsCost: (item.pointsCost as number) || (item.points as number) || 0,
                            score: (item.score as number) || 85,
                            withinBudget: (item.withinBudget as boolean) !== false,
                            withinPoints: (item.withinPoints as boolean) !== false,
                        };
                    });
                    transformed = transformed.sort((a, b) => {
                        const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
                        const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
                        return sb - sa;
                    });
                    setItineraries(transformed);
                    setSelectedIds(transformed.length >= 2 ? [transformed[0].id, transformed[1].id] : transformed.length === 1 ? [transformed[0].id] : []);
                } else {
                    setItineraries([]);
                }
            } catch (err) {
                console.error('Error fetching comparison data:', err);
                setItineraries([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [tripId]);

    const toggleSelection = (id: number) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) {
                return prev.length > 1 ? prev.filter(i => i !== id) : prev;
            }
            return [...prev, id];
        });
    };

    const selectedItineraries = itineraries.filter(i => selectedIds.includes(i.id));

    if (isLoading) {
        return (
            <div className="min-h-full p-8 bg-neutral-50">
                <div className="max-w-7xl mx-auto flex items-center justify-center min-h-[400px]">
                    <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-4 text-neutral-600">Loading itineraries...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (itineraries.length === 0) {
        return (
            <div className="min-h-full p-8 bg-neutral-50">
                <div className="max-w-7xl mx-auto">
                    <button onClick={() => router.back()} className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back</span>
                    </button>
                    <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center">
                        <p className="text-neutral-600 mb-4">No itineraries to compare. Select 2 or more on the results page, then choose Compare.</p>
                        <button onClick={() => router.push(`/group/results${tripId ? `?trip_id=${tripId}` : ''}`)} className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800">Go to Results</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push(`/group/results${tripId ? `?trip_id=${tripId}` : ''}`)}
                        className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Results</span>
                    </button>

                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-neutral-200 rounded-full text-sm text-neutral-600 mb-4">
                        <Users className="w-4 h-4" />
                        <span>Group · {groupSize} members</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight">Compare Routes</h1>
                    <p className="text-neutral-600">Side-by-side comparison of your itineraries · within budget &amp; points</p>
                </div>

                {/* Selection Controls */}
                <div className="flex items-center gap-3 mb-6">
                    <span className="text-sm text-neutral-600">Compare:</span>
                    {itineraries.map((itinerary) => (
                        <button
                            key={itinerary.id}
                            onClick={() => toggleSelection(itinerary.id)}
                            className={`px-4 py-2 rounded-xl transition-all text-sm ${selectedIds.includes(itinerary.id)
                                ? 'bg-neutral-900 text-white'
                                : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                }`}
                        >
                            {itinerary.name}
                        </button>
                    ))}
                </div>

                {/* Comparison Table */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
                    <div className="grid" style={{ gridTemplateColumns: `200px repeat(${Math.max(selectedItineraries.length, 1)}, 1fr)` }}>
                        {/* Header Row */}
                        <div className="bg-neutral-50 border-b border-neutral-200 p-6"></div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="bg-neutral-50 border-b border-l border-neutral-200 p-6">
                                <h3 className="text-lg mb-2">{itinerary.name}</h3>
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
                        {selectedItineraries.map((itinerary) => (
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

                        {/* Cost Per Person */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <DollarSign className="w-4 h-4 text-neutral-600" />
                                <span>Cost Per Person</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">${itinerary.totalCostPerPerson.toLocaleString()}</div>
                            </div>
                        ))}

                        {/* Total Group Cost */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Users className="w-4 h-4 text-neutral-600" />
                                <span>Total Group Cost</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">${(itinerary.totalCostPerPerson * groupSize).toLocaleString()}</div>
                                <div className="text-sm text-neutral-600 mt-1">for {groupSize} people</div>
                            </div>
                        ))}

                        {/* Points */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Zap className="w-4 h-4 text-neutral-600" />
                                <span>Points Required</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                <div className="text-sm text-neutral-600 mt-1">{itinerary.pointsCost.toLocaleString()} pts</div>
                            </div>
                        ))}

                        {/* Within constraints */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Check className="w-4 h-4 text-neutral-600" />
                                <span>Within constraints</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                {itinerary.withinBudget !== false && itinerary.withinPoints !== false ? (
                                    <span className="text-emerald-600 font-medium">Yes</span>
                                ) : (
                                    <span className="text-amber-600 text-sm">
                                        {itinerary.withinBudget === false && itinerary.withinPoints === false && 'Over budget, exceeds points'}
                                        {itinerary.withinBudget === false && itinerary.withinPoints !== false && 'Over budget'}
                                        {itinerary.withinBudget !== false && itinerary.withinPoints === false && 'Exceeds points'}
                                    </span>
                                )}
                            </div>
                        ))}

                        {/* Score */}
                        <div className="border-b border-neutral-200 p-6 bg-neutral-50">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <TrendingUp className="w-4 h-4 text-neutral-600" />
                                <span>AI Optimization Score</span>
                            </div>
                        </div>
                        {selectedItineraries.map((itinerary) => (
                            <div key={itinerary.id} className="border-b border-l border-neutral-200 p-6">
                                <div className="text-2xl">{itinerary.score}/100</div>
                                <div className="mt-2">
                                    <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-neutral-900 transition-all" style={{ width: `${itinerary.score}%` }}></div>
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
                        {selectedItineraries.map((itinerary) => {
                            const totalDays = itinerary.cities.reduce((sum, c) => sum + c.days, 0);
                            const costPerDay = totalDays > 0 ? Math.floor(itinerary.totalCostPerPerson / totalDays) : 0;
                            let bestFor = '';
                            if (itinerary.cities.length > 4) bestFor = 'Exploring many destinations';
                            else if (costPerDay < 250) bestFor = 'Budget-conscious travelers';
                            else if (itinerary.score >= 90) bestFor = 'Balanced experience';
                            else bestFor = 'Flexibility and variety';

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
                        onClick={() => router.push(`/group/results${tripId ? `?trip_id=${tripId}` : ''}`)}
                        className="px-6 py-3 bg-white border border-neutral-200 text-neutral-900 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                        Back to Results
                    </button>

                    <button
                        onClick={() => router.push(`/group/booking${tripId ? `?trip_id=${tripId}` : ''}`)}
                        className="px-6 py-3 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition-colors"
                    >
                        Select & Book
                    </button>
                </div>
            </div>
        </div>
    );
}
