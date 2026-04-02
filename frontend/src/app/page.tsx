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
        icon: Wallet,
        title: 'Loyalty Portfolio Management',
        description:
            'Store and manage client loyalty balances across Chase, Amex, Citi, Bilt, and 15+ major programs. Enter balances once, reuse across every trip.',
    },
    {
        icon: Brain,
        title: 'AI-Powered Recommendation Engine',
        description:
            'Generate 3\u20135 ranked strategies per trip\u2014points only, cash only, mixed, or hold-and-wait\u2014with per-traveler allocation breakdowns.',
    },
    {
        icon: Repeat,
        title: 'Transfer & Pooling Rules Engine',
        description:
            'Built-in knowledge of which bank currencies transfer to which airlines and hotels, at what ratios, and whether household pooling applies.',
    },
    {
        icon: FileText,
        title: 'Client-Ready Memos & Exports',
        description:
            'Auto-generate advisor-facing summaries, client-facing explanations, copyable email drafts, and shareable PDF booking guides.',
    },
    {
        icon: Bell,
        title: 'Alerts & Monitoring',
        description:
            'Get notified about live transfer bonuses, expiring balances, and time-sensitive redemption opportunities across your client base.',
    },
    {
        icon: PieChart,
        title: 'Portfolio Analytics & Insights',
        description:
            'See concentration risk, estimated portfolio value, flexible vs. locked currency ratios, and underutilized programs at a glance.',
    },
];

const HOW_IT_WORKS = [
    {
        number: '01',
        title: 'Add Your Clients & Households',
        description:
            'Create client profiles with loyalty balances across programs. Group families into households to unlock pooling and cross-traveler strategies.',
    },
    {
        number: '02',
        title: 'Submit a Trip Request',
        description:
            'Enter origin, destination, dates, cabin preference, and budget. Assign travelers from a client or household to the trip.',
    },
    {
        number: '03',
        title: 'Get Ranked Strategies',
        description:
            'Tripy\u2019s engine analyzes every transfer route, bonus opportunity, and traveler balance to produce optimized cash + points strategies.',
    },
    {
        number: '04',
        title: 'Share the Recommendation',
        description:
            'Send a polished memo with clear explanations your client can follow\u2014including why this strategy won and what the alternatives were.',
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
    'Client is overexposed to a low-value hotel program',
    'A live 30% transfer bonus makes Aeroplan the clear winner',
    'Preserve Chase Ultimate Rewards for future high-value redemptions',
    'Taxes and fees make this award less compelling than a paid fare',
    'Partial family redemption\u2014Passenger A on points, Passenger B on cash',
    'Points expire in 45 days\u2014use them or lose them',
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
                            AI-Powered Loyalty Point Wealth Management
                        </span>
                    </div>

                    <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
                        The loyalty optimization
                        <br />
                        <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                            workspace for advisors
                        </span>
                    </h1>

                    <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
                        Tripy helps travel advisors manage client loyalty portfolios,
                        recommend the best cash&nbsp;vs.&nbsp;points redemption strategies,
                        and deliver polished booking guidance with clear AI-generated
                        explanations&mdash;all in one platform.
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
                        No credit card required. Built for independent advisors and small teams.
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

            {/* What is Tripy */}
            <section className="py-24">
                <div className="mx-auto max-w-4xl px-6 text-center">
                    <h2 className="mb-4 text-4xl font-bold text-slate-900">
                        What is Tripy?
                    </h2>
                    <p className="mx-auto max-w-3xl text-lg leading-relaxed text-slate-600">
                        Tripy is a <strong>loyalty portfolio management and redemption
                        strategy platform</strong> purpose-built for travel advisors.
                        It&apos;s not a generic travel CRM&mdash;it&apos;s a specialized
                        workspace that helps you track client loyalty assets like a
                        portfolio, analyze every transfer route and bonus opportunity,
                        and recommend the smartest way to book each trip using cash,
                        points, or a mix of both.
                    </p>
                </div>
            </section>

            {/* Core Features */}
            <section className="bg-slate-50 py-24">
                <div className="mx-auto max-w-6xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Everything advisors need, nothing they don&apos;t
                        </h2>
                        <p className="text-lg text-slate-600">
                            From portfolio tracking to AI-powered explanations,
                            Tripy handles the hard parts of loyalty optimization.
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
                            From trip request to client recommendation in minutes
                        </h2>
                        <p className="text-lg text-slate-600">
                            Four steps to impress every client with data-backed booking guidance.
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
                            so you can confidently advise the best path.
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
                                in both advisor-facing and client-facing language.
                                Know why the top strategy won, why alternatives ranked
                                lower, and what trade-offs to consider.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    'Internal advisor summary with technical rationale',
                                    'Client-friendly explanation they can understand',
                                    'Copyable email draft ready to send',
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
                                Example insights Tripy surfaces
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
                            Before &amp; after Tripy
                        </h2>
                    </div>
                    <div className="grid gap-8 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-8">
                            <div className="mb-6 flex items-center gap-3">
                                <Clock className="h-6 w-6 text-slate-400" />
                                <h3 className="text-xl font-semibold text-slate-900">
                                    Without Tripy
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Manually check transfer partners across 4\u20135 bank programs',
                                    'Rebuild transfer logic from scratch for every client trip',
                                    'Copy screenshots into emails as \u201crecommendations\u201d',
                                    'Re-enter points balances every single trip',
                                    'No way to track total savings or portfolio exposure',
                                    'Hours of research per booking with no audit trail',
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
                                    With Tripy
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Optimized cash + points strategies generated in seconds',
                                    'Client points stored once, reused across every trip',
                                    'Branded, step-by-step booking guides clients can follow',
                                    'Portfolio-wide savings tracking with real data',
                                    'Transfer bonus alerts so you never miss an opportunity',
                                    'Full ledger history and audit trail for every balance change',
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
                        Built for the people who do this work
                    </h2>
                    <p className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed text-slate-600">
                        Tripy is designed for travel advisors, award booking consultants,
                        luxury travel planners, and concierge-style teams who manage
                        client loyalty programs and need to deliver high-quality
                        redemption guidance.
                    </p>
                    <div className="grid gap-6 sm:grid-cols-3">
                        {[
                            {
                                icon: Users,
                                title: 'Independent Advisors',
                                description: 'Solo points consultants managing multiple client portfolios.',
                            },
                            {
                                icon: Plane,
                                title: 'Travel Agencies',
                                description: 'Multi-advisor teams with admin, advisor, and viewer roles.',
                            },
                            {
                                icon: BarChart3,
                                title: 'Award Booking Specialists',
                                description: 'Consultants who charge for expert redemption strategy.',
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
                            Enterprise-grade security
                        </span>
                    </div>
                    <p className="text-lg text-slate-600">
                        Client data is encrypted at rest and in transit. Multi-tenant
                        workspaces keep organizations isolated. Role-based access
                        control with admin, advisor, and viewer permissions ensures
                        your clients&apos; loyalty information stays safe.
                    </p>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="bg-gradient-to-br from-blue-600 to-blue-700 py-24">
                <div className="mx-auto max-w-3xl px-6 text-center">
                    <h2 className="mb-4 text-4xl font-bold text-white sm:text-5xl">
                        Ready to optimize smarter?
                    </h2>
                    <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-blue-100">
                        Create your free account and start managing client loyalty
                        portfolios, generating optimized recommendations, and
                        delivering polished booking guidance today.
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
                        No credit card required. Start with a free workspace.
                    </p>
                </div>
            </section>

            <Footer />
        </div>
    );
}
