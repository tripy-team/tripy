'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    Users,
    Sparkles,
    BarChart3,
    ArrowRight,
    CheckCircle2,
    Shield,
    Zap,
    FileText,
    Repeat,
    Bell,
    Brain,
    PieChart,
    Plane,
    CreditCard,
    TrendingUp,
    Target,
    Clock,
    Wallet,
} from 'lucide-react';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

const CORE_FEATURES = [
    {
        icon: Brain,
        title: 'Ranked Trip Strategies',
        description:
            'Generate 3-5 ranked options per trip across cash, points, mixed, or wait-for-better-value paths with clear tradeoffs for every traveler.',
    },
    {
        icon: Repeat,
        title: 'Points Transfer Intelligence',
        description:
            'See which Amex, Chase, Capital One, Citi, and Bilt points transfer where, which routes are worthwhile, and when a cash fare is smarter.',
    },
    {
        icon: Users,
        title: 'Group Constraint Matching',
        description:
            'Collect airports, budgets, schedules, food preferences, hotel needs, and activities from friends or family without burying the organizer.',
    },
    {
        icon: Wallet,
        title: 'Auto-Synced Points Wallet',
        description:
            'Connect your rewards accounts, keep balances current, and use the latest points automatically in solo and group trip optimization.',
    },
    {
        icon: Bell,
        title: 'Explicit Tradeoffs',
        description:
            'Compare lowest out-of-pocket cash, highest cents-per-point value, fewest transfers, and comfort-to-cost ratio before anyone books.',
    },
    {
        icon: PieChart,
        title: 'Personal Portfolio Insights',
        description:
            'Understand your flexible vs. locked points, expiring balances, and where your rewards can realistically take you next.',
    },
];

const HOW_IT_WORKS = [
    {
        number: '01',
        title: 'Sync Your Points Wallet',
        description:
            'Connect or manually add Chase, Amex, Capital One, Bilt, airline, and hotel balances. TripsHacker keeps your optimization inputs current.',
    },
    {
        number: '02',
        title: 'Invite the Group',
        description:
            'Collect each person\'s airports, dates, cash budget, schedule limits, food preferences, room needs, and activity interests.',
    },
    {
        number: '03',
        title: 'Compare Tradeoffs',
        description:
            'Rank itineraries by out-of-pocket cost, cents-per-point value, transfer complexity, comfort, and fairness across the group.',
    },
    {
        number: '04',
        title: 'Book With Confidence',
        description:
            'Share a clear plan showing what each person gives up and gains, which points to use, and when cash is the better call.',
    },
];

const STRATEGY_TYPES = [
    {
        icon: Target,
        label: 'Points Only',
        description: 'Maximize award redemptions to minimize out-of-pocket cost.',
    },
    {
        icon: CreditCard,
        label: 'Cash Only',
        description: 'When paid fares offer better value than burning points.',
    },
    {
        icon: TrendingUp,
        label: 'Mixed Strategy',
        description: 'Split across cash and points for the optimal balance of cost and flexibility.',
    },
    {
        icon: Clock,
        label: 'Hold & Wait',
        description: 'Preserve flexible currencies when a transfer bonus or better availability is expected.',
    },
];

const INSIGHT_EXAMPLES = [
    'One friend saves $220 by flying from OAK instead of SFO',
    'A live 30% transfer bonus makes Aeroplan the best points path',
    'Preserve Chase Ultimate Rewards for future high-value redemptions',
    'Taxes and fees make this award less compelling than a paid fare',
    'Split strategy: two travelers use points, one pays cash',
    'Hyatt points expire in 45 days, making hotel redemption attractive',
];

