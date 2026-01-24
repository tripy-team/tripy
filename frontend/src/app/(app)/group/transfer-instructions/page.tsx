'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, ExternalLink, AlertCircle, Copy, Plane, Info, Lock, ChevronRight, Lightbulb } from 'lucide-react';
import { itineraries, trips as tripsAPI } from '@/lib/api';
import {
    buildTransferStepsFromItinerary,
    getTransferTipsFromItems,
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
                    <p className="text-slate-600">Step-by-step guide for each member to move points and book.</p>
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
                            Complete payment to unlock where to transfer, which programs to use, how many points per transfer, and step-by-step instructions for each member.
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
                            return (
                                <div key={transfer.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                    <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white border border-slate-200 rounded-xl flex items-center justify-center shadow-sm text-blue-600">
                                                <Icon className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="text-lg font-bold text-slate-900">{transfer.member}</h3>
                                                    <span className="px-2 py-0.5 bg-slate-200 text-slate-600 text-xs rounded-full font-medium">
                                                        {transfer.category}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-slate-600 flex items-center gap-2">
                                                    <span>{transfer.program}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="font-medium text-blue-700">{transfer.partner}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right bg-white px-4 py-2 rounded-lg border border-slate-100 shadow-sm">
                                            <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-0.5">Transfer Amount</div>
                                            <div className="text-2xl font-bold text-slate-900">
                                                {transfer.amount.toLocaleString()} <span className="text-sm font-medium text-slate-500">pts</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-6">
                                        {transfer.warning && (
                                            <div className="mb-6 p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2 text-sm text-amber-800">
                                                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                {transfer.warning}
                                            </div>
                                        )}
                                        <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">Instructions</h4>
                                        <div className="space-y-4">
                                            {transfer.steps.map((step, index) => (
                                                <div key={index} className="flex gap-4">
                                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold border border-slate-200">
                                                        {index + 1}
                                                    </div>
                                                    <p className="text-slate-600 text-sm leading-relaxed pt-0.5">{step}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                            <div className="w-full sm:w-auto">
                                                <div className="text-xs text-slate-500 mb-1">Partner Program</div>
                                                <div className="font-medium text-slate-900 flex items-center gap-2">
                                                    {transfer.partner}
                                                    <button
                                                        onClick={() => copyToClipboard(transfer.partner, transfer.id)}
                                                        className="text-slate-400 hover:text-blue-600 transition-colors"
                                                        title="Copy name"
                                                    >
                                                        {copiedId === transfer.id ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                            <a
                                                href="#"
                                                className="w-full sm:w-auto px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                                                onClick={(e) => e.preventDefault()}
                                            >
                                                Go to {transfer.program} <ExternalLink className="w-4 h-4" />
                                            </a>
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
