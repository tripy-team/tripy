'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, DollarSign, Clock, Zap, Edit3, Check, Sparkles, TrendingUp, Plane, Car, Bus, Train, Navigation, Info, Bed, ChevronRight, Lock, ChevronDown, ChevronUp, Mail } from 'lucide-react';
import { solo, trips as tripsAPI, points as pointsAPI, itineraries as itinerariesAPI, ItineraryItem, destinations, type Trip, type SoloRankedItinerary, type SoloOptimizeResponse, type StructuredWarnings, isAuthenticated } from '@/lib/api';
import { formatAirportDisplay, getCityMapForCodes, isLikelyAirportCode } from '@/lib/airport-formatter';
import { formatProgramName } from '@/lib/programLabels';
import { PolicyWarnings } from '@/components/policy/PolicyWarnings';
import { TripGenerationLoader } from '@/components/ui/TripGenerationLoader';
import DecisionHeader from '@/components/DecisionHeader';
import WhyNotOthers from '@/components/WhyNotOthers';
import RiskBadge from '@/components/RiskBadge';
import HotelRecommendationCard from '@/components/HotelRecommendationCard';
import { trackEvent, EVENTS } from '@/lib/analytics';

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
    // Prefer trip_id from URL; fall back to sessionStorage then localStorage
    // (localStorage survives sign-in/sign-up redirects that may lose query params).
    const tripIdFromUrl = searchParams?.get('trip_id') || '';
    const tripId = tripIdFromUrl || (typeof window !== 'undefined'
        ? sessionStorage.getItem('tripy_last_trip_id') || localStorage.getItem('tripy_last_trip_id') || ''
        : '');
    const shareToken = searchParams?.get('share_token') || '';

    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [soloItineraries, setSoloItineraries] = useState<SoloRankedItinerary[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedSoloId, setSelectedSoloId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [comparing, setComparing] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [aiSuggestions, setAiSuggestions] = useState<AIRouteSuggestion[]>([]);
    const [isAiSuggested, setIsAiSuggested] = useState(false);
    const [outOfPocket, setOutOfPocket] = useState<OutOfPocketData | null>(null);
    const [userConstraints, setUserConstraints] = useState<{ maxBudget?: number; totalPoints: number; durationLabel: string } | null>(null);
    const [relaxedMessage, setRelaxedMessage] = useState<string | null>(null);
    const [trip, setTrip] = useState<Trip | null>(null);
    const [partySize, setPartySize] = useState<{ adults: number; children: number; total: number }>({ adults: 1, children: 0, total: 1 });
    const [refetchTrigger, setRefetchTrigger] = useState(0);
    const [budgetWarning, setBudgetWarning] = useState<{ message?: string; user_budget?: number; recommended_budget?: number } | null>(null);
    const [optimizationWarning, setOptimizationWarning] = useState<string | null>(null);
    const [fallbackWarning, setFallbackWarning] = useState<string | null>(null);
    const [structuredWarnings, setStructuredWarnings] = useState<StructuredWarnings | null>(null);
    const [usingSoloOptimizer, setUsingSoloOptimizer] = useState(false);
    const [optimizeResponse, setOptimizeResponse] = useState<SoloOptimizeResponse | null>(null);
    
    // Track when API data is ready (for loader completion animation)
    const [apiComplete, setApiComplete] = useState(false);
    
    // Decision confidence states
    const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
    const [calmnessVote, setCalmnessVote] = useState<'yes' | 'no' | null>(null);
    const [showFeedbackInput, setShowFeedbackInput] = useState(false);
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

    // Build a fingerprint string for a solo itinerary (used for dedup and diff-detection).
    const itineraryFingerprint = (itin: SoloRankedItinerary): string => {
        const segKey = (itin.segments || [])
            .map((s) => `${s.origin}-${s.destination}|${s.airline}|${s.flightNumber || ''}|${s.departureTime || ''}`)
            .join(';;');
        const oop = itin.oopMetrics?.totalOutOfPocket ?? 0;
        return `${(itin.route || []).join(',')}||${segKey}||${Math.round(oop * 100)}`;
    };

    // Deduplicate itineraries that share the same route + segments + OOP.
    // This handles cached results that were stored before backend dedup was added.
    const deduplicateItineraries = (items: SoloRankedItinerary[]): SoloRankedItinerary[] => {
        const seen = new Set<string>();
        return items.filter((itin) => {
            const fp = itineraryFingerprint(itin);
            if (seen.has(fp)) return false;
            seen.add(fp);
            return true;
        });
    };

    // Compare two arrays of solo itineraries by fingerprint to detect meaningful changes.
    const soloItinerariesChanged = (prev: SoloRankedItinerary[], next: SoloRankedItinerary[]): boolean => {
        if (prev.length !== next.length) return true;
        const prevFps = prev.map(itineraryFingerprint).sort();
        const nextFps = next.map(itineraryFingerprint).sort();
        return prevFps.some((fp, i) => fp !== nextFps[i]);
    };

    useEffect(() => {
        const fetchItineraries = async () => {
            if (!tripId) {
                setLoading(false);
                return;
            }

            // Track whether the solo optimizer succeeded so the loader can
            // play its completion animation before we hide it.
            let loaderHandlesTransition = false;

            // Only show loading spinner & reset state on first load (no data yet).
            // On subsequent loads we fetch in the background and diff the results.
            const isFirstLoad = soloItineraries.length === 0 && itineraries.length === 0;

            try {
                if (isFirstLoad) {
                    setLoading(true);
                    setApiComplete(false);
                    setAiSuggestions([]);
                    setIsAiSuggested(false);
                    setOutOfPocket(null);
                    setUserConstraints(null);
                    setRelaxedMessage(null);
                    setBudgetWarning(null);
                    setOptimizationWarning(null);
                    setFallbackWarning(null);
                    setUsingSoloOptimizer(false);
                    setSoloItineraries([]);
                }
                
                // ============================================================
                // Shared plan path: use the public endpoint when share_token
                // is present (e.g. magic-link emails opened on another device
                // where the user is not logged in).
                // ============================================================
                if (shareToken) {
                    try {
                        const shared = await solo.getSharedPlan(shareToken);
                        if (shared?.ok && shared.trip) {
                            const tripData = shared.trip;
                            setTrip(tripData as unknown as Trip);

                            // Extract party size
                            const adults = tripData.adults || 1;
                            const children = tripData.children || 0;
                            setPartySize({ adults, children, total: adults + children });

                            // Build duration label
                            let durationLabel = '—';
                            if (tripData.startDate && tripData.endDate) {
                                const start = new Date(tripData.startDate);
                                const end = new Date(tripData.endDate);
                                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                                    const d = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                                    if (d > 0) durationLabel = `${d} days`;
                                }
                            } else if (tripData.durationDays != null && tripData.durationDays > 0) {
                                durationLabel = `${tripData.durationDays} days (flexible)`;
                            }

                            setUserConstraints({
                                maxBudget: tripData.maxBudget,
                                totalPoints: 0,
                                durationLabel,
                            });

                            // Use cached optimization from the shared response
                            const optimizeResult = shared.optimization;
                            if (optimizeResult && optimizeResult.itineraries && optimizeResult.itineraries.length > 0) {
                                setOptimizeResponse(optimizeResult);
                                const uniqueItineraries = deduplicateItineraries(optimizeResult.itineraries);
                                setSoloItineraries(uniqueItineraries);
                                setSelectedSoloId(optimizeResult.bestOption || uniqueItineraries[0].id);
                                setUsingSoloOptimizer(true);

                                if (optimizeResult.structuredWarnings) {
                                    setStructuredWarnings(optimizeResult.structuredWarnings);
                                } else if (optimizeResult.warnings && optimizeResult.warnings.length > 0) {
                                    setOptimizationWarning(optimizeResult.warnings.join(' '));
                                }

                                const itin = optimizeResult.itineraries[0];
                                if (itin.budgetWarning) {
                                    const oopCost = itin.oopMetrics?.totalOutOfPocket;
                                    setBudgetWarning({
                                        message: itin.budgetWarning,
                                        user_budget: tripData.maxBudget,
                                        recommended_budget: oopCost ? Math.ceil(oopCost) : undefined,
                                    });
                                }

                                trackEvent(EVENTS.TRIP_RESULT_VIEWED, {
                                    tripId,
                                    itineraryCount: optimizeResult.itineraries.length,
                                    hasDecisionSummary: !!optimizeResult.decisionSummary,
                                    shared: true,
                                });

                                loaderHandlesTransition = true;
                                setApiComplete(true);
                                return;
                            }
                        }
                        // If shared endpoint didn't return optimization, fall through
                        // to the normal flow (user may be logged in on this device too).
                    } catch (sharedErr) {
                        console.log('[SoloResults] Shared plan fetch failed, falling back to authenticated flow:', sharedErr);
                    }
                }

                // Try the new solo optimizer first
                let usedSoloOptimizer = false;
                try {
                    // Get trip and points info
                    const [tripData, pointsSummary] = await Promise.all([
                        solo.getTrip(tripId).catch(() => null),
                        solo.getPoints(tripId).catch(() => ({ items: [], totalPoints: 0, tripId })),
                    ]);
                    
                    if (tripData) {
                        // Build points map from the points summary
                        // Only include points the user actually has - do NOT auto-assign default points
                        const pointsMap: Record<string, number> = {};
                        for (const item of pointsSummary.items || []) {
                            if (item.program && item.balance > 0) {
                                pointsMap[item.program] = item.balance;
                            }
                        }
                        
                        // If user has no points, that's fine - the optimizer will find cash-only routes
                        if (Object.keys(pointsMap).length === 0) {
                            console.log('No points stored for this trip - optimizer will find cash-only routes');
                        }
                        
                        // SELECTION-FIRST: If the user already selected an itinerary,
                        // restore it from the snapshot (instant, no optimization needed).
                        let optimizeResult: SoloOptimizeResponse | null = null;
                        try {
                            const selection = await solo.getSelection(tripId);
                            if (selection?.ok && selection.itinerarySnapshot) {
                                const snapshot = selection.itinerarySnapshot as SoloRankedItinerary;
                                if (snapshot.route && snapshot.segments) {
                                    optimizeResult = {
                                        itineraries: [snapshot],
                                        bestOption: snapshot.id || selection.itineraryId,
                                        warnings: [],
                                        globalInsights: snapshot.insights || [],
                                        cached: true,
                                        computedAt: selection.selectedAt || '',
                                        expiresAt: '',
                                    };
                                    console.log('[SoloResults] Using saved selection (selected at:', selection.selectedAt, ')');
                                }
                            }
                        } catch {
                            console.log('[SoloResults] No selection available');
                        }

                        // CACHE-SECOND: Try cached results (including stale) before running optimization
                        if (!optimizeResult) {
                            try {
                                const cached = await solo.getOptimizationCache(tripId, { allowStale: true });
                                if (cached && cached.itineraries && cached.itineraries.length > 0) {
                                    optimizeResult = cached;
                                    console.log('[SoloResults] Using cached results (expires:', cached.expiresAt, ')');
                                }
                            } catch {
                                console.log('[SoloResults] No cache available, will optimize');
                            }
                        }
                        
                        // Only run optimization if no saved results exist
                        if (!optimizeResult) {
                            const storedPayerPoints = sessionStorage.getItem(`payer_points_${tripId}`);
                            const payerPoints = storedPayerPoints ? JSON.parse(storedPayerPoints) as Record<string, Record<string, number>> : undefined;

                            // Use async + polling path — dodges API Gateway's 30s cap.
                            // Cache hits still return inline (first call) so this is
                            // fast in the common case.
                            optimizeResult = await solo.optimizeWithPolling(
                                {
                                    tripId,
                                    points: pointsMap,
                                    ...(payerPoints ? { payerPoints } : {}),
                                    // If this run is a user-triggered refresh, force a fresh search.
                                    forceRefresh: refetchTrigger > 0,
                                },
                                {
                                    pollIntervalMs: 2000,
                                    timeoutMs: 5 * 60 * 1000,
                                },
                            );
                        }
                        
                        trackEvent(EVENTS.TRIP_RESULT_VIEWED, { tripId, itineraryCount: optimizeResult.itineraries?.length || 0, hasDecisionSummary: !!optimizeResult.decisionSummary });

                        if (optimizeResult.itineraries && optimizeResult.itineraries.length > 0) {
                            const uniqueItineraries = deduplicateItineraries(optimizeResult.itineraries);

                            // On subsequent loads, only update if the itineraries actually changed.
                            // This avoids re-rendering the whole page when the same cached data returns.
                            const dataChanged = isFirstLoad || soloItinerariesChanged(soloItineraries, uniqueItineraries);

                            if (dataChanged) {
                                setOptimizeResponse(optimizeResult);
                                setSoloItineraries(uniqueItineraries);
                                setSelectedSoloId(optimizeResult.bestOption || uniqueItineraries[0].id);
                                setUsingSoloOptimizer(true);
                            }
                            usedSoloOptimizer = true;

                            // Set warnings from optimizer (prefer structured, fall back to flat)
                            if (dataChanged) {
                                if (optimizeResult.structuredWarnings) {
                                    setStructuredWarnings(optimizeResult.structuredWarnings);
                                } else if (optimizeResult.warnings && optimizeResult.warnings.length > 0) {
                                    // Backward compat: join flat warnings (legacy path)
                                    setOptimizationWarning(optimizeResult.warnings.join(' '));
                                }

                                // Check for budget warnings in itineraries (when budget was infeasible)
                                const itin = optimizeResult.itineraries[0];
                                if (itin.budgetWarning) {
                                    // Extract budget info from the warning if available
                                    const userBudget = (tripData as { maxBudget?: number }).maxBudget;
                                    const oopCost = itin.oopMetrics?.totalOutOfPocket;
                                    setBudgetWarning({
                                        message: itin.budgetWarning,
                                        user_budget: userBudget,
                                        recommended_budget: oopCost ? Math.ceil(oopCost) : undefined,
                                    });
                                }
                            }

                            // Always update trip metadata (cheap and avoids stale context)
                            let durationLabel = '—';
                            const startDate = (tripData as { startDate?: string }).startDate;
                            const endDate = (tripData as { endDate?: string }).endDate;
                            const durationDays = (tripData as { durationDays?: number }).durationDays;

                            if (startDate && endDate) {
                                const start = new Date(startDate);
                                const end = new Date(endDate);
                                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                                    const d = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                                    if (d > 0) durationLabel = `${d} days`;
                                }
                            } else if (durationDays != null && durationDays > 0) {
                                durationLabel = `${durationDays} days (flexible)`;
                            }

                            setTrip(tripData as Trip);

                            // Extract party size from trip data
                            const adults = (tripData as { adults?: number }).adults || 1;
                            const children = (tripData as { children?: number }).children || 0;
                            setPartySize({ adults, children, total: adults + children });

                            setUserConstraints({
                                maxBudget: (tripData as { maxBudget?: number }).maxBudget,
                                totalPoints: pointsSummary.totalPoints,
                                durationLabel,
                            });

                            // Signal the loader to play its completion animation
                            // (onComplete callback will set loading=false after animation)
                            if (isFirstLoad) {
                                loaderHandlesTransition = true;
                                setApiComplete(true);
                            }
                            return;
                        }
                    }
                } catch (soloErr) {
                    console.log('[SoloResults] Solo optimizer error:', soloErr);
                    // Check if it's a 503 (service unavailable) — show friendly message
                    const errMsg = soloErr instanceof Error ? soloErr.message : String(soloErr);
                    if (errMsg.includes('503') || errMsg.includes('temporarily unavailable')) {
                        setOptimizationWarning(
                            'Flight search is temporarily unavailable. Please try again in a few minutes. ' +
                            'This usually resolves quickly.'
                        );
                        setLoading(false);
                        return;
                    }
                    // Other errors: fall through to legacy
                    console.log('[SoloResults] Falling back to legacy optimizer');
                }
                
                // Fall back to legacy itineraries API
                if (!usedSoloOptimizer) {
                const [response, trip, pointsRes] = await Promise.all([
                    tripsAPI.get(tripId).catch(() => null),
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
                // Note: tripsAPI.get returns Trip, so we need to cast for potential items
                const responseWithItems = response as Trip & { items?: (ItineraryItem & { type?: string })[] } | null;
                const aiItem = responseWithItems?.items?.find((i) => i.type === 'ai_route_suggestions');
                if (aiItem && (aiItem as { suggestions?: AIRouteSuggestion[] }).suggestions?.length) {
                    setAiSuggestions((aiItem as { suggestions: AIRouteSuggestion[] }).suggestions);
                    setIsAiSuggested(true);
                    setItineraries([]);
                    setLoading(false);
                    return;
                }

                // Helper: extract OOP/relaxed from a response (get returns in items; generate can have top-level or in items)
                const pickOop = (r: { items?: unknown[]; out_of_pocket?: OutOfPocketData } | null) =>
                    r ? ((r.items?.find((i: unknown) => (i as { type?: string })?.type === 'out_of_pocket') as OutOfPocketData | undefined) || r.out_of_pocket || null) : null;
                const pickRelaxed = (r: { items?: unknown[]; relaxed_message?: string } | null) => {
                    if (!r) return null;
                    const it = r.items?.find((i: unknown) => (i as { type?: string })?.type === 'itinerary_relaxed_info') as { message?: string } | undefined;
                    return (it && typeof it.message === 'string' ? it.message : null) || r.relaxed_message || null;
                };

                // Out-of-pocket (simple A->B round-trip: best cash vs points+surcharge)
                setOutOfPocket(pickOop(responseWithItems));
                // Relaxed-constraints banner (when no feasible solution; we show a similar route)
                setRelaxedMessage(pickRelaxed(responseWithItems));
                
                // Extract warnings from response items
                const budgetWarn = responseWithItems?.items?.find((i) => i.type === 'budget_warning') as { message?: string; user_budget?: number; recommended_budget?: number } | undefined;
                setBudgetWarning(budgetWarn || null);
                
                const optWarn = responseWithItems?.items?.find((i) => i.type === 'optimization_warning') as { message?: string } | undefined;
                setOptimizationWarning(optWarn?.message || null);
                
                const fallWarn = responseWithItems?.items?.find((i) => i.type === 'fallback_warning') as { message?: string } | undefined;
                setFallbackWarning(fallWarn?.message || null);

                // Fetch destinations to map UUIDs to names
                const destinationsResponse = await destinations.list(tripId);
                const destinationMap = new Map<string, string>();
                destinationsResponse.destinations.forEach((dest) => {
                    destinationMap.set(dest.destinationId, dest.name);
                });

                // Transform API response (exclude non-itinerary types: ai_route_suggestions, itinerary_smart_tips, out_of_pocket, out_of_pocket_hotels, payments, totals, warnings)
                // Include 'path' (optimized ILP routes) and 'itinerary' (simple generator); path has route/path with airport codes
                const regularItems = (responseWithItems?.items || []).filter(
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
            } // End of if (!usedSoloOptimizer)
        } catch (err) {
            console.error('Error fetching itineraries:', err);
            setItineraries([]);
        } finally {
            // Only hide loader immediately for error/fallback paths.
            // When the solo optimizer succeeds, the TripGenerationLoader
            // plays its completion animation first, then calls onComplete
            // which sets loading=false.
            // On background refreshes (non-first loads) we never set loading=true,
            // so there is nothing to reset.
            if (isFirstLoad && !loaderHandlesTransition) {
                setLoading(false);
            }
        }
    };

        fetchItineraries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tripId, shareToken, refetchTrigger]);

    const stepIcon = (method: string) => {
        const m = (method || '').toLowerCase();
        if (m.includes('fly') || m.includes('flight')) return <Plane className="w-4 h-4 text-blue-600" />;
        if (m.includes('drive') || m.includes('car')) return <Car className="w-4 h-4 text-amber-600" />;
        if (m.includes('bus')) return <Bus className="w-4 h-4 text-green-600" />;
        if (m.includes('train') || m.includes('rail')) return <Train className="w-4 h-4 text-slate-600" />;
        return <Navigation className="w-4 h-4 text-slate-500" />;
    };

    const selectedItinerary = itineraries.find(i => i.id === selectedId);
    const selectedSoloItinerary = soloItineraries.find(i => i.id === selectedSoloId);

    // Compute points range across all itineraries for display
    const soloPointsRange = (() => {
        const allPoints = soloItineraries
            .map(it => it.oopMetrics.totalPointsUsed || it.bookingDetails?.totalPoints || 0)
            .filter(p => p > 0);
        if (allPoints.length === 0) return { min: 0, max: 0 };
        return { min: Math.min(...allPoints), max: Math.max(...allPoints) };
    })();
    
    // Handle selecting a solo itinerary and storing it
    const handleSelectSoloItinerary = async (itinerary: SoloRankedItinerary) => {
        setSelectedSoloId(itinerary.id);
        
        // Store the selection with snapshot for later booking
        try {
            if (!Array.isArray((itinerary as unknown as { segments?: unknown }).segments) || (itinerary as unknown as { segments?: unknown[] }).segments!.length === 0) {
                setFallbackWarning('Cannot select this route (missing required booking data). Please retry optimization.');
                return;
            }
            const itinerarySnapshot = {
                ...itinerary,
                // Schema versioning for backend snapshot validator
                snapshotVersion: 1,
                // Explicit id alias for backend normalization
                itineraryId: itinerary.id,
            };
            await solo.selectItinerary(tripId, {
                itineraryId: itinerary.id,
                itinerarySnapshot,
                cashPriceAtSelection: itinerary.oopMetrics.totalCashPrice,
                outOfPocketAtSelection: itinerary.oopMetrics.totalOutOfPocket,
            });
        } catch (err) {
            console.error('Error saving itinerary selection:', err);
        }
    };

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
                className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white"
            >
                <TripGenerationLoader 
                    isVisible={true}
                    isComplete={apiComplete}
                    onComplete={() => setLoading(false)}
                />
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

    // Track calmness vote (Task 17)
    const handleCalmnessVote = (vote: 'yes' | 'no') => {
        if (vote === 'no') {
            setShowFeedbackInput(true);
            trackEvent(EVENTS.CALMNESS_VOTE, { vote, tripId });
            return;
        }
        setCalmnessVote(vote);
        trackEvent(EVENTS.CALMNESS_VOTE, { vote, tripId });
    };

    const handleFeedbackSubmit = async () => {
        const trimmed = feedbackText.trim();
        if (trimmed) {
            trackEvent(EVENTS.CALMNESS_VOTE, { vote: 'no', tripId, feedback: trimmed });

            // Send feedback email via API (fire-and-forget)
            try {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                const token = typeof sessionStorage !== 'undefined'
                    ? sessionStorage.getItem('access_token') || localStorage.getItem('access_token')
                    : null;
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                } else {
                    const anonId = localStorage.getItem('tripy_anon_session_id');
                    if (anonId) headers['X-Anon-Session-Id'] = anonId;
                }

                fetch('/api/feedback', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ feedback: trimmed, trip_id: tripId }),
                }).catch((err) => console.error('Feedback API error:', err));
            } catch (err) {
                console.error('Feedback submission error:', err);
            }
        }
        setFeedbackSubmitted(true);
        setCalmnessVote('no');
    };

    return (
        <div data-testid="solo-results-page" data-slot="SoloResults" className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-7xl mx-auto">
                {/* DECISION CONFIDENCE HEADER — shown FIRST, before any prices or details */}
                {usingSoloOptimizer && optimizeResponse?.decisionSummary && (
                    <>
                        <DecisionHeader
                            summary={optimizeResponse.decisionSummary}
                            onBookPlan={() => {
                                const bestItinerary = soloItineraries[0];
                                const usesPoints = bestItinerary && (bestItinerary.oopMetrics?.totalPointsUsed ?? 0) > 0;
                                router.push(usesPoints ? `/solo/payment?trip_id=${tripId}` : `/solo/booking?trip_id=${tripId}`);
                            }}
                        />
                    </>
                )}

                {/* Fallback header for non-solo optimizer or when no decision summary */}
                {(!usingSoloOptimizer || !optimizeResponse?.decisionSummary) && (
                <div data-testid="solo-results-header" className="mb-8">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-4xl tracking-tight text-slate-900 font-bold">Your Recommendation</h1>
                            <p className="text-slate-600 mt-1">
                                {itineraries.length === 0 && !budgetWarning
                                    ? 'No itineraries match your budget and points. Try adjusting your limits or destinations.'
                                    : itineraries.length === 0 && budgetWarning
                                    ? 'We found the closest option to your budget.'
                                    : budgetWarning
                                    ? 'We found the closest option to your budget — see below for details'
                                    : itineraries.length === 1
                                    ? 'We generated 1 itinerary that fits your budget and points'
                                    : `Choose from ${itineraries.length} personalized itineraries — each showing out-of-pocket costs and points needed`}
                            </p>
                        </div>
                    </div>
                </div>
                )}

                {/* Edit Search Parameters bar */}
                {!loading && tripId && (
                    <div className="mb-6 flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600 min-w-0 overflow-hidden">
                            <Plane className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            <span className="truncate">
                                {trip ? (
                                    <>
                                        {(trip as unknown as { origin?: string }).origin?.split(',')[0] || '—'}
                                        {' → '}
                                        {((trip as unknown as { destinations?: string[] }).destinations || []).join(' → ')}
                                        {(trip as unknown as { tripType?: string }).tripType === 'round_trip' && ` → ${(trip as unknown as { origin?: string }).origin?.split(',')[0] || ''}`}
                                        {(trip as unknown as { startDate?: string }).startDate && (
                                            <span className="text-slate-400 ml-2">
                                                · {(trip as unknown as { startDate?: string }).startDate}
                                                {(trip as unknown as { endDate?: string }).endDate && ` – ${(trip as unknown as { endDate?: string }).endDate}`}
                                            </span>
                                        )}
                                        {userConstraints?.maxBudget && (
                                            <span className="text-slate-400 ml-2">· Budget: ${userConstraints.maxBudget.toLocaleString()}</span>
                                        )}
                                    </>
                                ) : 'Your search parameters'}
                            </span>
                        </div>
                        <button
                            onClick={() => router.push(`/solo/setup?trip_id=${tripId}`)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0 ml-3"
                        >
                            <Edit3 className="w-4 h-4" />
                            Edit Search
                        </button>
                    </div>
                )}

                {/* Warnings for solo optimizer are shown below cards; for legacy path, show above */}
                {!usingSoloOptimizer && (
                <>
                {relaxedMessage && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-900">{relaxedMessage}</p>
                    </div>
                )}

                {/* ===== STRUCTURED WARNINGS (preferred) ===== */}
                {structuredWarnings ? (
                    <div className="space-y-4 mb-6">
                        {structuredWarnings.budget && (
                            <div className="p-5 bg-red-50 border-2 border-red-300 rounded-xl">
                                <div className="flex items-start gap-3 mb-3">
                                    <Info className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <h3 className="font-semibold text-red-900 mb-2">{structuredWarnings.budget.headline}</h3>
                                        <p className="text-sm text-red-800">{structuredWarnings.budget.message}</p>
                                    </div>
                                </div>
                                {structuredWarnings.budget.details?.user_budget != null && structuredWarnings.budget.details?.suggested_budget != null && (
                                    <div className="mt-3 pt-3 border-t border-red-200 grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <div className="text-red-600 font-medium">Your Budget</div>
                                            <div className="text-lg font-bold text-red-900">${(structuredWarnings.budget.details.user_budget as number).toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div className="text-green-600 font-medium">Recommended</div>
                                            <div className="text-lg font-bold text-green-900">${(structuredWarnings.budget.details.suggested_budget as number).toLocaleString()}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {structuredWarnings.points && (
                            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-amber-900 mb-1">{structuredWarnings.points.headline}</h3>
                                    <p className="text-sm text-amber-800">{structuredWarnings.points.message}</p>
                                </div>
                            </div>
                        )}
                        {structuredWarnings.estimation && (
                            <div className="p-4 bg-blue-50 border border-blue-300 rounded-xl flex items-start gap-3">
                                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-blue-900 mb-1">{structuredWarnings.estimation.headline}</h3>
                                    <p className="text-sm text-blue-800">{structuredWarnings.estimation.message}</p>
                                </div>
                            </div>
                        )}
                        {structuredWarnings.degradation && (
                            <div className={`p-4 rounded-xl flex items-start gap-3 ${
                                structuredWarnings.degradation.severity === 'error'
                                    ? 'bg-red-50 border border-red-300'
                                    : 'bg-amber-50 border border-amber-300'
                            }`}>
                                <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                                    structuredWarnings.degradation.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                                }`} />
                                <div>
                                    <h3 className={`font-semibold mb-1 ${
                                        structuredWarnings.degradation.severity === 'error' ? 'text-red-900' : 'text-amber-900'
                                    }`}>{structuredWarnings.degradation.headline}</h3>
                                    <p className={`text-sm ${
                                        structuredWarnings.degradation.severity === 'error' ? 'text-red-800' : 'text-amber-800'
                                    }`}>{structuredWarnings.degradation.message}</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
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
                        {optimizationWarning && (
                            <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-amber-900 mb-1">Things to Know</h3>
                                    <p className="text-sm text-amber-800">{optimizationWarning}</p>
                                </div>
                            </div>
                        )}
                        {fallbackWarning && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl flex items-start gap-3">
                                <Info className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-red-900 mb-1">Unable to Generate Itinerary</h3>
                                    <p className="text-sm text-red-800">{fallbackWarning}</p>
                                </div>
                            </div>
                        )}
                    </>
                )}
                </>
                )}

                {outOfPocket && <OutOfPocketBlock data={outOfPocket} />}

                {/* New Solo Optimizer Results */}
                {usingSoloOptimizer && soloItineraries.length > 0 ? (
                <>
                    <div className="grid lg:grid-cols-3 gap-6">
                        {/* Solo Itinerary Cards */}
                        <div data-testid="solo-itinerary-list" data-slot="solo-itinerary-list" className="lg:col-span-2 space-y-6">
                            {soloItineraries.map((itinerary) => {
                                const isSelected = selectedSoloId === itinerary.id;
                                const isDisabled = Boolean(itinerary.disabled);
                                const metrics = itinerary.oopMetrics;
                                
                                return (
                                    <div
                                        key={itinerary.id}
                                        data-testid={`solo-itinerary-card-${itinerary.id}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => { if (!isDisabled) setSelectedSoloId(itinerary.id); }}
                                        onKeyDown={(e) => { if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedSoloId(itinerary.id); } }}
                                        className={`bg-white border-2 rounded-2xl overflow-hidden transition-all shadow-sm ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${
                                            isSelected
                                                ? 'border-blue-600 shadow-lg shadow-blue-600/10 ring-2 ring-blue-600/20'
                                                : 'border-slate-200 hover:border-blue-300'
                                        }`}
                                    >
                                        <div className="p-6">
                                            {/* Budget Warning Banner - shown when itinerary exceeds budget */}
                                            {itinerary.budgetWarning && (
                                                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                                                    <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                                    <div className="text-sm text-amber-800">
                                                        <span className="font-medium">Over Budget:</span> {itinerary.budgetWarning}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <h3 className="text-2xl text-slate-900 font-semibold">{itinerary.displayName}</h3>
                                                        {itinerary.budgetWarning ? (
                                                            <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">
                                                                Closest Option
                                                            </span>
                                                        ) : itinerary.rank === 1 && (
                                                            <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                                                                <Sparkles className="w-3 h-3 inline mr-1" />
                                                                Best match
                                                            </span>
                                                        )}
                                                        {/* Risk Badge (Task 5) */}
                                                        {itinerary.risk && (
                                                            <RiskBadge risk={itinerary.risk} variant="badge" />
                                                        )}
                                                    </div>
                                                    
                                                </div>
                                                {/* Only show savings when points are actually used AND out-of-pocket is less than cash price */}
                                                {metrics.savingsPercentage > 0 && metrics.totalPointsUsed > 0 && metrics.cashSaved > 0 && metrics.totalOutOfPocket < metrics.totalCashPrice && (
                                                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                                                        {Math.round(metrics.savingsPercentage)}% savings
                                                    </span>
                                                )}
                                            </div>

                                            {/* Cost Summary */}
                                            {(() => {
                                                // Use multiple sources for points: oopMetrics (primary), bookingDetails (fallback)
                                                const pointsNeeded = metrics.totalPointsUsed
                                                    || itinerary.bookingDetails?.totalPoints
                                                    || 0;
                                                return (
                                            <div className="mb-6 p-4 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                            <DollarSign className="w-4 h-4" />
                                                            <span className="text-xs font-medium uppercase tracking-wider">Cash Price</span>
                                                        </div>
                                                        <div className="text-2xl font-bold text-slate-900">
                                                            {metrics.totalCashPrice > 0 ? `$${Math.round(metrics.totalCashPrice).toLocaleString()}` : 'See checkout'}
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5">Without points</div>
                                                    </div>

                                                    <div>
                                                        <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                            <DollarSign className="w-4 h-4" />
                                                            <span className="text-xs font-medium uppercase tracking-wider">You Pay</span>
                                                        </div>
                                                        <div className="text-2xl font-bold text-emerald-600">
                                                            {metrics.totalOutOfPocket > 0 ? `$${Math.round(metrics.totalOutOfPocket).toLocaleString()}` : (metrics.totalCashPrice > 0 ? `$${Math.round(metrics.totalCashPrice).toLocaleString()}` : 'See checkout')}
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5">
                                                            {partySize.total > 1 ? (
                                                                <>Total for {partySize.adults} adult{partySize.adults !== 1 ? 's' : ''}{partySize.children > 0 && `, ${partySize.children} child${partySize.children !== 1 ? 'ren' : ''}`}</>
                                                            ) : (
                                                                'Out-of-pocket'
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Points breakdown */}
                                                {pointsNeeded > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-blue-200/50 grid grid-cols-2 gap-3">
                                                        <div>
                                                            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                                                <Zap className="w-3.5 h-3.5 text-blue-500" />
                                                                <span className="text-xs font-medium uppercase tracking-wider">Points Needed</span>
                                                            </div>
                                                            <div className="text-lg font-bold text-blue-700">
                                                                {(() => {
                                                                    const fmtPts = (v: number) => v >= 1000
                                                                        ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
                                                                        : v.toLocaleString();
                                                                    if (soloPointsRange.min > 0 && soloPointsRange.max > 0 && soloPointsRange.min !== soloPointsRange.max) {
                                                                        return `${fmtPts(soloPointsRange.min)} – ${fmtPts(soloPointsRange.max)}`;
                                                                    }
                                                                    return fmtPts(pointsNeeded);
                                                                })()}
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-0.5">Points range across options</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Why points aren't being used notice */}
                                                {pointsNeeded === 0 && metrics.totalOutOfPocket >= metrics.totalCashPrice && metrics.totalCashPrice > 0 && (() => {
                                                    const reasons = (structuredWarnings?.points?.details?.reasons ?? []) as string[];
                                                    const hasPoints = userConstraints && userConstraints.totalPoints > 0;
                                                    return (
                                                    <div className="mt-3 pt-3 border-t border-blue-200/50">
                                                        <div className="flex items-start gap-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                                                            <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                                            <div className="text-xs text-amber-800 leading-relaxed">
                                                                {hasPoints ? (
                                                                    <>
                                                                        <span className="font-medium">Why aren&apos;t points being used?</span>
                                                                        {reasons.length > 0 ? (
                                                                            <>
                                                                                <ul className="mt-1.5 ml-1 space-y-1 list-none">
                                                                                    {reasons.map((reason, ri) => (
                                                                                        <li key={ri} className="flex items-start gap-1.5">
                                                                                            <span className="text-amber-400 mt-px">&bull;</span>
                                                                                            <span>{reason}</span>
                                                                                        </li>
                                                                                    ))}
                                                                                </ul>
                                                                                <p className="mt-2 font-medium text-amber-900">
                                                                                    Therefore, we recommend booking with cash for this trip.
                                                                                </p>
                                                                            </>
                                                                        ) : (
                                                                            <p className="mt-1">
                                                                                Award options for this route were either unavailable, had high
                                                                                surcharges, or didn&apos;t offer enough value to justify the points
                                                                                cost. Cash is the better deal here.
                                                                            </p>
                                                                        )}
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <span className="font-medium">No points added.</span>{' '}
                                                                        Add your loyalty program balances to see if you can save with
                                                                        points on this route.
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    );
                                                })()}
                                            </div>
                                                );
                                            })()}

                                            {/* Airline-style Flight Segments */}
                                            <div className="space-y-3 mb-6">
                                                {itinerary.segments.map((segment, idx) => {
                                                    if (segment.type === 'flight') {
                                                        const depTime = segment.departureTime ? new Date(segment.departureTime) : null;
                                                        const arrTime = segment.arrivalTime ? new Date(segment.arrivalTime) : null;
                                                        const validDep = depTime && !isNaN(depTime.getTime());
                                                        const validArr = arrTime && !isNaN(arrTime.getTime());

                                                        // Compute duration
                                                        let durationStr = '';
                                                        if (segment.durationMinutes) {
                                                            const hrs = Math.floor(segment.durationMinutes / 60);
                                                            const mins = segment.durationMinutes % 60;
                                                            durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                                        } else if (validDep && validArr) {
                                                            const diffMs = arrTime.getTime() - depTime.getTime();
                                                            if (diffMs > 0) {
                                                                const hrs = Math.floor(diffMs / 3600000);
                                                                const mins = Math.round((diffMs % 3600000) / 60000);
                                                                durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                                            }
                                                        }

                                                        const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                                        const formatDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                                                        const stopsLabel = segment.stops != null
                                                            ? (segment.stops === 0 ? 'Nonstop' : `${segment.stops} stop${segment.stops > 1 ? 's' : ''}`)
                                                            : (itinerary.route.length - 2 === 0 ? 'Nonstop' : `${itinerary.route.length - 2} stop${itinerary.route.length - 2 > 1 ? 's' : ''}`);

                                                        const segIsPoints = segment.paymentMethod === 'points' || (segment.pointsUsed != null && segment.pointsUsed > 0) || (metrics.cashSaved > 0 && segment.cashPrice === 0);

                                                        return (
                                                            <div key={idx} className={`p-4 rounded-xl border ${segIsPoints ? 'bg-blue-50/50 border-blue-100' : 'bg-slate-50 border-slate-200'}`}>
                                                                {/* Date row */}
                                                                {validDep && (
                                                                    <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
                                                                        <Plane className="w-3.5 h-3.5 text-blue-500" />
                                                                        <span className="font-medium text-slate-600">{formatDate(depTime)}</span>
                                                                        {segment.airline && (
                                                                            <>
                                                                                <span className="text-slate-300">·</span>
                                                                                <span>{segment.airline}{segment.flightNumber ? ` ${segment.flightNumber}` : ''}</span>
                                                                            </>
                                                                        )}
                                                                        {segment.cabinClass && (
                                                                            <>
                                                                                <span className="text-slate-300">·</span>
                                                                                <span className="capitalize">{segment.cabinClass}</span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Airline-style timeline row */}
                                                                <div className="flex items-center gap-3">
                                                                    {/* Departure */}
                                                                    <div className="text-right min-w-[70px]">
                                                                        <div className="text-lg font-bold text-slate-900 leading-tight">
                                                                            {validDep ? formatTime(depTime) : '--:--'}
                                                                        </div>
                                                                        <div className="text-xs font-medium text-slate-500 mt-0.5">
                                                                            {segment.origin || itinerary.route[0]}
                                                                        </div>
                                                                    </div>

                                                                    {/* Timeline connector */}
                                                                    <div className="flex-1 flex flex-col items-center gap-0.5 px-1">
                                                                        {durationStr && (
                                                                            <span className="text-[11px] font-medium text-slate-400">{durationStr}</span>
                                                                        )}
                                                                        <div className="w-full flex items-center">
                                                                            <div className="w-2 h-2 rounded-full border-2 border-blue-400 bg-white flex-shrink-0" />
                                                                            <div className="flex-1 h-[2px] bg-blue-400" />
                                                                            <Plane className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mx-1" />
                                                                            <div className="flex-1 h-[2px] bg-blue-400" />
                                                                            <div className="w-2 h-2 rounded-full border-2 border-blue-400 bg-blue-400 flex-shrink-0" />
                                                                        </div>
                                                                        <span className="text-[11px] text-slate-400">{stopsLabel}</span>
                                                                    </div>

                                                                    {/* Arrival */}
                                                                    <div className="text-left min-w-[70px]">
                                                                        <div className="text-lg font-bold text-slate-900 leading-tight">
                                                                            {validArr ? formatTime(arrTime) : '--:--'}
                                                                        </div>
                                                                        <div className="text-xs font-medium text-slate-500 mt-0.5">
                                                                            {segment.destination || itinerary.route[itinerary.route.length - 1]}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Payment method row - hidden per design */}
                                                            </div>
                                                        );
                                                    }

                                                    // Hotel or other segment types
                                                    {
                                                    const isHotelPoints = segment.paymentMethod === 'points' || (segment.pointsUsed != null && segment.pointsUsed > 0);
                                                    return (
                                                        <div
                                                            key={idx}
                                                            className={`flex items-center gap-3 p-3 rounded-lg border ${
                                                                isHotelPoints || (metrics.cashSaved > 0 && segment.cashPrice === 0)
                                                                    ? 'bg-blue-50 border-blue-100'
                                                                    : 'bg-slate-50 border-slate-100'
                                                            }`}
                                                        >
                                                            <Bed className="w-4 h-4 text-amber-600" />
                                                            <div className="flex-1">
                                                                <div className="font-medium text-slate-900">{segment.segment}</div>
                                                                {/* Per-segment cost hidden per design */}
                                                            </div>
                                                        </div>
                                                    );
                                                    }
                                                })}
                                            </div>

                                            {/* Savings Highlight - only show when points are actually used and savings are real */}
                                            {metrics.cashSaved > 0 && metrics.totalPointsUsed > 0 && metrics.totalOutOfPocket < metrics.totalCashPrice && (
                                                <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <div className="text-sm font-medium text-emerald-900 mb-1">Your Savings</div>
                                                            <div className="text-xs text-emerald-700">
                                                                Save ${Math.round(metrics.cashSaved).toLocaleString()} by using points instead of cash
                                                            </div>
                                                        </div>
                                                        <div className="text-2xl font-bold text-emerald-700">
                                                            {Math.round(metrics.savingsPercentage)}%
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Book Button — routes to payment (if points used) or directly to booking (cash-only) */}
                                            {(() => {
                                                const usesPoints = (itinerary.oopMetrics?.totalPointsUsed ?? 0) > 0;
                                                return (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (!isDisabled) {
                                                                handleSelectSoloItinerary(itinerary);
                                                                router.push(usesPoints
                                                                    ? `/solo/payment?trip_id=${tripId}`
                                                                    : `/solo/booking?trip_id=${tripId}`);
                                                            }
                                                        }}
                                                        disabled={isDisabled}
                                                        className={`w-full mt-4 px-6 py-3 rounded-xl transition-all font-semibold ${
                                                            isDisabled
                                                                ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                                                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20'
                                                        }`}
                                                    >
                                                        {isDisabled ? (itinerary.disableReason ? `Blocked: ${itinerary.disableReason}` : 'Blocked by policy') : 'Book This Trip'}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Right Sidebar - Selected Details */}
                        {selectedSoloItinerary && (
                            <div data-testid="solo-selected-sidebar" className="lg:col-span-1">
                                <div className="sticky top-8 space-y-4">
                                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                                        <h3 className="text-xl mb-6 text-slate-900 font-semibold">Your Plan</h3>

                                        <div className="space-y-6">
                                            {/* Route */}
                                            <div>
                                                <div className="text-sm text-slate-600 mb-2 font-medium">Route</div>
                                                <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                                                    {selectedSoloItinerary.route.map((stop, i) => (
                                                        <span key={i} className="flex items-center gap-1.5">
                                                            <span>{stop}</span>
                                                            {i < selectedSoloItinerary.route.length - 1 && (
                                                                <Plane className="w-3 h-3 text-blue-400 rotate-90" />
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Cost Breakdown — simplified language */}
                                            {(() => {
                                                // Use multiple sources for points: oopMetrics (primary), bookingDetails (fallback)
                                                const sidebarPoints = selectedSoloItinerary.oopMetrics.totalPointsUsed
                                                    || selectedSoloItinerary.bookingDetails?.totalPoints
                                                    || 0;
                                                const sidebarTaxesFees = selectedSoloItinerary.bookingDetails?.totalTaxesFees
                                                    ?? selectedSoloItinerary.segments
                                                        .filter(s => s.paymentMethod === 'points')
                                                        .reduce((sum, s) => sum + (s.surcharge || 0), 0);
                                                return (
                                            <div>
                                                <div className="text-sm text-slate-600 mb-3 font-medium">
                                                    What you&apos;ll pay
                                                    {partySize.total > 1 && (
                                                        <span className="text-xs text-slate-400 ml-2">
                                                            ({partySize.adults} adult{partySize.adults !== 1 ? 's' : ''}{partySize.children > 0 && `, ${partySize.children} child${partySize.children !== 1 ? 'ren' : ''}`})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="space-y-2 text-sm">
                                                    {selectedSoloItinerary.oopMetrics.totalCashPrice > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-600">Would cost in cash</span>
                                                        <span className="text-slate-500 line-through">${Math.round(selectedSoloItinerary.oopMetrics.totalCashPrice).toLocaleString()}</span>
                                                    </div>
                                                    )}
                                                    <div className="flex justify-between font-semibold text-lg">
                                                        <span className="text-slate-900">Your cost</span>
                                                        <span className="text-emerald-600">
                                                            {selectedSoloItinerary.oopMetrics.totalOutOfPocket > 0
                                                                ? `$${Math.round(selectedSoloItinerary.oopMetrics.totalOutOfPocket).toLocaleString()}`
                                                                : (selectedSoloItinerary.oopMetrics.totalCashPrice > 0
                                                                    ? `$${Math.round(selectedSoloItinerary.oopMetrics.totalCashPrice).toLocaleString()}`
                                                                    : 'See checkout'
                                                                )
                                                            }
                                                        </span>
                                                    </div>
                                                    {partySize.total > 1 && (
                                                        <div className="flex justify-between text-slate-500">
                                                            <span>Per person</span>
                                                            <span>${Math.round(selectedSoloItinerary.oopMetrics.totalOutOfPocket / partySize.total).toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                    {sidebarPoints > 0 && (
                                                        <div className="flex justify-between text-blue-700 font-medium">
                                                            <span className="flex items-center gap-1">
                                                                <Zap className="w-3.5 h-3.5" />
                                                                Points needed
                                                            </span>
                                                            <span>
                                                                {sidebarPoints >= 1000
                                                                    ? `${(sidebarPoints / 1000).toFixed(sidebarPoints % 1000 === 0 ? 0 : 1)}k pts`
                                                                    : `${sidebarPoints.toLocaleString()} pts`
                                                                }
                                                            </span>
                                                        </div>
                                                    )}
                                                    {sidebarTaxesFees > 0 && (
                                                        <div className="flex justify-between text-amber-700">
                                                            <span>Taxes &amp; fees</span>
                                                            <span>${Math.round(sidebarTaxesFees).toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                    {selectedSoloItinerary.oopMetrics.cashSaved > 0 && (
                                                        <div className="flex justify-between text-emerald-600 font-medium">
                                                            <span>You&apos;re saving</span>
                                                            <span>${Math.round(selectedSoloItinerary.oopMetrics.cashSaved).toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                                );
                                            })()}

                                        </div>
                                    </div>


                                    {/* Why We Didn't Pick Others (Task 9) */}
                                    {optimizeResponse?.rejectedAlternatives && optimizeResponse.rejectedAlternatives.length > 0 && (
                                        <WhyNotOthers alternatives={optimizeResponse.rejectedAlternatives} />
                                    )}

                                </div>
                            </div>
                        )}
                    </div>

                    {/* Freshness indicator — below cards (Task 7) */}
                    {optimizeResponse && (
                        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
                            {optimizeResponse.cached && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">Cached</span>}
                            {optimizeResponse.computedAt && (
                                <span>Last checked: {new Date(optimizeResponse.computedAt).toLocaleString()}</span>
                            )}
                            {optimizeResponse.expiresAt && (
                                <span>Expires: {new Date(optimizeResponse.expiresAt).toLocaleString()}</span>
                            )}
                        </div>
                    )}

                    {/* Warnings removed from results — shown on booking page instead */}

                    {/* Keep only critical non-transfer warnings: fallback errors */}
                    {!structuredWarnings && (
                        <>
                            {fallbackWarning && (
                                <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-xl flex items-start gap-3">
                                    <Info className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <h3 className="font-semibold text-red-900 mb-1">Unable to Generate Itinerary</h3>
                                        <p className="text-sm text-red-800">{fallbackWarning}</p>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </>) : (
                /* Empty state when no itineraries - Legacy support */
                itineraries.length === 0 ? (
                    <div data-testid="solo-results-empty" data-slot="solo-results-empty" className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                        {tripId && trip && !isAiSuggested ? (
                            <>
                                <MapPin className="w-14 h-14 text-slate-300 mx-auto mb-4" />
                                <h2 className="text-xl font-semibold text-slate-900 mb-2">Complete your booking</h2>
                                <p className="text-slate-600 max-w-md mx-auto mb-6">
                                    Your personalized routes and transfer instructions are ready on the booking page.
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
                                    onClick={() => router.push(tripId ? `/solo/setup?trip_id=${tripId}` : `/solo/setup`)}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                                >
                                    Edit Search & Try Again
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                <>
                <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="font-semibold text-amber-900 mb-1">Fallback results (view-only)</h3>
                        <p className="text-sm text-amber-800">
                            These routes come from the legacy fallback pipeline and can’t be selected for booking. Retry optimization to get bookable results.
                        </p>
                        <div className="mt-3">
                            <button
                                onClick={() => setRefetchTrigger((x) => x + 1)}
                                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                            >
                                Retry optimization
                            </button>
                        </div>
                    </div>
                </div>

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
                                            // View-only: do not allow selection for booking from legacy fallback results.
                                        }}
                                        disabled
                                        className="w-full mt-4 px-6 py-3 rounded-xl transition-all font-medium bg-slate-100 text-slate-500 cursor-not-allowed"
                                    >
                                        View-only (fallback)
                                    </button>

                                    {/* Book Button - Show when selected */}
                                    {/* Disabled intentionally for legacy fallback */}
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
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <button
                                            disabled
                                            className="w-full px-6 py-3 bg-slate-100 text-slate-500 rounded-xl cursor-not-allowed font-semibold"
                                        >
                                            View-only (fallback)
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
                </>
                ))}
                {/* Hotel Recommendations */}
                {optimizeResponse?.hotelRecommendations && optimizeResponse.hotelRecommendations.length > 0 && (
                    <div className="mt-8">
                        <div className="flex items-center gap-2 mb-4">
                            <Bed className="w-5 h-5 text-indigo-600" />
                            <h2 className="text-xl font-semibold text-slate-900">Recommended Hotels</h2>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                            {optimizeResponse.hotelRecommendations.map((rec) => (
                                <HotelRecommendationCard key={rec.hotelId} recommendation={rec} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Confidence feedback (Task 17) — above footer */}
                <div className="p-4 mt-6 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    {calmnessVote === null && !showFeedbackInput ? (
                        <>
                            <p className="text-sm text-slate-600 mb-3">Do you feel more confident about booking this trip?</p>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => handleCalmnessVote('yes')}
                                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors"
                                >
                                    Yes, I&apos;m ready to book
                                </button>
                                <button
                                    onClick={() => handleCalmnessVote('no')}
                                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                                >
                                    I still have questions
                                </button>
                            </div>
                        </>
                    ) : showFeedbackInput && !feedbackSubmitted ? (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600">What questions do you still have, or how can we improve?</p>
                            <textarea
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                                placeholder="E.g. I'm not sure about the layover, pricing seems off, I'd like more hotel options..."
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                rows={3}
                            />
                            <div className="flex gap-2 justify-center">
                                <button
                                    onClick={handleFeedbackSubmit}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                                >
                                    Send feedback
                                </button>
                                <button
                                    onClick={() => { setFeedbackSubmitted(true); setCalmnessVote('no'); }}
                                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                                >
                                    Skip
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500">
                            {calmnessVote === 'yes'
                                ? 'Glad to hear it. Happy travels!'
                                : feedbackText.trim()
                                    ? 'Thanks for sharing — your feedback helps us improve!'
                                    : 'Thanks for the feedback — we\'ll keep improving.'}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
