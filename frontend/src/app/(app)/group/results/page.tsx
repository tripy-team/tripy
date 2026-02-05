'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Users, Sparkles, TrendingUp, Plane, Car, Bus, Train, Navigation, Calendar, Info, Edit3, Check } from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, points as pointsAPI, destinations, ItineraryItem } from '@/lib/api';
import { formatAirportDisplay, getCityMapForCodes, isLikelyAirportCode } from '@/lib/airport-formatter';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    /** Full path for Route display (origin → … → end). */
    routeDisplay?: string[];
    totalCostPerPerson: number;
    pointsCost: number;
    score: number;
    withinBudget?: boolean;
    withinPoints?: boolean;
    /** For group trips: ID of the member this itinerary is for */
    travelerId?: string;
    /** For group trips: Name of the member this itinerary is for */
    travelerName?: string;
}

interface AIRouteSuggestion {
    title: string;
    steps: Array<{ from_place: string; to_place: string; method: string; note: string }>;
    summary: string;
}

interface SmartTips {
    transfer_tips: Array<{ from_program?: string; to_program?: string; best_for?: string; note?: string }>;
    sample_itineraries: Array<{ title?: string; description?: string; savings_estimate?: string; when_to_book?: string }>;
    holiday_advice: Array<{ period?: string; advice?: string; avoid_or_prefer?: string }>;
    practical_tips: Array<{ category?: string; tip?: string }>;
}

const emptySmartTips: SmartTips = { transfer_tips: [], sample_itineraries: [], holiday_advice: [], practical_tips: [] };

interface OutOfPocketOption {
    price?: number;
    points?: number;
    surcharge?: number;
    out_of_pocket?: number;
}

interface OutOfPocketData {
    best_by_cash?: OutOfPocketOption | null;
    best_by_surcharge?: OutOfPocketOption | null;
    best_overall?: OutOfPocketOption | null;
    origin?: string;
    destination?: string;
    outbound_date?: string;
    return_date?: string;
}


function OutOfPocketBlock({ data }: { data: OutOfPocketData }) {
    const best = data.best_overall;
    if (!best || (best.out_of_pocket == null && best.price == null && best.surcharge == null)) return null;
    const oop = best.out_of_pocket ?? best.price ?? best.surcharge;
    const isCash = oop != null && best.price != null && oop === best.price;
    const isPoints = oop != null && best.surcharge != null && oop === best.surcharge;
    return (
        <div className="mb-8 p-6 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl">
            <h2 className="text-xl font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                Best out-of-pocket
            </h2>
            <p className="text-sm text-slate-600 mb-3">
                {data.origin} → {data.destination}
                {data.outbound_date && data.return_date && (
                    <span className="ml-2"> · {data.outbound_date} – {data.return_date}</span>
                )}
            </p>
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-bold text-slate-900">${Number(oop).toLocaleString()}</span>
                <span className="text-sm text-slate-600">
                    {isCash && '(cash)'}
                    {isPoints && best.points != null && `(points + surcharge, ${(best.points / 1000).toFixed(0)}k pts)`}
                    {!isCash && !isPoints && '(lowest of cash or points surcharge)'}
                </span>
            </div>
            {(data.best_by_cash || data.best_by_surcharge) && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
                    {data.best_by_cash?.price != null && (
                        <span>Best cash: ${data.best_by_cash.price.toLocaleString()}</span>
                    )}
                    {data.best_by_surcharge?.surcharge != null && (
                        <span>Best points: ${data.best_by_surcharge.surcharge.toLocaleString()} surcharge</span>
                    )}
                </div>
            )}
        </div>
    );
}

