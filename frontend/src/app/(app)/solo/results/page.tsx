'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Edit3, Check, Sparkles, TrendingUp, Plane, Car, Bus, Train, Navigation, Info, Bed, ChevronRight, Lock } from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, points as pointsAPI, ItineraryItem, destinations, type Trip } from '@/lib/api';
import { formatAirportDisplay, getCityMapForCodes, isLikelyAirportCode } from '@/lib/airport-formatter';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
    /** Full path for Route display (origin -> ... -> end). When set, use instead of cities for the Route section. */
    routeDisplay?: string[];
    totalCost: number;
    pointsCost: number;
    score: number;
    withinBudget?: boolean;
    withinPoints?: boolean;
}

interface AIRouteSuggestion {
    title: string;
    steps: Array< { from_place: string; to_place: string; method: string; note: string }>;
    summary: string;
}


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

export default function SoloResults() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('trip_id') || '';

    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [comparing, setComparing] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [aiSuggestions, setAiSuggestions] = useState<AIRouteSuggestion[]>([]);
    const [isAiSuggested, setIsAiSuggested] = useState(false);
    const [outOfPocket, setOutOfPocket] = useState<OutOfPocketData | null>(null);
    const [userConstraints, setUserConstraints] = useState<{ maxBudget?: number; totalPoints: number; durationLabel: string } | null>(null);
    const [relaxedMessage, setRelaxedMessage] = useState<string | null>(null);
    const [trip, setTrip] = useState<Trip | null>(null);
    const [refetchTrigger, setRefetchTrigger] = useState(0);
    const [budgetWarning, setBudgetWarning] = useState<{ message?: string; user_budget?: number; recommended_budget?: number } | null>(null);
    const [optimizationWarning, setOptimizationWarning] = useState<string | null>(null);
    const [fallbackWarning, setFallbackWarning] = useState<string | null>(null);

    useEffect(() => {
        const fetchItineraries = async () => {
            if (!tripId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setAiSuggestions([]);
                setIsAiSuggested(false);
                setOutOfPocket(null);
                setUserConstraints(null);
                setRelaxedMessage(null);
                setBudgetWarning(null);
                setOptimizationWarning(null);
                setFallbackWarning(null);
                const [response, trip, pointsRes] = await Promise.all([
                    itinerariesAPI.get(tripId),
                    tripsAPI.get(tripId).catch(() => null),
                    pointsAPI.summary(tripId).catch(() => ({ totalPoints: 0, items: [] })),
                ]);
                setTrip((trip ?? null) as Trip | null);
                const t = trip as { maxBudget?: number; startDate?: string; endDate?: string; durationDays?: number } | null;

                // Build duration label from user inputs: from dates, or durationDays (flexible), or "—"
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

                setUserConstraints({
                    maxBudget: t?.maxBudget != null && t.maxBudget > 0 ? t.maxBudget : undefined,
                    totalPoints: typeof (pointsRes as { totalPoints?: number })?.totalPoints === 'number' ? (pointsRes as { totalPoints: number }).totalPoints : 0,
                    durationLabel,
                });

                // Check for AI route suggestions (small/remote cities with no flight data)
                const aiItem = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'ai_route_suggestions');
                if (aiItem && (aiItem as { suggestions?: AIRouteSuggestion[] }).suggestions?.length) {
                    setAiSuggestions((aiItem as { suggestions: AIRouteSuggestion[] }).suggestions);
                    setIsAiSuggested(true);
                    setItineraries([]);
                    setLoading(false);
                    return;
                }

                // Helper: extract OOP/relaxed from a response (get returns in items; generate can have top-level or in items)
                const pickOop = (r: { items?: unknown[]; out_of_pocket?: OutOfPocketData }) =>
                    (r.items?.find((i: unknown) => (i as { type?: string })?.type === 'out_of_pocket') as OutOfPocketData | undefined) || r.out_of_pocket || null;
                const pickRelaxed = (r: { items?: unknown[]; relaxed_message?: string }) => {
                    const it = r.items?.find((i: unknown) => (i as { type?: string })?.type === 'itinerary_relaxed_info') as { message?: string } | undefined;
                    return (it && typeof it.message === 'string' ? it.message : null) || r.relaxed_message || null;
                };

                // Out-of-pocket (simple A->B round-trip: best cash vs points+surcharge)
                setOutOfPocket(pickOop(response));
                // Relaxed-constraints banner (when no feasible solution; we show a similar route)
                setRelaxedMessage(pickRelaxed(response));
                
                // Extract warnings from response items
                const budgetWarn = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'budget_warning') as { message?: string; user_budget?: number; recommended_budget?: number } | undefined;
                setBudgetWarning(budgetWarn || null);
                
                const optWarn = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'optimization_warning') as { message?: string } | undefined;
                setOptimizationWarning(optWarn?.message || null);
                
                const fallWarn = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'fallback_warning') as { message?: string } | undefined;
                setFallbackWarning(fallWarn?.message || null);

                // Fetch destinations to map UUIDs to names
                const destinationsResponse = await destinations.list(tripId);
                const destinationMap = new Map<string, string>();
                destinationsResponse.destinations.forEach((dest) => {
                    destinationMap.set(dest.destinationId, dest.name);
                });

                // Transform API response (exclude non-itinerary types: ai_route_suggestions, itinerary_smart_tips, out_of_pocket, out_of_pocket_hotels, payments, totals, warnings)
                // Include 'path' (optimized ILP routes) and 'itinerary' (simple generator); path has route/path with airport codes
                const regularItems = (response.items || []).filter(
                    (i: ItineraryItem & { type?: string }) => {
                        if (['ai_route_suggestions', 'itinerary_smart_tips', 'itinerary_relaxed_info', 'out_of_pocket', 'out_of_pocket_hotels', 'payments', 'totals', 'budget_warning', 'optimization_warning', 'fallback_warning'].includes(i.type || '')) return false;
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

                        return {
                            id: index + 1,
                            name: item.name || `Itinerary ${index + 1}`,
                            cities,
                            routeDisplay: routeDisplay.length > 0 ? routeDisplay : undefined,
                            totalCost: item.totalCost || item.cost || 0,
                            pointsCost: item.pointsCost || item.points || 0,
                            score: item.score || 85,
                            withinBudget: item.withinBudget !== false,
                            withinPoints: item.withinPoints !== false,
                        };
                    });
                    // Sort: within budget and points first, then by score (Figma: best match / 94/100 on top)
                    transformed = transformed.sort((a, b) => {
                        const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
                        const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
                        if (sb !== sa) return sb - sa;
                        return (b.score || 0) - (a.score || 0);
                    });

                    setItineraries(transformed);
                    if (transformed.length > 0) {
                        setSelectedId(transformed[0].id);
                    }
                } else {
                    // No route-like items from get: trigger generation (solo setup does not call generate before navigating here)
                    try {
                        const gen = await itinerariesAPI.generate(tripId) as {
                            items?: ItineraryItem[];
                            ai_suggested_routes?: boolean;
                            suggestions?: AIRouteSuggestion[];
                            out_of_pocket?: OutOfPocketData;
                            relaxed_message?: string;
                        };
                        if (gen.ai_suggested_routes && gen.suggestions?.length) {
                            setAiSuggestions(gen.suggestions);
                            setIsAiSuggested(true);
                            setItineraries([]);
                        } else {
                            setOutOfPocket(pickOop(gen));
                            setRelaxedMessage(pickRelaxed(gen));
                            
                            // Extract warnings from generated items
                            const genBudgetWarn = (gen.items || []).find((i: ItineraryItem & { type?: string }) => i.type === 'budget_warning') as { message?: string; user_budget?: number; recommended_budget?: number } | undefined;
                            setBudgetWarning(genBudgetWarn || null);
                            const genOptWarn = (gen.items || []).find((i: ItineraryItem & { type?: string }) => i.type === 'optimization_warning') as { message?: string } | undefined;
                            setOptimizationWarning(genOptWarn?.message || null);
                            const genFallWarn = (gen.items || []).find((i: ItineraryItem & { type?: string }) => i.type === 'fallback_warning') as { message?: string } | undefined;
                            setFallbackWarning(genFallWarn?.message || null);
                            
                            const genRegular = (gen.items || []).filter(
                                (i: ItineraryItem & { type?: string }) => {
                                    if (['ai_route_suggestions', 'itinerary_smart_tips', 'itinerary_relaxed_info', 'out_of_pocket', 'out_of_pocket_hotels', 'payments', 'totals', 'budget_warning', 'optimization_warning', 'fallback_warning'].includes(i.type || '')) return false;
                                    const route = i.route || i.cities || (i as { path?: unknown }).path;
                                    return Array.isArray(route) && route.length > 0;
                                }
                            );
                            const genIataCodes: string[] = [];
                            for (const i of genRegular) {
                                const r = (i.route || i.cities || (i as { path?: unknown }).path) as Array<string | { name?: string }> | undefined;
                                if (Array.isArray(r)) {
                                    for (const c of r) {
                                        const n = typeof c === 'string' ? c : (c as { name?: string })?.name;
                                        if (n && isLikelyAirportCode(n)) genIataCodes.push(n.trim().toUpperCase());
                                    }
                                }
                            }
                            const [genCodeToCity, genDestRes] = await Promise.all([
                                getCityMapForCodes(genIataCodes),
                                destinations.list(tripId),
                            ]);
                            const genDestinationMap = new Map<string, string>();
                            genDestRes.destinations?.forEach((d: { destinationId?: string; name?: string }) => { if (d.destinationId) genDestinationMap.set(d.destinationId, d.name || ''); });
                            if (genRegular.length > 0) {
                                let tr: Itinerary[] = genRegular.map((item: ItineraryItem, index: number) => {
                                    const fullRoute = item.route || (item as { path?: unknown }).path || [];
                                    const routeDisplay: string[] = Array.isArray(fullRoute)
                                        ? fullRoute.map((el: string | { name?: string }) => {
                                            if (typeof el === 'string') {
                                                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(el))
                                                    return genDestinationMap.get(el) || el;
                                                return formatAirportDisplay(el, genCodeToCity[el.trim().toUpperCase()]);
                                            }
                                            if (el && typeof el === 'object' && 'name' in el) {
                                                const n = (el as { name?: string }).name;
                                                if (!n) return '';
                                                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n))
                                                    return genDestinationMap.get(n) || n;
                                                return formatAirportDisplay(n, genCodeToCity[n?.trim().toUpperCase()]);
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
                                            name: formatAirportDisplay(c.name, genCodeToCity[c.name?.trim().toUpperCase()]),
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
                                                    rawName = isUUID && genDestinationMap.has(city) ? genDestinationMap.get(city)! : (isUUID ? city : city);
                                                    days = 3;
                                                } else if (city.name && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city.name)) {
                                                    rawName = genDestinationMap.get(city.name) || city.name;
                                                    days = city.days || 3;
                                                } else {
                                                    rawName = city.name || '';
                                                    days = city.days || 3;
                                                }
                                                return { name: formatAirportDisplay(rawName, genCodeToCity[rawName.trim().toUpperCase()]), days };
                                            })
                                            : [];
                                    }
                                    return {
                                        id: index + 1,
                                        name: item.name || `Itinerary ${index + 1}`,
                                        cities,
                                        routeDisplay: routeDisplay.length > 0 ? routeDisplay : undefined,
                                        totalCost: item.totalCost || item.cost || 0,
                                        pointsCost: item.pointsCost || item.points || 0,
                                        score: item.score ?? 85,
                                        withinBudget: item.withinBudget !== false,
                                        withinPoints: item.withinPoints !== false,
                                    };
                                });
                                tr = tr.sort((a, b) => {
                                    const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
                                    const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
                                    if (sb !== sa) return sb - sa;
                                    return (b.score || 0) - (a.score || 0);
                                });
                                setItineraries(tr);
                                if (tr.length > 0) setSelectedId(tr[0].id);
                            } else {
                                setItineraries([]);
                            }
                        }
                    } catch (genErr) {
                        console.error('Error generating itineraries:', genErr);
                        setItineraries([]);
                    }
                }
            } catch (err) {
                console.error('Error fetching itineraries:', err);
                setItineraries([]);
            } finally {
                setLoading(false);
            }
        };

        fetchItineraries();
    }, [tripId, refetchTrigger]);

    const stepIcon = (method: string) => {
        const m = (method || '').toLowerCase();
        if (m.includes('fly') || m.includes('flight')) return <Plane className="w-4 h-4 text-blue-600" />;
        if (m.includes('drive') || m.includes('car')) return <Car className="w-4 h-4 text-amber-600" />;
        if (m.includes('bus')) return <Bus className="w-4 h-4 text-green-600" />;
        if (m.includes('train') || m.includes('rail')) return <Train className="w-4 h-4 text-slate-600" />;
        return <Navigation className="w-4 h-4 text-slate-500" />;
    };

    const selectedItinerary = itineraries.find(i => i.id === selectedId);

    const updateCityDays = (itineraryId: number, cityIndex: number, days: number) => {
        setItineraries(prev => prev.map(itinerary => {
            if (itinerary.id === itineraryId) {
                const newCities = [...itinerary.cities];
                newCities[cityIndex] = { ...newCities[cityIndex], days };

                // Recalculate costs using same formula as backend (flights + activities only)
                const totalDays = newCities.reduce((sum, c) => sum + c.days, 0);
                const perDay = 120;
                const perCity = 200;
                const newCost = Math.floor(totalDays * perDay + newCities.length * perCity);

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
            <div
                data-testid="solo-results-loading"
                data-slot="loading-spinner-wrapper"
                className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white"
            >
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

    // AI-suggested routes for small/remote cities (no flight search data)
    if (isAiSuggested && aiSuggestions.length > 0) {
        return (
            <div data-testid="solo-results-ai-suggested" data-slot="SoloResults" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
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
                    <p className="mt-8 text-sm text-slate-500">
                        Use these as a starting point. Book flights and ground transport separately. For the best fares, search from the suggested hubs on your preferred booking site.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div data-testid="solo-results-page" data-slot="SoloResults" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div data-testid="solo-results-header" className="mb-8">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-4xl tracking-tight text-slate-900 font-bold">Your Trip Options</h1>
                            <p className="text-slate-600 mt-1">
                                {itineraries.length === 0
                                    ? 'No itineraries match your budget and points. Try adjusting your limits or destinations.'
                                    : itineraries.length === 1
                                    ? 'We generated 1 itinerary that fits your budget and points'
                                    : `Choose from ${itineraries.length} personalized itineraries — each showing out-of-pocket costs and points needed`}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Your inputs — so "Within budget & points" is measured against these */}
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

                {/* Budget Warning - shown when user's budget is too low */}
                {budgetWarning && (
                    <div className="mb-6 p-5 bg-red-50 border-2 border-red-300 rounded-xl">
                        <div className="flex items-start gap-3 mb-3">
                            <Info className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-red-900 mb-2">Budget Too Low</h3>
                                <p className="text-sm text-red-800">{budgetWarning.message}</p>
                            </div>
                        </div>
                        {budgetWarning.user_budget != null && budgetWarning.recommended_budget != null && (
                            <div className="mt-3 pt-3 border-t border-red-200 grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <div className="text-red-600 font-medium">Your Budget</div>
                                    <div className="text-lg font-bold text-red-900">${budgetWarning.user_budget.toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-green-600 font-medium">Recommended</div>
                                    <div className="text-lg font-bold text-green-900">${budgetWarning.recommended_budget.toLocaleString()}</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Optimization Warning - shown when optimizer couldn't find flights */}
                {optimizationWarning && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-amber-900 mb-1">Estimated Routes</h3>
                            <p className="text-sm text-amber-800">{optimizationWarning}</p>
                        </div>
                    </div>
                )}

                {/* Fallback Warning - shown as last resort */}
                {fallbackWarning && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-red-900 mb-1">Unable to Generate Itinerary</h3>
                            <p className="text-sm text-red-800">{fallbackWarning}</p>
                        </div>
                    </div>
                )}

                {outOfPocket && <OutOfPocketBlock data={outOfPocket} />}

                {/* Empty state when no itineraries */}
                {itineraries.length === 0 ? (
                    <div data-testid="solo-results-empty" data-slot="solo-results-empty" className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                        {tripId && trip && !isAiSuggested ? (
                            <>
                                <MapPin className="w-14 h-14 text-slate-300 mx-auto mb-4" />
                                <h2 className="text-xl font-semibold text-slate-900 mb-2">Complete your booking</h2>
                                <p className="text-slate-600 max-w-md mx-auto mb-6">
                                    Your personalized routes will be ready after you complete payment on the booking page.
                                </p>
                                <button
                                    onClick={() => router.push(`/solo/booking${tripId ? `?trip_id=${tripId}` : ''}`)}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                                >
                                    Go to Booking
                                </button>
                            </>
                        ) : (
                            <>
                                <MapPin className="w-14 h-14 text-slate-300 mx-auto mb-4" />
                                <h2 className="text-xl font-semibold text-slate-900 mb-2">No routes yet</h2>
                                <p className="text-slate-600 max-w-md mx-auto mb-6">
                                    We couldn&apos;t generate itineraries that fit your budget and points. Try increasing your budget, adding more points, or choosing different destinations.
                                </p>
                                <button
                                    onClick={() => router.push(`/solo/setup`)}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                                >
                                    Back to setup
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Itinerary Cards */}
                    <div data-testid="itinerary-list" data-slot="itinerary-list" className="lg:col-span-2 space-y-6">
                        {itineraries.map((itinerary) => (
                            <div
                                key={itinerary.id}
                                data-testid={`itinerary-card-${itinerary.id}`}
                                data-slot="itinerary-card"
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedId(itinerary.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(itinerary.id); } }}
                                className={`bg-white border-2 rounded-2xl overflow-hidden transition-all shadow-sm cursor-pointer ${selectedId === itinerary.id
                                    ? 'border-blue-600 shadow-lg shadow-blue-600/10 ring-2 ring-blue-600/20'
                                    : 'border-slate-200 hover:border-blue-300'
                                    }`}
                            >
                                <div className="p-6">
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
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

                                        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                            {/* Budget & points: show warnings when over, or a single "Fits" when both within */}
                                            {itinerary.withinBudget === false && (
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">Over budget</span>
                                            )}
                                            {itinerary.withinPoints === false && (
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">Exceeds points</span>
                                            )}
                                            {itinerary.withinBudget === true && itinerary.withinPoints === true && (
                                                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Within budget & points</span>
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

                                    {/* Flight Cost Summary */}
                                    <div className="mb-6 grid grid-cols-3 gap-3 p-4 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <Plane className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Flights</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">${itinerary.totalCost.toLocaleString()}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">Cash cost</div>
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <Zap className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Points</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">{(itinerary.pointsCost / 1000).toFixed(0)}k</div>
                                            <div className="text-xs text-slate-500 mt-0.5">To use</div>
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                <TrendingUp className="w-4 h-4" />
                                                <span className="text-xs font-medium uppercase tracking-wider">Score</span>
                                            </div>
                                            <div className="text-2xl font-bold text-slate-900">{itinerary.score}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">Match quality</div>
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
                                                        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
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
                                    <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="text-sm font-medium text-emerald-900 mb-1">Estimated Savings</div>
                                                <div className="text-xs text-emerald-700">
                                                    Using points instead of cash could save you up to ${Math.round(itinerary.pointsCost * 0.015).toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="text-2xl font-bold text-emerald-700">
                                                {Math.round((itinerary.pointsCost * 0.015 / (itinerary.totalCost + itinerary.pointsCost * 0.015)) * 100)}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* Select Button */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedId(itinerary.id);
                                        }}
                                        className={`w-full mt-4 px-6 py-3 rounded-xl transition-all font-medium ${selectedId === itinerary.id
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                                            }`}
                                    >
                                        {selectedId === itinerary.id ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <Check className="w-5 h-5" /> Selected
                                            </span>
                                        ) : (
                                            'Select This Route'
                                        )}
                                    </button>

                                    {/* Book Button - Show when selected */}
                                    {selectedId === itinerary.id && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/solo/booking${tripId ? `?trip_id=${tripId}` : ''}`);
                                            }}
                                            className="w-full mt-3 px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold"
                                        >
                                            Book This Trip
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Right Sidebar - Selected Details */}
                    {selectedItinerary && (
                        <div data-testid="selected-route-sidebar" data-slot="selected-route-sidebar" className="lg:col-span-1">
                            <div className="sticky top-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                <h3 className="text-xl mb-6 text-slate-900 font-semibold">Selected Route</h3>

                                <div className="space-y-6">
                                    {/* Basic itinerary: where you'll stay (freemium teaser) */}
                                    <div>
                                        <div className="text-sm text-slate-600 mb-3 font-medium flex items-center gap-2">
                                            <Bed className="w-4 h-4" />
                                            Where you&apos;ll stay
                                        </div>
                                        <ul className="space-y-2">
                                            {selectedItinerary.cities.map((city, i) => (
                                                <li key={i} className="flex items-center gap-2 text-sm">
                                                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                                        {i + 1}
                                                    </span>
                                                    <span className="text-slate-900 font-medium">{city.name}</span>
                                                    <span className="text-slate-500">· {city.days} night{city.days !== 1 ? 's' : ''}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="mt-3 flex items-start gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                                            <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                            <p className="text-xs text-slate-600">
                                                Unlock day-by-day plan and hotel picks when you book.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Route order: full path (origin → … → end) when routeDisplay is set */}
                                    <div>
                                        <div className="text-sm text-slate-600 mb-2 font-medium">Route</div>
                                        <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                                            {(selectedItinerary.routeDisplay && selectedItinerary.routeDisplay.length > 0
                                                ? selectedItinerary.routeDisplay
                                                : selectedItinerary.cities.map((c) => c.name)
                                            ).map((label, i) => (
                                                <span key={i} className="flex items-center gap-1.5">
                                                    <span>{label}</span>
                                                    {i < (selectedItinerary.routeDisplay?.length ?? selectedItinerary.cities.length) - 1 && (
                                                        <ChevronRight className="w-4 h-4 text-slate-400" />
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-sm text-slate-600 mb-3 font-medium">Flight Cost</div>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between font-semibold">
                                                <span className="text-slate-900">Total</span>
                                                <span className="text-slate-900">${selectedItinerary.totalCost.toLocaleString()}</span>
                                            </div>
                                            {selectedItinerary.pointsCost > 0 && (
                                                <div className="flex justify-between text-blue-600">
                                                    <span>Points value</span>
                                                    <span>{(selectedItinerary.pointsCost / 1000).toFixed(0)}k pts</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <button
                                            onClick={() => router.push(`/solo/booking${tripId ? `?trip_id=${tripId}` : ''}`)}
                                            className="w-full px-6 py-3 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold"
                                        >
                                            Book This Trip
                                        </button>
                                        <button
                                            onClick={() => router.push(`/solo/comparison${tripId ? `?trip_id=${tripId}` : ''}`)}
                                            disabled={comparing.length === 0}
                                            className={`w-full px-6 py-3 rounded-xl transition-colors font-semibold ${
                                                comparing.length > 0
                                                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            {comparing.length > 0 ? `Compare ${comparing.length} Routes` : 'Compare Routes'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                )}
            </div>
        </div>
    );
}
