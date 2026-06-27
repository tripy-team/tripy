'use client';

import Link from 'next/link';
import { Check, Sparkles } from 'lucide-react';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
            <Navigation />

            <div className="max-w-4xl mx-auto px-8 pt-32 pb-24">
                <div className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-full mb-6">
                        <Sparkles className="w-4 h-4 text-blue-600" />
                        <span className="text-blue-700 text-sm font-medium">Simple Pricing</span>
                    </div>
                    <h1 className="text-5xl font-bold text-slate-900 mb-4">Free While We Build</h1>
                    <p className="text-xl text-slate-600 max-w-2xl mx-auto">
                        TripsHacker is free to use during our beta. No credit card required. No hidden fees.
                    </p>
                </div>

                <div className="max-w-md mx-auto">
                    <div className="bg-white border-2 border-blue-200 rounded-3xl p-8 shadow-lg shadow-blue-600/5">
                        <div className="text-center mb-8">
                            <div className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-2">Beta</div>
                            <div className="text-5xl font-bold text-slate-900 mb-2">$0</div>
                            <div className="text-slate-500">Free forever during beta</div>
                        </div>

                        <ul className="space-y-4 mb-8">
                            {[
                                'Unlimited trip optimizations',
                                'Multi-card points optimization',
                                'Real-time flight search',
                                'Booking checklist & guidance',
                                'Share plans via email',
                                'Risk assessment for every route',
                            ].map((feature) => (
                                <li key={feature} className="flex items-center gap-3">
                                    <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                                    <span className="text-slate-700">{feature}</span>
                                </li>
                            ))}
                        </ul>

                        <Link
                            href="/plan"
                            className="block w-full py-4 bg-blue-600 text-white text-center rounded-2xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                        >
                            Start Planning — Free
                        </Link>
                    </div>
                </div>

                <p className="text-center text-sm text-slate-500 mt-8">
                    We&apos;ll introduce paid tiers when we add premium features like price monitoring and automated rebooking.
                    Early users will always get a discount.
                </p>
            </div>

            <Footer />
        </div>
    );
}
