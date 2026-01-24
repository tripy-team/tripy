'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Edit3, Check, Sparkles, TrendingUp, Plane, Car, Bus, Train, Navigation, Calendar, Info } from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, points as pointsAPI, ItineraryItem, destinations } from '@/lib/api';

interface Itinerary {
    id: number;
    name: string;
    cities: Array<{ name: string; days: number }>;
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

/** Hotel OOP from optimize_hotels_out_of_pocket: best_overall has out_of_pocket, cash, points, surcharge */
interface OutOfPocketHotelsData {
    best_by_cash?: { cash?: number; out_of_pocket?: number } | null;
    best_by_points?: { surcharge?: number; out_of_pocket?: number } | null;
    best_overall?: { out_of_pocket?: number; cash?: number; points?: number; surcharge?: number } | null;
    destination?: string;
    check_in?: string;
    check_out?: string;
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
    const [smartTips, setSmartTips] = useState<SmartTips>(emptySmartTips);
    const [outOfPocket, setOutOfPocket] = useState<OutOfPocketData | null>(null);
    const [outOfPocketHotels, setOutOfPocketHotels] = useState<OutOfPocketHotelsData | null>(null);
    const [includeHotels, setIncludeHotels] = useState(true);
    const [userConstraints, setUserConstraints] = useState<{ maxBudget?: number; totalPoints: number; durationLabel: string; includeHotels: boolean } | null>(null);

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
                setSmartTips(emptySmartTips);
                setOutOfPocket(null);
                setOutOfPocketHotels(null);
                setUserConstraints(null);
                const [response, trip, pointsRes] = await Promise.all([
                    itinerariesAPI.get(tripId),
                    tripsAPI.get(tripId).catch(() => null),
                    pointsAPI.summary(tripId).catch(() => ({ totalPoints: 0, items: [] })),
                ]);
                const t = trip as { includeHotels?: boolean; maxBudget?: number; startDate?: string; endDate?: string; durationDays?: number } | null;
                const incHotels = t?.includeHotels !== false;
                setIncludeHotels(incHotels);

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
                    includeHotels: incHotels,
                });

                // Check for AI route suggestions (small/remote cities with no flight data)
                const aiItem = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'ai_route_suggestions');
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

                // Extract smart tips from itinerary_smart_tips item (when we have optimized itineraries)
                const tipsItem = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'itinerary_smart_tips');
                if (tipsItem && typeof tipsItem === 'object') {
                    const t = tipsItem as Record<string, unknown>;
                    setSmartTips({
                        transfer_tips: Array.isArray(t.transfer_tips) ? t.transfer_tips as SmartTips['transfer_tips'] : [],
                        sample_itineraries: Array.isArray(t.sample_itineraries) ? t.sample_itineraries as SmartTips['sample_itineraries'] : [],
                        holiday_advice: Array.isArray(t.holiday_advice) ? t.holiday_advice as SmartTips['holiday_advice'] : [],
                        practical_tips: Array.isArray(t.practical_tips) ? t.practical_tips as SmartTips['practical_tips'] : [],
                    });
                }

                // Out-of-pocket (simple A->B round-trip: best cash vs points+surcharge)
                const oopItem = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'out_of_pocket');
                if (oopItem && typeof oopItem === 'object') {
                    setOutOfPocket(oopItem as OutOfPocketData);
                } else {
                    setOutOfPocket(null);
                }

                // Hotel out-of-pocket (when trip has includeHotels): best cash vs points+surcharge
                const oopHotelsItem = response.items?.find((i: ItineraryItem & { type?: string }) => i.type === 'out_of_pocket_hotels');
                if (oopHotelsItem && typeof oopHotelsItem === 'object') {
                    setOutOfPocketHotels(oopHotelsItem as OutOfPocketHotelsData);
                } else {
                    setOutOfPocketHotels(null);
                }

                // Fetch destinations to map UUIDs to names
                const destinationsResponse = await destinations.list(tripId);
                const destinationMap = new Map<string, string>();
                destinationsResponse.destinations.forEach((dest) => {
                    destinationMap.set(dest.destinationId, dest.name);
                });

                // Transform API response (exclude non-itinerary types: ai_route_suggestions, itinerary_smart_tips, out_of_pocket, out_of_pocket_hotels, path, payments, totals)
                const regularItems = (response.items || []).filter(
                    (i: ItineraryItem & { type?: string }) => {
                        if (['ai_route_suggestions', 'itinerary_smart_tips', 'out_of_pocket', 'out_of_pocket_hotels', 'path', 'payments', 'totals'].includes(i.type || '')) return false;
                        const route = i.route || i.cities;
                        return Array.isArray(route) && route.length > 0;
                    }
                );
                if (regularItems.length > 0) {
                    let transformed: Itinerary[] = regularItems.map((item: ItineraryItem, index: number) => {
                        const route = item.route || item.cities || [];
                        const cities = Array.isArray(route)
                            ? route.map((city: string | { name: string; days: number }) => {
                                if (typeof city === 'string') {
                                    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city);
                                    const cityName = isUUID && destinationMap.has(city)
                                        ? destinationMap.get(city)!
                                        : (isUUID ? city : city);
                                    return { name: cityName, days: 3 };
                                }
                                if (city.name && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(city.name)) {
                                    const resolvedName = destinationMap.get(city.name) || city.name;
                                    return { name: resolvedName, days: city.days || 3 };
                                }
                                return city;
                            })
                            : [];

                        return {
                            id: index + 1,
                            name: item.name || `Itinerary ${index + 1}`,
                            cities: cities,
                            totalCost: item.totalCost || item.cost || 0,
                            pointsCost: item.pointsCost || item.points || 0,
                            score: item.score || 85,
                            withinBudget: item.withinBudget !== false,
                            withinPoints: item.withinPoints !== false,
                        };
                    });
                    // Sort: within budget and points first, then within budget, then rest
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
                console.error('Error fetching itineraries:', err);
                setItineraries([]);
            } finally {
                setLoading(false);
            }
        };

        fetchItineraries();
    }, [tripId]);

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

                // Recalculate costs using same formula as backend (aligned with includeHotels)
                const totalDays = newCities.reduce((sum, c) => sum + c.days, 0);
                const perDay = includeHotels ? 200 : 120;
                const perCity = includeHotels ? 300 : 200;
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

    // AI-suggested routes for small/remote cities (no flight search data)
    if (isAiSuggested && aiSuggestions.length > 0) {
        return (
            <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
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
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl mb-2 tracking-tight text-slate-900 font-bold">Your Routes</h1>
                        <p className="text-slate-600">
                            {itineraries.length === 0
                                ? 'No itineraries match your budget and points. Try adjusting your limits or destinations.'
                                : `We generated ${itineraries.length} itinerary option${itineraries.length === 1 ? '' : 's'} within your constraints`}
                        </p>
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
                        <span className="text-slate-600">Hotels: <strong className="text-slate-900">{userConstraints.includeHotels ? 'Included' : 'Not included'}</strong></span>
                    </div>
                )}

                {outOfPocket && <OutOfPocketBlock data={outOfPocket} />}

                {/* Empty state when no itineraries */}
                {itineraries.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
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
                    </div>
                ) : (
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

                                        <div className="flex flex-wrap items-center gap-2">
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
                                        onClick={async () => {
                                            setSelectedId(itinerary.id);
                                            // TODO: Save selected itinerary to backend
                                            // Endpoint: POST /itinerary/save (may need to be added)
                                            // Data: trip_id, itinerary_id/route_id
                                        }}
                                        className={`w-full mt-4 px-6 py-3 rounded-xl transition-all font-medium ${selectedId === itinerary.id
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                                            }`}
                                    >
                                        {selectedId === itinerary.id ? 'Selected' : 'Select This Route'}
                                    </button>

                                    {/* Book Button - Show when selected */}
                                    {selectedId === itinerary.id && (
                                        <button
                                            onClick={() => {
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
                                            {(() => {
                                                const flightsPart = selectedItinerary.totalCost * (includeHotels ? 0.4 : 0.65);
                                                const hotelOop = includeHotels
                                                    ? (outOfPocketHotels?.best_overall?.out_of_pocket ?? outOfPocketHotels?.best_overall?.cash)
                                                    : null;
                                                const hotelsPart = includeHotels
                                                    ? (hotelOop ?? selectedItinerary.totalCost * 0.35)
                                                    : 0;
                                                const activitiesPart = selectedItinerary.totalCost * (includeHotels ? 0.25 : 0.35);
                                                const total = flightsPart + hotelsPart + activitiesPart;
                                                return (
                                                    <>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Flights</span>
                                                            <span className="text-slate-900 font-medium">${Math.round(flightsPart).toLocaleString()}</span>
                                                        </div>
                                                        {includeHotels && (
                                                            <div className="flex justify-between">
                                                                <span className="text-slate-600">Hotels</span>
                                                                <span className="text-slate-900 font-medium">
                                                                    ${Math.round(hotelsPart).toLocaleString()}
                                                                    {hotelOop != null && <span className="text-emerald-600 text-xs ml-1">(live)</span>}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Activities</span>
                                                            <span className="text-slate-900 font-medium">${Math.round(activitiesPart).toLocaleString()}</span>
                                                        </div>
                                                        <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold">
                                                            <span className="text-slate-900">Total</span>
                                                            <span className="text-slate-900">${Math.round(total).toLocaleString()}</span>
                                                        </div>
                                                    </>
                                                );
                                            })()}
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
                <SmartTipsBlock tips={smartTips} />
            </div>
        </div>
    );
}
