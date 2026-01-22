'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Users, Sparkles, TrendingUp } from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, ItineraryItem } from '@/lib/api';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    totalCostPerPerson: number;
    pointsCost: number;
    score: number;
}

export default function GroupResults() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('trip_id') || '';
    
    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [groupSize, setGroupSize] = useState(4);

    useEffect(() => {
        const fetchData = async () => {
            if (!tripId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                
                // Fetch group size from trip members
                const membersResponse = await tripsAPI.listMembers(tripId);
                setGroupSize(membersResponse.members.length || 4);
                
                // Fetch itineraries
                const response = await itinerariesAPI.get(tripId);
                
                // Transform API response to display format
                if (response.items && Array.isArray(response.items) && response.items.length > 0) {
                    const transformed: Itinerary[] = response.items.map((item: ItineraryItem, index: number) => {
                        const route = item.route || item.cities || [];
                        const cities = Array.isArray(route) 
                            ? route.map((city: string | { name: string; days: number }) => {
                                if (typeof city === 'string') {
                                    return { name: city, days: 3 };
                                }
                                return city;
                            })
                            : [];
                        
                        return {
                            id: index + 1,
                            name: item.name || `Itinerary ${index + 1}`,
                            cities: cities,
                            totalCostPerPerson: item.totalCostPerPerson || item.costPerPerson || (item.totalCost || 0) / groupSize,
                            pointsCost: item.pointsCost || item.points || 0,
                            score: item.score || 85,
                        };
                    });
                    
                    setItineraries(transformed);
                    if (transformed.length > 0) {
                        setSelectedId(transformed[0].id);
                    }
                } else {
                    setItineraries([]);
                }
            } catch (err) {
                console.error('Error fetching data:', err);
                setItineraries([]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tripId, groupSize]);

    const selectedItinerary = itineraries.find(i => i.id === selectedId);

    if (loading) {
        return (
            <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse shadow-xl shadow-blue-600/20">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl mb-2 text-slate-900 font-semibold">Generating group itineraries</h2>
                    <p className="text-slate-600">Combining budgets, optimizing points, finding best routes...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Group Trip · {groupSize} members</span>
                    </div>
                    <h1 className="text-4xl mb-2 tracking-tight text-slate-900 font-bold">Group Itineraries</h1>
                    <p className="text-slate-600">We generated {itineraries.length} optimized routes for your group</p>
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
                                    </div>

                                    {/* Cities */}
                                    <div className="space-y-3 mb-6">
                                        {itinerary.cities.map((city, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-4 p-4 bg-blue-50 border border-blue-100 rounded-xl"
                                            >
                                                <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 font-semibold">
                                                    {index + 1}
                                                </div>

                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <MapPin className="w-4 h-4 text-blue-600" />
                                                        <span className="font-semibold text-slate-900">{city.name}</span>
                                                    </div>
                                                    <div className="text-sm text-slate-600">{city.days} days</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Stats */}
                                    <div className="grid grid-cols-3 gap-4 mb-4">
                                        <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-sm">Per Person</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">${itinerary.totalCostPerPerson.toLocaleString()}</div>
                                        </div>

                                        <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <Users className="w-4 h-4" />
                                                <span className="text-sm">Total</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">${(itinerary.totalCostPerPerson * groupSize).toLocaleString()}</div>
                                        </div>

                                        <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                            <div className="flex items-center gap-2 text-slate-600 mb-1">
                                                <Zap className="w-4 h-4" />
                                                <span className="text-sm">Points</span>
                                            </div>
                                            <div className="text-xl text-slate-900 font-semibold">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                        </div>
                                    </div>

                                    {/* Select Button */}
                                    <button
                                        onClick={() => setSelectedId(itinerary.id)}
                                        className={`w-full px-6 py-3 rounded-xl transition-all font-medium ${selectedId === itinerary.id
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

                    {/* Right Sidebar */}
                    {selectedItinerary && (
                        <div className="lg:col-span-1">
                            <div className="sticky top-8 space-y-6">
                                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                    <h3 className="text-xl mb-6 text-slate-900 font-semibold">Individual Cost Breakdown</h3>

                                    <div className="space-y-4">
                                        {/* Mock members - TODO: Fetch from API */}
                                        {[
                                            { name: 'Sarah', points: 120000, initials: 'SC', color: 'bg-blue-600' },
                                            { name: 'Michael', points: 95000, initials: 'MR', color: 'bg-purple-600' },
                                            { name: 'Emma', points: 0, initials: 'ET', color: 'bg-green-600' },
                                            { name: 'David', points: 100000, initials: 'DK', color: 'bg-orange-600' },
                                        ].map((member, idx) => {
                                            const baseCost = selectedItinerary.totalCostPerPerson;
                                            const savings = Math.min(baseCost, member.points * 0.012);
                                            const finalCost = baseCost - savings;

                                            return (
                                                <div key={idx} className="flex items-center justify-between pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 ${member.color} rounded-full flex items-center justify-center text-white text-xs font-bold`}>
                                                            {member.initials}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-medium text-slate-900">{member.name}</div>
                                                            {savings > 0 ? (
                                                                <div className="text-xs text-green-600 flex items-center gap-1">
                                                                    <Zap className="w-3 h-3" />
                                                                    Save ${Math.round(savings).toLocaleString()}
                                                                </div>
                                                            ) : (
                                                                <div className="text-xs text-slate-500">No points applied</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-bold text-slate-900">${Math.round(finalCost).toLocaleString()}</div>
                                                        {savings > 0 && (
                                                            <div className="text-xs text-slate-400 line-through">${baseCost.toLocaleString()}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div className="pt-4 border-t border-slate-200 mt-2">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-sm text-slate-600">Total Group Cash</span>
                                                <span className="text-xl text-slate-900 font-bold">
                                                    ${[
                                                        { points: 120000 },
                                                        { points: 95000 },
                                                        { points: 0 },
                                                        { points: 100000 },
                                                    ].reduce((acc, member) => {
                                                        const savings = Math.min(selectedItinerary.totalCostPerPerson, member.points * 0.012);
                                                        return acc + (selectedItinerary.totalCostPerPerson - savings);
                                                    }, 0).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-green-600">
                                                <span>Total Savings</span>
                                                <span>
                                                    -${[
                                                        { points: 120000 },
                                                        { points: 95000 },
                                                        { points: 0 },
                                                        { points: 100000 },
                                                    ].reduce((acc, member) => {
                                                        return acc + Math.min(selectedItinerary.totalCostPerPerson, member.points * 0.012);
                                                    }, 0).toLocaleString()}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 shadow-xl shadow-blue-600/20">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Zap className="w-5 h-5" />
                                        <h3 className="text-lg font-semibold">Ready to Book?</h3>
                                    </div>
                                    <p className="text-sm text-blue-100 mb-6">
                                        Proceed with this itinerary and see how to maximize your group&apos;s points.
                                    </p>
                                    <button
                                        onClick={() => router.push(`/group/points-strategy?trip_id=${tripId}`)}
                                        className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold"
                                    >
                                        Select & Optimize
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
