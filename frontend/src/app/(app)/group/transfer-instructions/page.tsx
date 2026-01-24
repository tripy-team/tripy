'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, ExternalLink, AlertCircle, Copy, Plane, Info, Lock, ChevronRight, Lightbulb, TrendingUp, ArrowRight } from 'lucide-react';
import { itineraries, trips as tripsAPI } from '@/lib/api';
import {
    buildTransferStepsFromItinerary,
    getTransferTipsFromItems,
    buildTransferStrategyOverview,
    type TransferStepResult,
    type TransferTip,
} from '@/lib/transfer-instructions';

export default function GroupTransferInstructions() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('trip_id') || '';
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [isPaid, setIsPaid] = useState(false); // TODO: fetch from API (trip payment status)
    const [items, setItems] = useState<Array<{ type?: string; [k: string]: unknown }>>([]);
    const [members, setMembers] = useState<Array<{ userId: string; name?: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const transfers: TransferStepResult[] = buildTransferStepsFromItinerary(items, members);
    const { transfer_tips } = getTransferTipsFromItems(items);
    const strategyOverview = buildTransferStrategyOverview(items, members);

    useEffect(() => {
        if (!tripId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        Promise.all([
            itineraries.get(tripId).then((r) => r.items || []),
            tripsAPI.listMembers(tripId).then((r) => r.members || []),
        ])
            .then(([its, mems]) => {
                if (cancelled) return;
                setItems(Array.isArray(its) ? its : []);
                setMembers(Array.isArray(mems) ? mems : []);
            })
            .catch((e) => {
                if (cancelled) return;
                setLoadError(e?.message || 'Failed to load itinerary and members');
                setItems([]);
                setMembers([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [tripId]);

    const copyToClipboard = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (_err) {
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) {
                    setCopiedId(id);
                    setTimeout(() => setCopiedId(null), 2000);
                }
            } catch (fallbackErr) {
                console.error('Copy failed', fallbackErr);
            }
        }
    };

    return (
        <div className="min-h-full p-8 bg-neutral-50">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Strategy</span>
                    </button>

                    <h1 className="text-3xl font-bold text-slate-900 mb-3">Transfer Instructions</h1>
                    <p className="text-slate-600">Step-by-step guide: from which credit card to transfer, how many points to transfer, and how to book.</p>
                </div>

                {/* Warning Banner */}
                <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900">
                        <span className="font-semibold block mb-1">Important: Transfers are irreversible</span>
                        Once you transfer credit card points to an airline or hotel partner, you cannot move them back.
                        Ensure availability is still there before confirming the transfer.
                    </div>
                </div>

                {!isPaid ? (
                    /* Pending Payment section — transfer strategy hidden until payment */
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden p-8 md:p-12 text-center">
                        <div className="bg-slate-100 p-4 rounded-full w-fit mx-auto mb-4">
                            <Lock className="w-10 h-10 text-slate-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-2">Pending Payment</h3>
                        <p className="text-slate-600 max-w-md mx-auto mb-6">
                            Complete payment to unlock which credit card to transfer from, how many points to transfer to each partner, and step-by-step instructions for each member.
                        </p>
                        <button
                            onClick={() => router.push(`/group/booking?trip_id=${tripId}`)}
                            className="text-blue-600 font-semibold hover:text-blue-700 inline-flex items-center gap-1"
                        >
                            Complete Payment <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                <>
                {loading ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                        <p className="mt-4 text-slate-600">Loading your tailored transfer instructions…</p>
                    </div>
                ) : loadError ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                        <p className="text-red-600">{loadError}</p>
                        <p className="mt-2 text-slate-600 text-sm">Generate an itinerary for this trip first, then return here.</p>
                    </div>
                ) : (
                <>
                {/* Transfer Strategy Overview */}
                {strategyOverview && strategyOverview.totalPointsByProgram.size > 0 && (
                    <div className="mb-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-blue-100">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className="w-5 h-5 text-blue-600" />
                                <h3 className="text-lg font-bold text-slate-900">Your Transfer Strategy</h3>
                            </div>
                            
                            <p className="text-sm text-slate-700 mb-2">{strategyOverview.strategySummary}</p>
                            {strategyOverview.strategyReason && (
                                <p className="text-xs text-slate-600 italic mb-4">{strategyOverview.strategyReason}</p>
                            )}
                            
                            {/* Points by Credit Card Program */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                {Array.from(strategyOverview.totalPointsByProgram.entries()).map(([program, total]) => {
                                    const destinations = strategyOverview.transfersByProgram.get(program) || [];
                                    return (
                                        <div key={program} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit Card</div>
                                                <div className="text-2xl font-bold text-slate-900">{total.toLocaleString()}</div>
                                            </div>
                                            <div className="text-sm font-medium text-slate-900 mb-3">{program}</div>
                                            <div className="space-y-2">
                                                {destinations.map((dest, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 text-xs text-slate-600">
                                                        <ArrowRight className="w-3 h-3 text-blue-500" />
                                                        <span className="font-medium">{dest.points.toLocaleString()} pts</span>
                                                        <span>→</span>
                                                        <span className="text-blue-700 font-medium">{dest.partner}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            
                            {/* Per-Member Breakdown */}
                            {strategyOverview.memberStrategies.length > 1 && (
                                <div className="mt-4 pt-4 border-t border-blue-200">
                                    <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Per Traveler</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {strategyOverview.memberStrategies.map((ms, idx) => (
                                            <div key={idx} className="bg-white rounded-lg p-3 border border-slate-100">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-sm font-semibold text-slate-900">{ms.memberName}</span>
                                                    <span className="text-xs font-bold text-slate-600">{ms.totalPoints.toLocaleString()} pts</span>
                                                </div>
                                                <div className="text-xs text-slate-600 space-y-1">
                                                    {ms.transfers.slice(0, 2).map((t, i) => (
                                                        <div key={i} className="flex items-center gap-1">
                                                            <ArrowRight className="w-2.5 h-2.5 text-blue-400" />
                                                            <span>{t.points.toLocaleString()} to {t.to}</span>
                                                        </div>
                                                    ))}
                                                    {ms.transfers.length > 2 && (
                                                        <div className="text-slate-500">+{ms.transfers.length - 2} more</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Tailored strategies from transfer_tips (when we have them) */}
                {transfer_tips.length > 0 && (
                    <div className="mb-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
                            <Lightbulb className="w-5 h-5 text-amber-500" />
                            <h3 className="font-semibold text-slate-900">Tailored transfer strategies for your trip</h3>
                        </div>
                        <div className="p-4 space-y-3">
                            {transfer_tips.map((t: TransferTip, i: number) => (
                                <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="font-medium text-slate-900">{t.from_program || 'Bank points'}</span>
                                        <span className="text-slate-400">→</span>
                                        <span className="font-medium text-blue-700">{t.to_program || 'Partner'}</span>
                                        {t.best_for && (
                                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{t.best_for}</span>
                                        )}
                                    </div>
                                    {t.note && <p className="mt-1.5 text-slate-600 text-sm">{t.note}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step-by-step transfer cards (from itinerary optimization) */}
                {transfers.length > 0 ? (
                    <div className="space-y-6">
                        {transfers.map((transfer) => {
                            const Icon = transfer.icon;
                            // Get matching tip for additional details
                            const matchingTip = transfer_tips.find(t => 
                                (t.to_program?.toLowerCase().includes(transfer.partner.toLowerCase()) ||
                                 transfer.partner.toLowerCase().includes(t.to_program?.toLowerCase() || '')) &&
                                (t.from_program?.toLowerCase().includes(transfer.program.toLowerCase()) ||
                                 transfer.program.toLowerCase().includes(t.from_program?.toLowerCase() || ''))
                            );
                            const flightSegment = transfer.flightSegment || matchingTip?.best_for;
                            const surcharge = transfer.surcharge ?? matchingTip?.surcharge;
                            const isCodeshare = transfer.isCodeshare || matchingTip?.is_codeshare;
                            const operatingCarrier = transfer.operatingCarrier || matchingTip?.operating_carrier_name;
                            const bookingAirline = matchingTip?.booking_airline_name || transfer.partner;

                            return (
                                <div key={transfer.id} className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                    {/* Header with Member Info */}
                                    <div className="p-6 border-b-2 border-slate-100 bg-gradient-to-r from-slate-50 to-blue-50/30">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg text-white font-bold text-lg">
                                                {transfer.initials}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="text-xl font-bold text-slate-900">{transfer.member}</h3>
                                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-bold uppercase tracking-wide">
                                                        {transfer.category}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-slate-600 flex items-center gap-2">
                                                    <span className="font-medium">{transfer.program}</span>
                                                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                                                    <span className="font-bold text-blue-700">{transfer.partner}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Transfer Summary - Prominent Display */}
                                        <div className="bg-white rounded-xl p-4 border-2 border-blue-200 shadow-sm">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div>
                                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">From Card</div>
                                                    <div className="text-sm font-bold text-slate-900">{transfer.program}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Transfer Amount</div>
                                                    <div className="text-2xl font-bold text-blue-700">{transfer.amount.toLocaleString()}</div>
                                                    <div className="text-xs text-slate-600 font-medium">points</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">To Partner</div>
                                                    <div className="text-sm font-bold text-blue-700 flex items-center gap-1">
                                                        {bookingAirline}
                                                        <button
                                                            onClick={() => copyToClipboard(bookingAirline, transfer.id)}
                                                            className="text-slate-400 hover:text-blue-600 transition-colors"
                                                            title="Copy name"
                                                        >
                                                            {copiedId === transfer.id ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Flight Segment Info */}
                                            {flightSegment && (
                                                <div className="mt-3 pt-3 border-t border-slate-200">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Plane className="w-4 h-4 text-slate-500" />
                                                        <span className="font-medium text-slate-600">For flight:</span>
                                                        <span className="font-bold text-slate-900">{flightSegment}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Surcharge/Taxes */}
                                            {surcharge !== undefined && surcharge > 0 && (
                                                <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                                                        <span className="font-semibold text-amber-900">Additional: ~${Math.round(surcharge)} in taxes & fees</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Codeshare Info */}
                                            {isCodeshare && operatingCarrier && (
                                                <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <Info className="w-3.5 h-3.5 text-blue-600" />
                                                        <span className="text-blue-800">
                                                            <span className="font-semibold">Codeshare:</span> Book via {bookingAirline}, fly on {operatingCarrier}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Instructions Section */}
                                    <div className="p-6">
                                        {transfer.warning && (
                                            <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl flex items-start gap-3 text-sm text-amber-900">
                                                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
                                                <div>
                                                    <div className="font-bold mb-1">Important</div>
                                                    {transfer.warning}
                                                </div>
                                            </div>
                                        )}
                                        
                                        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <div className="w-1 h-5 bg-blue-600 rounded"></div>
                                            Step-by-Step Instructions
                                        </h4>
                                        
                                        <div className="space-y-4">
                                            {transfer.steps.map((step, index) => (
                                                <div key={index} className="flex gap-3">
                                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold border-2 border-blue-200">
                                                        {index + 1}
                                                    </div>
                                                    <p className="text-slate-700 text-sm leading-relaxed pt-0.5 font-medium">{step}</p>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="mt-8 pt-6 border-t-2 border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                            <a
                                                href="#"
                                                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all"
                                                onClick={(e) => e.preventDefault()}
                                            >
                                                Go to {transfer.program} <ExternalLink className="w-4 h-4" />
                                            </a>
                                            <button
                                                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-sm transition-colors"
                                            >
                                                Mark as Completed
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : transfer_tips.length > 0 ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                        <p className="text-slate-600">
                            Generate an <strong>optimized itinerary</strong> for this trip (from the results page) to get step-by-step transfer instructions for each member. The strategies above are tailored to your trip.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                        <p className="text-slate-600">
                            Generate an itinerary for this trip to see tailored transfer strategies and step-by-step instructions for each member.
                        </p>
                        {tripId && (
                            <button
                                onClick={() => router.push(`/group/results?trip_id=${tripId}`)}
                                className="mt-4 text-blue-600 font-semibold hover:text-blue-700"
                            >
                                Go to Results <ChevronRight className="w-4 h-4 inline" />
                            </button>
                        )}
                    </div>
                )}

                {transfers.length > 0 && (
                    <div className="mt-12 flex justify-end">
                        <button className="px-8 py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl">
                            Mark All as Completed
                        </button>
                    </div>
                )}
                </>
                )}
                </>
                )}
            </div>
        </div>
    );
}