export default function LandingPage() {
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);
    const hasRedirectedRef = useRef(false);

    useEffect(() => {
        const checkAuth = () => {
            if (hasRedirectedRef.current) return;

            const accessToken =
                localStorage.getItem('access_token') ||
                sessionStorage.getItem('access_token');
            const authToken = localStorage.getItem('auth_token');
            const storedUser = localStorage.getItem('user');

            if ((accessToken || authToken) && storedUser) {
                try {
                    const parsedUser = JSON.parse(storedUser);
                    if (parsedUser && (parsedUser.name || parsedUser.email)) {
                        hasRedirectedRef.current = true;
                        router.replace('/dashboard');
                        return;
                    }
                } catch {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('id_token');
                    localStorage.removeItem('refresh_token');
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('user');
                    sessionStorage.removeItem('access_token');
                    sessionStorage.removeItem('id_token');
                    sessionStorage.removeItem('refresh_token');
                }
            }

            setIsChecking(false);
        };

        checkAuth();
    }, [router]);

    if (isChecking) {
        return (
            <div
                data-testid="home-loading"
                data-slot="loading-spinner-wrapper"
                className="min-h-full bg-white"
            >
                <Navigation />
                <div className="flex min-h-screen items-center justify-center">
                    <div className="text-center">
                        <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                        <p className="mt-4 text-slate-600">Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            data-testid="home-page"
            data-slot="Home"
            className="min-h-full bg-white"
        >
            <Navigation />

            {/* Hero */}
            <section className="relative overflow-hidden pt-32 pb-24">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-50/60 via-white to-white" />
                <div className="absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-blue-100/40 blur-3xl" />

                <div className="relative mx-auto max-w-4xl px-6 text-center">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5">
                        <Sparkles className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-700">
                            AI-Powered Group Trip + Points Optimizer
                        </span>
                    </div>

                    <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
                        Plan group trips around real budgets,
                        <br />
                        <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                            schedules, airports, and points
                        </span>
                    </h1>

                    <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
                        TripsHacker collects everyone&apos;s constraints, syncs your rewards
                        balances, and ranks trip options by cash cost, points value,
                        transfers, comfort, and fairness.
                    </p>

                    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                        <Link
                            href="/register"
                            className="flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-base font-medium text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/30"
                        >
                            Sign Up Free <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/login"
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-8 py-3.5 text-base font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                            Log In
                        </Link>
                    </div>

                    <p className="mt-6 text-sm text-slate-400">
                        No credit card required. Built for travelers who want the group chat to become a plan.
                    </p>
                </div>
            </section>

            {/* Social proof strip */}
            <section className="border-y border-slate-100 bg-slate-50/50 py-8">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6">
                    {[
                        'Chase Ultimate Rewards',
                        'Amex Membership Rewards',
                        'Capital One Miles',
                        'Citi ThankYou',
                        'Bilt Rewards',
                        'Aeroplan',
                        'Hyatt',
                        'Hilton Honors',
                        'Marriott Bonvoy',
                    ].map((program) => (
                        <span
                            key={program}
                            className="text-sm font-medium text-slate-400"
                        >
                            {program}
                        </span>
                    ))}
                </div>
            </section>

            {/* Three Pillars */}
            <section className="py-24">
                <div className="mx-auto max-w-6xl px-6">
                    <div className="grid gap-8 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-8 transition-all hover:border-blue-100 hover:shadow-lg hover:shadow-blue-600/5">
                            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                <Wallet className="h-6 w-6" />
                            </div>
                            <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                Personal Points Wallet
                            </h3>
                            <p className="leading-relaxed text-slate-600">
                                Sync or manually add Chase, Amex, Citi, Bilt, airline,
                                and hotel balances in one place. TripsHacker uses them
                                automatically when you plan.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50/30 p-8 shadow-lg shadow-blue-600/5">
                            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
                                <Brain className="h-6 w-6" />
                            </div>
                            <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                Redemption Strategy Engine
                            </h3>
                            <p className="leading-relaxed text-slate-600">
                                Compare cash, points, and mixed-payment paths
                                based on value, flexibility, comfort, and your
                                group&apos;s actual constraints.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-8 transition-all hover:border-blue-100 hover:shadow-lg hover:shadow-blue-600/5">
                            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                <FileText className="h-6 w-6" />
                            </div>
                            <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                Group-Ready Output
                            </h3>
                            <p className="leading-relaxed text-slate-600">
                                Turn messy preferences into a shareable plan that
                                explains winners, compromises, and who pays or
                                redeems what.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* What is TripsHacker */}
            <section className="py-24 pt-0">
                <div className="mx-auto max-w-4xl px-6 text-center">
                    <h2 className="mb-4 text-4xl font-bold text-slate-900">
                        What is TripsHacker?
                    </h2>
                    <p className="mx-auto max-w-3xl text-lg leading-relaxed text-slate-600">
                        TripsHacker is a <strong>consumer travel planning app</strong> for
                        people coordinating trips with friends, family, and points.
                        It analyzes group constraints, transfer routes, bonus
                        opportunities, and rewards balances to recommend the smartest
                        way to book each trip: cash, points, or a mix of both.
                    </p>
                </div>
            </section>

            {/* Core Features */}
            <section className="bg-slate-50 py-24">
                <div className="mx-auto max-w-6xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Everything you need to turn preferences into a trip
                        </h2>
                        <p className="text-lg text-slate-600">
                            From points syncing to tradeoff explanations, TripsHacker handles
                            the hard parts of group planning and rewards optimization.
                        </p>
                    </div>

                    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                        {CORE_FEATURES.map((feature) => (
                            <div
                                key={feature.title}
                                className="group rounded-2xl border border-slate-200 bg-white p-8 transition-all hover:border-blue-100 hover:shadow-lg hover:shadow-blue-600/5"
                            >
                                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                                    <feature.icon className="h-6 w-6" />
                                </div>
                                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                    {feature.title}
                                </h3>
                                <p className="leading-relaxed text-slate-600">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            From group chat to booking recommendation in minutes
                        </h2>
                        <p className="text-lg text-slate-600">
                            Four steps to a data-backed trip everyone can understand.
                        </p>
                    </div>

                    <div className="grid gap-12 md:grid-cols-2">
                        {HOW_IT_WORKS.map((step) => (
                            <div key={step.number} className="relative flex gap-5">
                                <span className="text-5xl font-bold text-blue-100">
                                    {step.number}
                                </span>
                                <div>
                                    <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                        {step.title}
                                    </h3>
                                    <p className="leading-relaxed text-slate-600">
                                        {step.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Strategy Types */}
            <section className="border-y border-slate-100 bg-slate-50 py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Multiple strategies, one clear winner
                        </h2>
                        <p className="text-lg text-slate-600">
                            The recommendation engine generates ranked strategies
                            so you can choose the best path for the whole group.
                        </p>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        {STRATEGY_TYPES.map((strategy) => (
                            <div
                                key={strategy.label}
                                className="rounded-2xl border border-slate-200 bg-white p-6 text-center transition-all hover:border-blue-200 hover:shadow-md"
                            >
                                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                    <strategy.icon className="h-6 w-6" />
                                </div>
                                <h3 className="mb-1.5 text-lg font-semibold text-slate-900">
                                    {strategy.label}
                                </h3>
                                <p className="text-sm leading-relaxed text-slate-500">
                                    {strategy.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* AI Insights */}
            <section className="py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="grid items-center gap-16 lg:grid-cols-2">
                        <div>
                            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5">
                                <Sparkles className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-medium text-blue-700">
                                    AI-Powered Insights
                                </span>
                            </div>
                            <h2 className="mb-4 text-4xl font-bold text-slate-900">
                                Smart insights that explain the &ldquo;why&rdquo;
                            </h2>
                            <p className="mb-6 text-lg leading-relaxed text-slate-600">
                                Every recommendation comes with AI-generated explanations
                                written for the people taking the trip.
                                Know why the top strategy won, why alternatives ranked
                                lower, and what trade-offs to consider.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    'Organizer summary with technical rationale',
                                    'Traveler-friendly explanation the group can understand',
                                    'Shareable booking plan ready to send',
                                    'Per-traveler allocation breakdown',
                                ].map((item) => (
                                    <li
                                        key={item}
                                        className="flex items-start gap-3 text-slate-700"
                                    >
                                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
                            <h3 className="mb-5 text-lg font-semibold text-slate-900">
                                Example insights TripsHacker surfaces
                            </h3>
                            <div className="space-y-3">
                                {INSIGHT_EXAMPLES.map((insight, i) => (
                                    <div
                                        key={i}
                                        className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
                                    >
                                        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                        <span className="text-sm text-slate-700">
                                            {insight}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pain / Gain comparison */}
            <section className="bg-slate-50 py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Before &amp; after TripsHacker
                        </h2>
                    </div>
                    <div className="grid gap-8 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-8">
                            <div className="mb-6 flex items-center gap-3">
                                <Clock className="h-6 w-6 text-slate-400" />
                                <h3 className="text-xl font-semibold text-slate-900">
                                    Without TripsHacker
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Ask everyone for budgets, dates, airports, and preferences repeatedly',
                                    'Manually check transfer partners across 4-5 bank programs',
                                    'Compare cash fares, points redemptions, and hotel options in separate tabs',
                                    'Re-enter points balances every single trip',
                                    'Choose an itinerary without knowing who absorbed which compromise',
                                    'Hours of research before the group can agree on anything',
                                ].map((item) => (
                                    <li
                                        key={item}
                                        className="flex items-start gap-3 text-slate-600"
                                    >
                                        <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-8">
                            <div className="mb-6 flex items-center gap-3">
                                <Zap className="h-6 w-6 text-blue-600" />
                                <h3 className="text-xl font-semibold text-slate-900">
                                    With TripsHacker
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Optimized cash + points strategies generated in seconds',
                                    'Points wallet synced once, reused across every trip',
                                    'Side-by-side tradeoffs for budget, schedule, comfort, and value',
                                    'Group constraints collected in one organized flow',
                                    'Transfer opportunities surfaced before you book',
                                    'Clear balance history and source tracking for every synced account',
                                ].map((item) => (
                                    <li
                                        key={item}
                                        className="flex items-start gap-3 text-slate-700"
                                    >
                                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* Who it's for */}
            <section className="py-24">
                <div className="mx-auto max-w-4xl px-6 text-center">
                    <h2 className="mb-4 text-4xl font-bold text-slate-900">
                        Built for the people who end up planning the trip
                    </h2>
                    <p className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed text-slate-600">
                        TripsHacker is designed for friend groups, couples, families, and
                        points enthusiasts who need one place to make the trip math
                        and the people math line up.
                    </p>
                    <div className="grid gap-6 sm:grid-cols-3">
                        {[
                            {
                                icon: Users,
                                title: 'Group Organizers',
                                description: 'The person turning everyone\'s availability, budget, and preferences into a real itinerary.',
                            },
                            {
                                icon: Plane,
                                title: 'Frequent Travelers',
                                description: 'People comparing paid fares, award flights, transfer partners, and comfort tradeoffs.',
                            },
                            {
                                icon: BarChart3,
                                title: 'Points Collectors',
                                description: 'Travelers with points across several banks and loyalty programs who want better redemptions.',
                            },
                        ].map((persona) => (
                            <div
                                key={persona.title}
                                className="rounded-2xl border border-slate-100 bg-white p-8 transition-all hover:shadow-md"
                            >
                                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                    <persona.icon className="h-6 w-6" />
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-slate-900">
                                    {persona.title}
                                </h3>
                                <p className="text-sm leading-relaxed text-slate-500">
                                    {persona.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Trust / Security */}
            <section className="border-y border-slate-100 bg-slate-50/50 py-16">
                <div className="mx-auto max-w-4xl px-6 text-center">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5">
                        <Shield className="h-4 w-4 text-slate-500" />
                        <span className="text-sm font-medium text-slate-600">
                            Privacy-first wallet syncing
                        </span>
                    </div>
                    <p className="text-lg text-slate-600">
                        Rewards data is scoped to the signed-in traveler, protected in
                        transit and at rest, and only used for optimization when you
                        enable it. TripsHacker stores provider tokens, not loyalty account
                        passwords.
                    </p>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="bg-gradient-to-br from-blue-600 to-blue-700 py-24">
                <div className="mx-auto max-w-3xl px-6 text-center">
                    <h2 className="mb-4 text-4xl font-bold text-white sm:text-5xl">
                        Ready to decide smarter?
                    </h2>
                    <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-blue-100">
                        Create your free account, sync your points wallet, and start
                        comparing the best cash vs. points paths for your next solo
                        or group trip.
                    </p>
                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/register"
                            className="flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-medium text-blue-700 shadow-lg transition-all hover:bg-blue-50"
                        >
                            Sign Up Free <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/login"
                            className="flex items-center gap-2 rounded-xl border border-white/30 px-8 py-3.5 text-base font-medium text-white transition-all hover:border-white/60 hover:bg-white/10"
                        >
                            Log In
                        </Link>
                    </div>
                    <p className="mt-6 text-sm text-blue-200">
                        No credit card required. Start deciding smarter today.
                    </p>
                </div>
            </section>

            <Footer />
        </div>
    );
}
