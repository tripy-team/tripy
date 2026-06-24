'use client';

import { ArrowLeft, ArrowRight, CreditCard, AlertTriangle, CheckCircle, XCircle, Zap, TrendingUp, Info, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

const TRANSFERABLE_CARDS = [
    {
        bank: 'Chase Ultimate Rewards',
        cards: ['Sapphire Preferred', 'Sapphire Reserve', 'Ink Business Preferred', 'Ink Business Cash (if paired with a Sapphire or Ink Preferred)'],
        partners: ['United', 'Southwest', 'British Airways', 'Air France/KLM', 'Singapore Airlines', 'Virgin Atlantic', 'Hyatt', 'IHG', 'Marriott'],
        canTransfer: true,
        note: 'Cards like the Chase Freedom or Freedom Unlimited can pool points to a Sapphire or Ink Preferred to unlock transfers.',
    },
    {
        bank: 'Amex Membership Rewards',
        cards: ['Platinum Card', 'Gold Card', 'Green Card', 'Business Platinum', 'Business Gold', 'Blue Business Plus'],
        partners: ['Delta', 'ANA', 'Singapore Airlines', 'British Airways', 'Air France/KLM', 'Virgin Atlantic', 'Emirates', 'Hilton', 'Marriott'],
        canTransfer: true,
        note: 'Cards like the Amex Blue Cash or EveryDay do not earn Membership Rewards and cannot transfer to airline partners.',
    },
    {
        bank: 'Citi ThankYou Points',
        cards: ['Strata Premier', 'Prestige (discontinued but grandfathered)', 'Double Cash (when linked)'],
        partners: ['Turkish Airlines', 'Singapore Airlines', 'Air France/KLM', 'Virgin Atlantic', 'JetBlue', 'Avianca LifeMiles'],
        canTransfer: true,
        note: 'The Citi Double Cash earns ThankYou Points but needs to be linked to a Strata Premier to unlock transfers.',
    },
    {
        bank: 'Capital One Miles',
        cards: ['Venture X', 'Venture', 'Spark Miles for Business'],
        partners: ['Air Canada', 'Turkish Airlines', 'British Airways', 'Singapore Airlines', 'Air France/KLM', 'Avianca LifeMiles', 'Wyndham'],
        canTransfer: true,
        note: 'All Venture cardholders can transfer, but Venture X earns at a higher rate and has a Priority Pass.',
    },
    {
        bank: 'Bilt Rewards',
        cards: ['Bilt Mastercard'],
        partners: ['American Airlines', 'United', 'Turkish Airlines', 'Air France/KLM', 'Virgin Atlantic', 'Air Canada', 'Hyatt', 'IHG'],
        canTransfer: true,
        note: 'Bilt is unique because it lets you earn points on rent payments. Transfers are 1:1 to most partners.',
    },
];

const NON_TRANSFERABLE_EXAMPLES = [
    {
        name: 'Chase Freedom / Freedom Unlimited',
        reason: 'Earns Ultimate Rewards points, but cannot transfer directly. Must combine points with a Sapphire or Ink Preferred card first.',
    },
    {
        name: 'Amex Blue Cash Preferred/Everyday',
        reason: 'Earns cash back, not Membership Rewards. These points cannot be transferred to airline partners.',
    },
    {
        name: 'Most cashback cards',
        reason: 'Cards that earn flat cash back (like Citi Double Cash without a linked Premier) do not have transfer partner access.',
    },
    {
        name: 'Store or co-branded airline cards',
        reason: 'Cards like the Delta SkyMiles card earn miles directly with the airline. These are already in the airline program and don\'t need transferring, but they also can\'t be moved to other programs.',
    },
];

export default function PointTransfersLearnPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-white">
            <Navigation />

            <div className="max-w-3xl mx-auto px-8 pt-32 pb-24">
                {/* Back */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-8 transition-colors text-sm"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>

                {/* Hero */}
                <h1 className="text-4xl font-bold text-slate-900 mb-3">Why Transfer Points to Airlines?</h1>
                <p className="text-lg text-slate-500 mb-12 max-w-2xl">
                    The difference between getting $0.01 and $0.04+ per point often comes down to one step:
                    transferring your credit card points to airline loyalty programs instead of booking through your bank&apos;s travel portal.
                </p>

                {/* Portal vs Transfer Comparison */}
                <div className="mb-16">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6">Travel Portal vs. Direct Transfer</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Portal */}
                        <div className="border-2 border-slate-200 rounded-2xl p-6 bg-slate-50">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-slate-200 rounded-xl">
                                    <CreditCard className="w-6 h-6 text-slate-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900">Book via Travel Portal</h3>
                                    <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">e.g. Chase Travel, Amex Travel</p>
                                </div>
                            </div>
                            <ul className="space-y-3 text-sm text-slate-700">
                                <li className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span>Simple &mdash; works like any booking site</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span>No transfer wait time</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                    <span>Typically <strong>1.0&ndash;1.5&cent; per point</strong> value</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                    <span>No access to award sweet spots or saver fares</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                    <span>You often won&apos;t earn airline miles on the booking</span>
                                </li>
                            </ul>
                            <div className="mt-4 p-3 bg-white rounded-lg border border-slate-200">
                                <div className="text-xs text-slate-500 font-semibold mb-1">EXAMPLE</div>
                                <p className="text-sm text-slate-700">
                                    A $400 flight on Chase Travel costs <strong>40,000 points</strong> (at 1&cent;/pt).
                                    You get $400 of value for 40k points.
                                </p>
                            </div>
                        </div>

                        {/* Direct Transfer */}
                        <div className="border-2 border-blue-200 rounded-2xl p-6 bg-blue-50/50 ring-2 ring-blue-100">
                            <div className="absolute -mt-10 ml-auto mr-4">
                            </div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-blue-100 rounded-xl">
                                    <Zap className="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900">Transfer to Airline Partner</h3>
                                    <p className="text-xs text-blue-600 uppercase tracking-wider font-semibold">Recommended by TripsHacker</p>
                                </div>
                            </div>
                            <ul className="space-y-3 text-sm text-slate-700">
                                <li className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span>Often <strong>2&ndash;6&cent;+ per point</strong> value</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span>Access to saver awards, sweet spots, and partner routes</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span>You earn airline elite status credits on the booking</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <span>Transfers take 1&ndash;3 days (sometimes instant)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <span>Transfers are <strong>irreversible</strong> &mdash; verify availability first</span>
                                </li>
                            </ul>
                            <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                                <div className="text-xs text-blue-600 font-semibold mb-1">EXAMPLE</div>
                                <p className="text-sm text-slate-700">
                                    That same $400 route might cost only <strong>12,500 miles</strong> via an airline partner.
                                    That&apos;s <strong>3.2&cent;/pt</strong> &mdash; 3x the value of the portal.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* The Value Gap */}
                <div className="mb-16 p-8 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100">
                    <div className="flex items-center gap-3 mb-4">
                        <TrendingUp className="w-6 h-6 text-blue-600" />
                        <h2 className="text-xl font-bold text-slate-900">The Value Gap Is Real</h2>
                    </div>
                    <p className="text-slate-700 mb-4">
                        On average, transferring points to airline partners yields <strong>2&ndash;4x more value</strong> than booking through a portal.
                        For premium cabin flights (business, first class), the difference can be <strong>5&ndash;10x or more</strong>.
                    </p>
                    <div className="grid grid-cols-3 gap-4 mt-6">
                        <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
                            <div className="text-3xl font-bold text-slate-400">1.0&cent;</div>
                            <div className="text-xs text-slate-500 mt-1">Portal (economy)</div>
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-blue-200 text-center">
                            <div className="text-3xl font-bold text-blue-600">2&ndash;4&cent;</div>
                            <div className="text-xs text-blue-700 mt-1">Transfer (economy)</div>
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-indigo-200 text-center">
                            <div className="text-3xl font-bold text-indigo-600">5&ndash;10&cent;+</div>
                            <div className="text-xs text-indigo-700 mt-1">Transfer (business/first)</div>
                        </div>
                    </div>
                </div>

                {/* How Transfers Work */}
                <div className="mb-16">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6">How Point Transfers Work</h2>
                    <div className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">1</div>
                            <div>
                                <h3 className="font-semibold text-slate-900">Check availability on the airline&apos;s website</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Before transferring any points, go to the airline&apos;s loyalty program website and search for award availability on your dates.
                                    Confirm that the flight and fare class you want is actually bookable with miles. <strong>Never transfer points blindly.</strong>
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">2</div>
                            <div>
                                <h3 className="font-semibold text-slate-900">Log in to your credit card portal</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Go to your bank&apos;s rewards portal (e.g., Chase Ultimate Rewards, Amex Membership Rewards).
                                    Navigate to the &ldquo;Transfer Points&rdquo; or &ldquo;Use Points&rdquo; section.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">3</div>
                            <div>
                                <h3 className="font-semibold text-slate-900">Select the airline partner and enter the amount</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Choose the correct airline loyalty program from the list of partners. Enter the number of points to transfer.
                                    Make sure you have a loyalty account with that airline &mdash; you&apos;ll need the membership number.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">4</div>
                            <div>
                                <h3 className="font-semibold text-slate-900">Wait for the transfer to complete</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Most transfers are instant or take a few minutes. Some can take 1&ndash;3 business days (Amex to some partners, for example).
                                    TripsHacker shows estimated transfer times for each bank/airline pair.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">5</div>
                            <div>
                                <h3 className="font-semibold text-slate-900">Book the award ticket on the airline&apos;s site</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Once the points land in your airline account, go back to the airline&apos;s website, search for your flight,
                                    and book using miles. You&apos;ll typically still pay a small amount in taxes and fees ($5&ndash;$50 for most domestic flights).
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Which Cards Allow Transfers */}
                <div className="mb-16">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Which Cards Can Transfer to Airlines?</h2>
                    <p className="text-slate-600 mb-6">
                        <strong>Not all credit cards support direct transfers to airline partners.</strong> Only cards that earn flexible, transferable points
                        give you this ability. Here&apos;s a breakdown of the major programs.
                    </p>

                    <div className="space-y-6">
                        {TRANSFERABLE_CARDS.map((bank) => (
                            <div key={bank.bank} className="border border-slate-200 rounded-2xl overflow-hidden">
                                <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-white rounded-lg shadow-sm">
                                            <CreditCard className="w-5 h-5 text-blue-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-900">{bank.bank}</h3>
                                            <div className="flex items-center gap-1 mt-0.5">
                                                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                                                <span className="text-xs text-green-700 font-semibold">Supports direct airline transfers</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-5 space-y-3">
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Eligible Cards</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {bank.cards.map((card) => (
                                                <span key={card} className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-700">{card}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Airline Partners (sample)</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {bank.partners.map((partner) => (
                                                <span key={partner} className="px-2.5 py-1 bg-blue-50 rounded-full text-xs text-blue-700">{partner}</span>
                                            ))}
                                        </div>
                                    </div>
                                    {bank.note && (
                                        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                            <p className="text-xs text-amber-800">{bank.note}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Cards That Can NOT Transfer */}
                <div className="mb-16">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Cards That Do NOT Support Direct Transfers</h2>
                    <p className="text-slate-600 mb-6">
                        These popular cards earn rewards, but <strong>cannot transfer points directly to airline loyalty programs</strong>.
                        They may still be useful for portal bookings or cash back.
                    </p>

                    <div className="space-y-3">
                        {NON_TRANSFERABLE_EXAMPLES.map((card) => (
                            <div key={card.name} className="p-4 border border-slate-200 rounded-xl flex items-start gap-3">
                                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-semibold text-slate-900">{card.name}</h4>
                                    <p className="text-sm text-slate-600 mt-0.5">{card.reason}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Important Warnings */}
                <div className="mb-16 p-6 bg-amber-50 border-2 border-amber-200 rounded-2xl">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertTriangle className="w-6 h-6 text-amber-600" />
                        <h2 className="text-xl font-bold text-amber-900">Before You Transfer</h2>
                    </div>
                    <ul className="space-y-3 text-sm text-amber-900">
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-amber-600 mt-0.5">1.</span>
                            <span><strong>Transfers are irreversible.</strong> Once points leave your bank, you cannot move them back. Always verify availability first.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-amber-600 mt-0.5">2.</span>
                            <span><strong>Award availability changes constantly.</strong> A seat available right now might be gone in hours. Move quickly once you confirm availability.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-amber-600 mt-0.5">3.</span>
                            <span><strong>You need a loyalty account.</strong> Create a free account with the airline&apos;s loyalty program before initiating a transfer.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-amber-600 mt-0.5">4.</span>
                            <span><strong>Transfer only what you need.</strong> Don&apos;t transfer your entire balance. Transfer the exact number of points required for the booking.</span>
                        </li>
                    </ul>
                </div>

                {/* CTA */}
                <div className="text-center p-8 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100">
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Ready to maximize your points?</h3>
                    <p className="text-slate-600 mb-6 max-w-md mx-auto">
                        TripsHacker automatically finds the best transfer routes for your cards and tells you exactly how many points to move and where.
                    </p>
                    <button
                        onClick={() => router.push('/solo/setup')}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                    >
                        Plan a Trip <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <Footer />
        </div>
    );
}
