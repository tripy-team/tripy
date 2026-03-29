'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    Users,
    Sparkles,
    Clock,
    BarChart3,
    ArrowRight,
    CheckCircle2,
    Shield,
    Zap,
    FileText,
    Mail,
} from 'lucide-react';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

function WaitlistForm({ variant = 'hero' }: { variant?: 'hero' | 'bottom' }) {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError('Please enter a valid email address.');
            return;
        }
        setSubmitting(true);
        setError('');

        // TODO: connect to backend waitlist endpoint
        await new Promise((r) => setTimeout(r, 800));
        setSubmitted(true);
        setSubmitting(false);
    };

    if (submitted) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <p className="text-sm font-medium text-emerald-800">
                    You&apos;re on the list! We&apos;ll be in touch soon.
                </p>
            </div>
        );
    }

    const isHero = variant === 'hero';

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-md">
            <div
                className={`flex gap-3 ${isHero ? 'flex-col sm:flex-row' : 'flex-col sm:flex-row'}`}
            >
                <div className="relative flex-1">
                    <Mail
                        className={`absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${isHero ? 'text-slate-400' : 'text-blue-300'}`}
                    />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@agency.com"
                        className={`w-full rounded-xl py-3 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 ${
                            isHero
                                ? 'border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:ring-blue-600'
                                : 'border border-white/20 bg-white/10 text-white placeholder:text-blue-200 backdrop-blur-sm focus:border-transparent focus:ring-white/50'
                        }`}
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting}
                    className={`flex shrink-0 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
                        isHero
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/30'
                            : 'bg-white text-blue-700 shadow-lg hover:bg-blue-50'
                    }`}
                >
                    {submitting ? (
                        'Joining...'
                    ) : (
                        <>
                            Join Waitlist <ArrowRight className="h-4 w-4" />
                        </>
                    )}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </form>
    );
}

const VALUE_PROPS = [
    {
        icon: Users,
        title: 'Client Loyalty Portfolios',
        description:
            'Store each client\u2019s points balances across programs. Enter once, reuse across every trip.',
    },
    {
        icon: Zap,
        title: 'Instant Cash vs. Points Optimization',
        description:
            'Our solver finds the best transfer routes and compares cash vs. points in seconds, not hours.',
    },
    {
        icon: FileText,
        title: 'Client-Ready Deliverables',
        description:
            'Generate polished, branded booking instructions your clients can actually follow.',
    },
    {
        icon: BarChart3,
        title: 'Track Savings Across Clients',
        description:
            'See total savings generated across your portfolio. Justify your fees with real data.',
    },
];

const STEPS = [
    {
        number: '01',
        title: 'Add Your Client',
        description:
            'Create a client profile with their loyalty balances across Chase, Amex, Citi, and more.',
    },
    {
        number: '02',
        title: 'Run an Optimization',
        description:
            'Enter the trip details. Tripy finds the optimal cash + points strategy in seconds.',
    },
    {
        number: '03',
        title: 'Share the Recommendation',
        description:
            'Send a polished, branded booking guide your client can follow step by step.',
    },
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
                            Early Access — Limited Spots
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
                        Stop rebuilding transfer strategies from scratch. Store
                        client points, generate optimized cash&nbsp;+&nbsp;points
                        recommendations, and deliver polished booking guides —
                        all in one place.
                    </p>

                    <div className="flex flex-col items-center gap-5">
                        <WaitlistForm variant="hero" />
                        <p className="text-sm text-slate-500">
                            Already have an account?{' '}
                            <Link
                                href="/login"
                                className="font-medium text-blue-600 hover:text-blue-700"
                            >
                                Log in
                            </Link>
                        </p>
                    </div>
                </div>
            </section>

            {/* Social proof strip */}
            <section className="border-y border-slate-100 bg-slate-50/50 py-8">
                <div className="mx-auto max-w-5xl px-6">
                    <p className="text-center text-sm font-medium tracking-wide text-slate-400 uppercase">
                        Built for independent points consultants &amp; small
                        travel advisory teams
                    </p>
                </div>
            </section>

            {/* Value Props */}
            <section className="py-24">
                <div className="mx-auto max-w-6xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Hours of research, done in seconds
                        </h2>
                        <p className="text-lg text-slate-600">
                            Tripy replaces the spreadsheets, screenshots, and
                            manual research with a purpose-built optimization
                            engine.
                        </p>
                    </div>

                    <div className="grid gap-8 sm:grid-cols-2">
                        {VALUE_PROPS.map((prop) => (
                            <div
                                key={prop.title}
                                className="group rounded-2xl border border-slate-100 bg-white p-8 transition-all hover:border-blue-100 hover:shadow-lg hover:shadow-blue-600/5"
                            >
                                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                                    <prop.icon className="h-6 w-6" />
                                </div>
                                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                    {prop.title}
                                </h3>
                                <p className="leading-relaxed text-slate-600">
                                    {prop.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="bg-slate-50 py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="mx-auto mb-16 max-w-2xl text-center">
                        <h2 className="mb-4 text-4xl font-bold text-slate-900">
                            Three steps. Client impressed.
                        </h2>
                        <p className="text-lg text-slate-600">
                            Go from client request to polished recommendation
                            in minutes.
                        </p>
                    </div>

                    <div className="grid gap-12 md:grid-cols-3">
                        {STEPS.map((step) => (
                            <div key={step.number} className="relative">
                                <span className="mb-4 block text-5xl font-bold text-blue-100">
                                    {step.number}
                                </span>
                                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                                    {step.title}
                                </h3>
                                <p className="leading-relaxed text-slate-600">
                                    {step.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pain / Gain comparison */}
            <section className="py-24">
                <div className="mx-auto max-w-5xl px-6">
                    <div className="grid gap-8 md:grid-cols-2">
                        {/* Without Tripy */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-8">
                            <div className="mb-6 flex items-center gap-3">
                                <Clock className="h-6 w-6 text-slate-400" />
                                <h3 className="text-xl font-semibold text-slate-900">
                                    Without Tripy
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Manually check transfer partners across 4-5 bank programs',
                                    'Rebuild transfer logic from scratch for every client',
                                    'Copy screenshots into emails as "recommendations"',
                                    'Re-enter points balances every single trip',
                                    'No way to track total savings across clients',
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

                        {/* With Tripy */}
                        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-8">
                            <div className="mb-6 flex items-center gap-3">
                                <Zap className="h-6 w-6 text-blue-600" />
                                <h3 className="text-xl font-semibold text-slate-900">
                                    With Tripy
                                </h3>
                            </div>
                            <ul className="space-y-4">
                                {[
                                    'Optimized cash + points strategies in seconds',
                                    'Client points stored once, reused across trips',
                                    'Branded, step-by-step booking guides clients can follow',
                                    'Portfolio-wide savings tracking with real data',
                                    'Look smarter and save hours every week',
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
                        Client data is encrypted at rest and in transit. Built
                        on AWS with SOC&nbsp;2-ready infrastructure. Your
                        clients&apos; loyalty information stays safe.
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
                        Join the waitlist for early access. We&apos;re
                        onboarding a small group of advisors to shape the
                        product together.
                    </p>
                    <div className="flex flex-col items-center gap-4">
                        <WaitlistForm variant="bottom" />
                        <p className="text-sm text-blue-200">
                            Already have an account?{' '}
                            <Link
                                href="/login"
                                className="font-medium text-white underline underline-offset-2 hover:no-underline"
                            >
                                Log in
                            </Link>
                        </p>
                    </div>
                </div>
            </section>

            <Footer />
        </div>
    );
}
