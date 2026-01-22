'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, CheckCircle, ExternalLink, AlertCircle, Copy, Plane, Hotel, Activity, Info } from 'lucide-react';
import { trips as tripsAPI, points as pointsAPI } from '@/lib/api';

interface TransferStep {
    id: string;
    member: string;
    initials: string;
    program: string;
    partner: string;
    amount: number;
    category: string;
    icon: typeof Plane;
    steps: string[];
    warning?: string;
    status: 'pending' | 'completed';
}

export default function GroupTransferInstructions() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tripId = searchParams?.get('trip_id') || '';
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const copyToClipboard = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
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

    // Mock transfers - TODO: Fetch from API based on tripId and points strategy
    const transfers: TransferStep[] = [
        {
            id: 't1',
            member: 'Sarah Chen',
            initials: 'SC',
            program: 'Chase Ultimate Rewards',
            partner: 'Air France / KLM Flying Blue',
            amount: 80000,
            category: 'Flights',
            icon: Plane,
            steps: [
                'Log in to your Chase Ultimate Rewards account.',
                'Navigate to "Transfer to Travel Partners".',
                'Select "Air France / KLM Flying Blue" from the airline list.',
                'Enter your Flying Blue membership number (creates instant link).',
                'Transfer 80,000 points (1:1 ratio). Transfer is usually instant.',
                'Once points appear in Flying Blue, book the saved itinerary.'
            ],
            warning: 'Double check availability on Air France website before transferring.',
            status: 'pending'
        },
        {
            id: 't2',
            member: 'David Kim',
            initials: 'DK',
            program: 'Chase Ultimate Rewards',
            partner: 'World of Hyatt',
            amount: 85000,
            category: 'Hotels',
            icon: Hotel,
            steps: [
                'Log in to Chase Ultimate Rewards.',
                'Select "Transfer to Travel Partners".',
                'Choose "World of Hyatt" under hotels.',
                'Enter your World of Hyatt account number.',
                'Transfer 85,000 points. Transfers are instant.',
                'Go to Hyatt.com and book the saved rooms using points.'
            ],
            status: 'pending'
        },
        {
            id: 't3',
            member: 'Michael Rodriguez',
            initials: 'MR',
            program: 'Capital One Miles',
            partner: 'Cover Travel Purchases',
            amount: 45000,
            category: 'Activities',
            icon: Activity,
            steps: [
                'Book the activities using your Capital One Venture card.',
                'Log in to your Capital One account within 90 days.',
                'Select "Cover Travel Purchases".',
                'Select the activity charges to erase them using miles.',
                'Redeem 45,000 miles to cover $450 worth of charges.'
            ],
            status: 'pending'
        }
    ];

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

                {/* Transfer Cards */}
                <div className="space-y-6">
                    {transfers.map((transfer) => {
                        const Icon = transfer.icon;

                        return (
                            <div key={transfer.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                {/* Card Header */}
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

                                {/* Steps */}
                                <div className="p-6">
                                    {transfer.warning && (
                                        <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-sm text-red-700">
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

                                    {/* Partner Details / Action */}
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
                                                    {copiedId === transfer.id ? (
                                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
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

                {/* Footer Actions */}
                <div className="mt-12 flex justify-end">
                    <button className="px-8 py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl">
                        Mark All as Completed
                    </button>
                </div>
            </div>
        </div>
    );
}