function SmartTipsBlock({ tips }: { tips: SmartTips }) {
    const has = tips.transfer_tips.length > 0 || tips.sample_itineraries.length > 0 || tips.holiday_advice.length > 0 || tips.practical_tips.length > 0;
    if (!has) return null;
    return (
        <div className="mt-10 pt-8 border-t border-slate-200">
            <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Smart tips for your trip
            </h2>
            <div className="grid sm:grid-cols-2 gap-6">
                {tips.transfer_tips.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <h3 className="font-medium text-slate-900 mb-2 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-blue-600" />
                            Where to transfer points
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-700">
                            {tips.transfer_tips.map((t, i) => (
                                <li key={i}>
                                    <span className="font-medium">{t.from_program || 'Points'}</span>
                                    <span className="text-slate-500 mx-1">→</span>
                                    <span className="font-medium">{t.to_program}</span>
                                    {t.best_for && <span className="text-slate-500"> ({t.best_for})</span>}
                                    {t.note && <span className="block text-slate-600 mt-0.5">{t.note}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {tips.sample_itineraries.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <h3 className="font-medium text-slate-900 mb-2 flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-green-600" />
                            Sample itineraries to save
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-700">
                            {tips.sample_itineraries.map((s, i) => (
                                <li key={i}>
                                    <span className="font-medium">{s.title}</span>
                                    <span className="block text-slate-600">{s.description}</span>
                                    {s.savings_estimate && <span className="text-green-700 text-xs">~{s.savings_estimate}</span>}
                                    {s.when_to_book && <span className="block text-slate-500 text-xs">{s.when_to_book}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {tips.holiday_advice.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <h3 className="font-medium text-slate-900 mb-2 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-amber-600" />
                            Holiday &amp; seasonal
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-700">
                            {tips.holiday_advice.map((h, i) => (
                                <li key={i}>
                                    <span className="font-medium">{h.period}</span>
                                    {h.avoid_or_prefer && <span className="text-amber-700 text-xs ml-1">({h.avoid_or_prefer})</span>}
                                    <span className="block text-slate-600">{h.advice}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {tips.practical_tips.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:col-span-2">
                        <h3 className="font-medium text-slate-900 mb-2 flex items-center gap-2">
                            <Info className="w-4 h-4 text-slate-600" />
                            Practical: transfer timing, closing hours
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-700">
                            {tips.practical_tips.map((p, i) => (
                                <li key={i}>
                                    {p.category && <span className="font-medium text-slate-800">{p.category}: </span>}
                                    {p.tip}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function GroupResults() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
    
    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [comparing, setComparing] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupSize, setGroupSize] = useState(4);
    const [members, setMembers] = useState<Array<{ id: string; name: string; initials: string; totalPoints: number; color: string }>>([]);
    const [aiSuggestions, setAiSuggestions] = useState<AIRouteSuggestion[]>([]);
    const [isAiSuggested, setIsAiSuggested] = useState(false);
    const [smartTips, setSmartTips] = useState<SmartTips>(emptySmartTips);
    const [outOfPocket, setOutOfPocket] = useState<OutOfPocketData | null>(null);
    const [userConstraints, setUserConstraints] = useState<{ maxBudget?: number; totalPoints: number; totalValue?: number; durationLabel: string } | null>(null);
    const [relaxedMessage, setRelaxedMessage] = useState<string | null>(null);

    const stepIcon = (method: string) => {
        const m = (method || '').toLowerCase();
        if (m.includes('fly') || m.includes('flight')) return <Plane className="w-4 h-4 text-blue-600" />;
        if (m.includes('drive') || m.includes('car')) return <Car className="w-4 h-4 text-amber-600" />;
        if (m.includes('bus')) return <Bus className="w-4 h-4 text-green-600" />;
        if (m.includes('train') || m.includes('rail')) return <Train className="w-4 h-4 text-slate-600" />;
        return <Navigation className="w-4 h-4 text-slate-500" />;
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!tripId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setAiSuggestions([]);
                setIsAiSuggested(false);
                setSmartTips(emptySmartTips);
                setOutOfPocket(null);
                setUserConstraints(null);
                setRelaxedMessage(null);

                // Fetch group size, members, itineraries, and trip in parallel
                const [membersResponse, pointsResponse, itineraryResponse, trip] = await Promise.all([
                    tripsAPI.listMembers(tripId),
                    pointsAPI.summary(tripId),
                    itinerariesAPI.get(tripId),
                    tripsAPI.get(tripId).catch(() => null),
                ]);
                const t = trip as { maxBudget?: number; startDate?: string; endDate?: string; durationDays?: number } | null;

                let durationLabel = '—';
                if (t?.startDate && t?.endDate) {
                    const start = new Date(t.startDate);
                    const end = new Date(t.endDate);
                    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                        const d = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                        if (d > 0) durationLabel = `${d} days`;
                    }
                } else if (t?.durationDays != null && t.durationDays > 0) {
                    durationLabel = `${t.durationDays} days (flexible)`;
                }
                const totalPts = typeof (pointsResponse as { totalPoints?: number })?.totalPoints === 'number' ? (pointsResponse as { totalPoints: number }).totalPoints : 0;
                const totalVal = typeof (pointsResponse as { totalValue?: number })?.totalValue === 'number' ? (pointsResponse as { totalValue: number }).totalValue : undefined;
                setUserConstraints({
                    maxBudget: t?.maxBudget != null && t.maxBudget > 0 ? t.maxBudget : undefined,
                    totalPoints: totalPts,
                    totalValue: totalVal,
                    durationLabel,
                });

                const memberCount = membersResponse.members.length || 4;
                setGroupSize(memberCount);

                // Transform members data with points
                const colorClasses = ['bg-blue-600', 'bg-purple-600', 'bg-green-600', 'bg-orange-600', 'bg-pink-600', 'bg-indigo-600'];
                const transformedMembers = membersResponse.members.map((member, index) => {
                    const userId = member.userId || '';
                    const name = member.name || `Member ${index + 1}`;
                    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || userId.substring(0, 2).toUpperCase();
                    const userPoints = pointsResponse.items?.filter((item: { userId?: string }) => item.userId === userId) || [];
                    const totalPoints = userPoints.reduce((sum: number, item: { balance?: number }) => sum + (item.balance || 0), 0);
                    return {
                        id: userId,
                        name: name,
                        initials: initials,
                        totalPoints: totalPoints,
                        color: colorClasses[index % colorClasses.length],
                    };
                });
                setMembers(transformedMembers);

                // Check for AI route suggestions (small/remote cities with no flight data)
                const aiItem = itineraryResponse.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'ai_route_suggestions');
                if (aiItem && (aiItem as { suggestions?: AIRouteSuggestion[] }).suggestions?.length) {
                    setAiSuggestions((aiItem as { suggestions: AIRouteSuggestion[] }).suggestions);
                    setSmartTips({
                        transfer_tips: Array.isArray((aiItem as any).transfer_tips) ? (aiItem as any).transfer_tips : [],
                        sample_itineraries: Array.isArray((aiItem as any).sample_itineraries) ? (aiItem as any).sample_itineraries : [],
                        holiday_advice: Array.isArray((aiItem as any).holiday_advice) ? (aiItem as any).holiday_advice : [],
                        practical_tips: Array.isArray((aiItem as any).practical_tips) ? (aiItem as any).practical_tips : [],
                    });
                    setIsAiSuggested(true);
                    setItineraries([]);
                    setLoading(false);
                    return;
                }

                // Extract smart tips from itinerary_smart_tips item
                const tipsItem = itineraryResponse.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'itinerary_smart_tips');
                if (tipsItem && typeof tipsItem === 'object') {
                    const t = tipsItem as Record<string, unknown>;
                    setSmartTips({
                        transfer_tips: Array.isArray(t.transfer_tips) ? t.transfer_tips as SmartTips['transfer_tips'] : [],
                        sample_itineraries: Array.isArray(t.sample_itineraries) ? t.sample_itineraries as SmartTips['sample_itineraries'] : [],
                        holiday_advice: Array.isArray(t.holiday_advice) ? t.holiday_advice as SmartTips['holiday_advice'] : [],
                        practical_tips: Array.isArray(t.practical_tips) ? t.practical_tips as SmartTips['practical_tips'] : [],
                    });
                }

                // Out-of-pocket (simple A->B round-trip)
                const oopItem = itineraryResponse.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'out_of_pocket');
                if (oopItem && typeof oopItem === 'object') {
                    setOutOfPocket(oopItem as OutOfPocketData);
                } else {
                    setOutOfPocket(null);
                }

                // Relaxed-constraints banner (when no feasible solution; we show a similar route)
                const relaxedItem = itineraryResponse.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'itinerary_relaxed_info') as { 
                    message?: string; 
                    suggested_budget?: number;
                    original_budget?: number;
                    suggested_cash?: number;
                } | undefined;
                
                if (relaxedItem && relaxedItem.suggested_budget && relaxedItem.original_budget) {
                    // Create a more informative message with the suggested budget
                    const msg = `Your budget of $${relaxedItem.original_budget.toLocaleString()} is too low for this trip. ` +
                        `The minimum cost is $${relaxedItem.suggested_cash?.toLocaleString() || 'unknown'}. ` +
                        `We recommend setting your budget to at least $${relaxedItem.suggested_budget.toLocaleString()}.`;
                    setRelaxedMessage(msg);
                } else {
                    setRelaxedMessage(relaxedItem && typeof relaxedItem.message === 'string' ? relaxedItem.message : null);
                }

                // Fetch destinations to map UUIDs to names
                const destinationsResponse = await destinations.list(tripId);
                const destinationMap = new Map<string, string>();
                destinationsResponse.destinations.forEach((dest) => {
                    destinationMap.set(dest.destinationId, dest.name);
                });

                // Filter to itinerary-style items (exclude payments, totals, etc.). Include 'path' (optimized ILP routes) and 'itinerary' (simple generator).
                const regularItems = (itineraryResponse.items || []).filter(
                    (i: ItineraryItem & { type?: string }) => {
                        if (['ai_route_suggestions', 'itinerary_smart_tips', 'itinerary_relaxed_info', 'out_of_pocket', 'out_of_pocket_hotels', 'payments', 'totals'].includes(i.type || '')) return false;
                        const route = i.route || i.cities || (i as { path?: unknown }).path;
                        return Array.isArray(route) && route.length > 0;
                    }
                );

                const iataCodes: string[] = [];
                for (const i of regularItems) {
                    const r = (i.route || i.cities || (i as { path?: unknown }).path) as Array<string | { name?: string }> | undefined;
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
                        const fullRoute = item.route || (item as { path?: unknown }).path || [];
                        const routeDisplay: string[] = Array.isArray(fullRoute)
                            ? fullRoute.map((el: string | { name?: string }) => {
                                if (typeof el === 'string') {
                                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(el))
                                        return destinationMap.get(el) || el;
                                    return formatAirportDisplay(el, codeToCity[el.trim().toUpperCase()]);
                                }
                                if (el && typeof el === 'object' && 'name' in el) {
                                    const n = (el as { name?: string }).name;
                                    if (!n) return '';
                                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n))
                                        return destinationMap.get(n) || n;
                                    return formatAirportDisplay(n, codeToCity[n?.trim().toUpperCase()]);
                                }
                                return String(el);
                            })
                            : [];

                        const hasStaysOnly = Array.isArray((item as { cities?: unknown }).cities)
                            && (item as { cities: unknown[] }).cities.length > 0
                            && (item as { cities: unknown[] }).cities.every((c: unknown) =>
                                c != null && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { days?: unknown }).days === 'number');
                        let cities: Array<{ name: string; days: number }>;
                        if (hasStaysOnly) {
                            cities = ((item as { cities: Array<{ name: string; days: number }> }).cities).map((c) => ({
                                name: formatAirportDisplay(c.name, codeToCity[c.name?.trim().toUpperCase()]),
                                days: c.days,
                            }));
                        } else {
                            const route = item.route || item.cities || (item as { path?: unknown }).path || [];
                            cities = Array.isArray(route)
                                ? route.map((city: string | { name: string; days: number }) => {
                                    let rawName: string;
                                    let days: number;
                                    if (typeof city === 'string') {
                                        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city);
                                        rawName = isUUID && destinationMap.has(city) ? destinationMap.get(city)! : (isUUID ? city : city);
                                        days = 3;
                                    } else if (city.name && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city.name)) {
                                        rawName = destinationMap.get(city.name) || city.name;
                                        days = city.days || 3;
                                    } else {
                                        rawName = city.name || '';
                                        days = city.days || 3;
                                    }
                                    return { name: formatAirportDisplay(rawName, codeToCity[rawName.trim().toUpperCase()]), days };
                                })
                                : [];
                        }

                        // Extract travelerId for per-member routes
                        const rawItem = item as ItineraryItem & { travelerId?: string };
                        const travelerId = rawItem.travelerId;
                        
                        // Find member name if travelerId is present
                        let travelerName: string | undefined;
                        if (travelerId && transformedMembers.length > 0) {
                            const member = transformedMembers.find(m => m.id === travelerId);
                            travelerName = member?.name;
                        }
                        
                        return {
                            id: index + 1,
                            name: item.name || (travelerName ? `${travelerName}'s Route` : `Itinerary ${index + 1}`),
                            cities,
                            routeDisplay: routeDisplay.length > 0 ? routeDisplay : undefined,
                            totalCostPerPerson: item.totalCostPerPerson || item.costPerPerson || (item.totalCost || 0) / memberCount,
                            pointsCost: item.pointsCost || item.points || 0,
                            score: item.score || 85,
                            withinBudget: item.withinBudget !== false,
                            withinPoints: item.withinPoints !== false,
                            travelerId,
                            travelerName,
                        };
                    });
                    transformed = transformed.sort((a, b) => {
                        const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
                        const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
                        return sb - sa;
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
    }, [tripId]);

    const selectedItinerary = itineraries.find(i => i.id === selectedId);

    const updateCityDays = (itineraryId: number, cityIndex: number, days: number) => {
        setItineraries(prev => prev.map(itinerary => {
            if (itinerary.id === itineraryId) {
                const newCities = [...itinerary.cities];
                newCities[cityIndex] = { ...newCities[cityIndex], days };
                const totalDays = newCities.reduce((sum, c) => sum + c.days, 0);
                const totalCost = Math.floor(totalDays * 200 + newCities.length * 300);
                return {
                    ...itinerary,
                    cities: newCities,
                    totalCostPerPerson: totalCost / groupSize,
                    pointsCost: Math.floor(totalCost * 25),
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
            <div
                data-testid="group-results-loading"
                data-slot="loading-spinner-wrapper"
                className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white"
            >
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

    // AI-suggested routes for small/remote cities (no flight search data)
    if (isAiSuggested && aiSuggestions.length > 0) {
        return (
            <div data-testid="group-results-ai-suggested" data-slot="GroupResults" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-8">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-100 rounded-full text-sm text-amber-800 mb-4 font-medium">
                            <Sparkles className="w-4 h-4" />
                            Suggested routes for small or remote destinations
                        </div>
                        <h1 className="text-4xl mb-2 tracking-tight text-slate-900 font-bold">Route Suggestions</h1>
                        <p className="text-slate-600">
                            We don&apos;t have flight data for these destinations, so we used AI to suggest practical ways to get there.
                        </p>
                    </div>
                    <div className="space-y-6">
                        {aiSuggestions.map((s, idx) => (
                            <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                <h3 className="text-xl text-slate-900 font-semibold mb-4">{s.title}</h3>
                                <ul className="space-y-3 mb-4">
                                    {s.steps.map((step, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <span className="mt-0.5">{stepIcon(step.method)}</span>
                                            <div>
                                                <span className="font-medium text-slate-900">{step.from_place}</span>
                                                <span className="text-slate-400 mx-2">→</span>
                                                <span className="font-medium text-slate-900">{step.to_place}</span>
                                                <span className="text-slate-500 text-sm ml-1">({step.method})</span>
                                                {step.note && <p className="text-sm text-slate-600 mt-1">{step.note}</p>}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                {s.summary && <p className="text-slate-600 text-sm border-t border-slate-100 pt-4">{s.summary}</p>}
                            </div>
                        ))}
                    </div>
                    <SmartTipsBlock tips={smartTips} />
                    <p className="mt-8 text-sm text-slate-500">
                        Use these as a starting point. Book flights and ground transport separately. For the best fares, search from the suggested hubs on your preferred booking site.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div data-testid="group-results-page" data-slot="GroupResults" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
                                <Users className="w-4 h-4" />
                                <span>Group Trip · {groupSize} members</span>
                            </div>
                            <h1 className="text-4xl tracking-tight text-slate-900 font-bold">Your Group Options</h1>
                            <p className="text-slate-600 mt-1">
                                {itineraries.length === 0
                                    ? 'No itineraries match your group budget and points. Try adjusting your limits or destinations.'
                                    : itineraries.some(it => it.travelerId)
                                    ? `Each member has their own customized route based on their departure airport. Below you'll find ${itineraries.length} personalized routes for your group.`
                                    : itineraries.length === 1
                                    ? 'We generated 1 group itinerary that fits your budget and points'
                                    : `Choose from ${itineraries.length} personalized group itineraries — each showing costs per person and total points needed`}
                            </p>
                        </div>
                    </div>
                </div>

                {userConstraints && (
                    <div className="mb-8 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-6 text-sm">
                        <span className="font-medium text-slate-700">Based on your inputs:</span>
                        {userConstraints.maxBudget != null && userConstraints.maxBudget > 0 && (
                            <span className="text-slate-600">Budget: <strong className="text-slate-900">${userConstraints.maxBudget.toLocaleString()}</strong></span>
                        )}
                        {userConstraints.totalPoints > 0 && (
                            <span className="text-slate-600">Points: <strong className="text-slate-900">{(userConstraints.totalPoints / 1000).toFixed(0)}k</strong></span>
                        )}
                        <span className="text-slate-600">Duration: <strong className="text-slate-900">{userConstraints.durationLabel}</strong></span>
                    </div>
                )}

                {relaxedMessage && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-900">{relaxedMessage}</p>
                    </div>
                )}

                {outOfPocket && <OutOfPocketBlock data={outOfPocket} />}

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
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-2xl text-slate-900 font-semibold">{itinerary.name}</h3>
                                                {itinerary.travelerName && (
                                                    <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium flex items-center gap-1">
                                                        <Users className="w-3 h-3" />
                                                        {itinerary.travelerName}
                                                    </span>
                                                )}
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
                                        <div className="flex flex-wrap items-center gap-2">
                                            {itinerary.withinBudget === false && (
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">Over budget</span>
                                            )}
                                            {itinerary.withinPoints === false && (
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">Exceeds points</span>
                                            )}
                                            {itinerary.withinBudget === true && itinerary.withinPoints === true && (
                                                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Within budget &amp; points</span>
                                            )}
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
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={comparing.includes(itinerary.id)}
                                                    onChange={() => toggleCompare(itinerary.id)}
                                                    className="w-5 h-5"
                                                />
                                                <span className="text-sm text-slate-600 group-hover:text-slate-900">Compare</span>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Prominent Out-of-Pocket Summary */}
                                    <div className="mb-6 grid grid-cols-3 gap-3 p-4 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Per Person</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">${itinerary.totalCostPerPerson.toLocaleString()}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">Out-of-pocket</div>
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <Users className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Total Cost</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">${(itinerary.totalCostPerPerson * groupSize).toLocaleString()}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">For {groupSize} people</div>
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <Zap className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Points</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                            <div className="text-xs text-slate-500 mt-0.5">To use</div>
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
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <MapPin className="w-4 h-4 text-blue-600" />
                                                        <span className="font-semibold text-slate-900">{city.name}</span>
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

                                    {/* Value Summary */}
                                    <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 mb-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="text-sm font-medium text-emerald-900 mb-1">Estimated Group Savings</div>
                                                <div className="text-xs text-emerald-700">
                                                    Using points instead of cash could save the group up to ${Math.round(itinerary.pointsCost * 0.015 * groupSize).toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="text-2xl font-bold text-emerald-700">
                                                {Math.round((itinerary.pointsCost * 0.015 / (itinerary.totalCostPerPerson + itinerary.pointsCost * 0.015)) * 100)}%
                                            </div>
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
                                    <h3 className="text-xl mb-6 text-slate-900 font-semibold">Selected Route</h3>

                                    {/* Full path (origin → … → end) when routeDisplay is set */}
                                    {((selectedItinerary.routeDisplay?.length ?? 0) > 0 || selectedItinerary.cities.length > 0) && (
                                        <div className="mb-6">
                                            <div className="text-sm text-slate-600 mb-2 font-medium">Route</div>
                                            <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                                                {(selectedItinerary.routeDisplay && selectedItinerary.routeDisplay.length > 0
                                                    ? selectedItinerary.routeDisplay
                                                    : selectedItinerary.cities.map((c) => c.name)
                                                ).map((label, i) => (
                                                    <span key={i} className="flex items-center gap-1.5">
                                                        <span>{label}</span>
                                                        {i < (selectedItinerary.routeDisplay?.length ?? selectedItinerary.cities.length) - 1 && (
                                                            <span className="text-slate-400">→</span>
                                                        )}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="mb-6">
                                        <div className="text-sm text-slate-600 mb-3 font-medium">Cost Breakdown</div>
                                        <div className="space-y-2 text-sm">
                                            {(() => {
                                                const totalCost = selectedItinerary.totalCostPerPerson * groupSize;
                                                const flightsPart = totalCost * 0.65;
                                                const activitiesPart = totalCost * 0.35;
                                                const sum = flightsPart + activitiesPart;
                                                return (
                                                    <>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Flights</span>
                                                            <span className="text-slate-900 font-medium">${Math.round(flightsPart).toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Activities</span>
                                                            <span className="text-slate-900 font-medium">${Math.round(activitiesPart).toLocaleString()}</span>
                                                        </div>
                                                        <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold">
                                                            <span className="text-slate-900">Total</span>
                                                            <span className="text-slate-900">${Math.round(sum).toLocaleString()}</span>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                    <h3 className="text-lg mb-4 text-slate-900 font-semibold">Individual Cost Breakdown</h3>

                                    <div className="space-y-4">
                                        {members.map((member, idx) => {
                                            const baseCost = selectedItinerary.totalCostPerPerson;
                                            const savings = Math.min(baseCost, member.totalPoints * 0.012);
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
                                                    ${members.reduce((acc, member) => {
                                                        const savings = Math.min(selectedItinerary.totalCostPerPerson, member.totalPoints * 0.012);
                                                        return acc + (selectedItinerary.totalCostPerPerson - savings);
                                                    }, 0).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-green-600">
                                                <span>Total Savings</span>
                                                <span>
                                                    -${members.reduce((acc, member) => {
                                                        return acc + Math.min(selectedItinerary.totalCostPerPerson, member.totalPoints * 0.012);
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
                                        onClick={() => router.push(`/group/points-strategy?tripId=${tripId}`)}
                                        className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold"
                                    >
                                        Select & Optimize Points
                                    </button>
                                    <button
                                        onClick={() => router.push(`/group/comparison?tripId=${tripId}`)}
                                        disabled={comparing.length === 0}
                                        className={`w-full mt-3 px-6 py-2.5 rounded-xl transition-colors font-semibold ${
                                            comparing.length > 0
                                                ? 'bg-blue-500/90 text-white hover:bg-blue-500 shadow-sm'
                                                : 'bg-white/10 text-white/60 cursor-not-allowed'
                                        }`}
                                    >
                                        {comparing.length > 0 ? `Compare ${comparing.length} Routes` : 'Compare Routes'}
                                    </button>
                                    {tripId && (
                                        <button
                                            onClick={() => router.push(`/group/itinerary?tripId=${tripId}`)}
                                            className="w-full mt-3 px-6 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors text-sm font-medium"
                                        >
                                            View trip itinerary
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <SmartTipsBlock tips={smartTips} />
            </div>
        </div>
    );
}
