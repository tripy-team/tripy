'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

interface FAQItem {
    question: string;
    answer: React.ReactNode;
}

const FAQ_ITEMS: FAQItem[] = [
    {
        question: 'What is Tripy?',
        answer: (
            <>
                <p>Tripy is a flight decision engine.</p>
                <p>
                    Instead of showing you dozens of options, we tell you <strong>what flight to book</strong>&mdash;using
                    cash, points, or both&mdash;and explain <strong>why it&apos;s the smartest choice for you</strong>.
                </p>
                <p>Our goal is simple: help you book with confidence and avoid regret.</p>
            </>
        ),
    },
    {
        question: 'How is Tripy different from Google Flights or Skyscanner?',
        answer: (
            <>
                <p>Most flight search tools show options. Tripy makes decisions.</p>
                <p>We:</p>
                <ul>
                    <li>Evaluate cash <em>and</em> points together</li>
                    <li>Account for transfer rules and real costs</li>
                    <li>Flag risky itineraries</li>
                    <li>Explain why we didn&apos;t pick cheaper or more obvious options</li>
                </ul>
                <p>Google Flights is great for discovery. Tripy is for deciding.</p>
            </>
        ),
    },
    {
        question: 'Do I need to create an account to use Tripy?',
        answer: (
            <>
                <p>No.</p>
                <p>
                    You can generate trips, use points, and see full recommendations <strong>without signing in</strong>.
                </p>
                <p>We only ask you to sign in if you want to:</p>
                <ul>
                    <li>Save or lock a plan</li>
                    <li>Get alerts or monitoring</li>
                    <li>Store exact point balances</li>
                </ul>
                <p>You should never have to create an account just to get an answer.</p>
            </>
        ),
    },
    {
        question: 'How accurate are point prices and availability?',
        answer: (
            <>
                <p>We do our best to check availability in real time, but award space can change quickly.</p>
                <p>Important things to know:</p>
                <ul>
                    <li>Airlines can change prices or availability without notice</li>
                    <li>Some programs show different results when you&apos;re logged in</li>
                    <li>Transfers are often irreversible</li>
                </ul>
                <p>That&apos;s why Tripy:</p>
                <ul>
                    <li>Shows when results were last checked</li>
                    <li>Flags estimated balances</li>
                    <li>Explains risks and tradeoffs clearly</li>
                </ul>
                <p>We aim for <strong>honest guidance</strong>, not false certainty.</p>
            </>
        ),
    },
    {
        question: 'What does "estimated points" mean?',
        answer: (
            <>
                <p>If you don&apos;t know your exact balances, Tripy can estimate conservatively.</p>
                <p>That means:</p>
                <ul>
                    <li>We assume <em>lower</em> balances</li>
                    <li>We avoid risky or tight options</li>
                    <li>We clearly label recommendations as estimated</li>
                </ul>
                <p>You can always update balances later for more precision.</p>
            </>
        ),
    },
    {
        question: 'Can Tripy book flights for me?',
        answer: (
            <>
                <p>Not yet.</p>
                <p>
                    Tripy tells you <strong>exactly what to book and how</strong>, but you complete the booking
                    directly with the airline or travel provider.
                </p>
                <p>This keeps you in control and avoids surprises.</p>
            </>
        ),
    },
    {
        question: 'What happens after I book?',
        answer: (
            <>
                <p>You can:</p>
                <ul>
                    <li>Mark the trip as booked</li>
                    <li>Save your plan</li>
                    <li>(Soon) get alerts if prices drop or better options appear</li>
                </ul>
                <p>Tripy is designed to support you <strong>before and after</strong> the decision.</p>
            </>
        ),
    },
    {
        question: 'Is Tripy free?',
        answer: (
            <>
                <p>Tripy currently offers core features for free.</p>
                <p>
                    We may introduce paid features in the future (like advanced monitoring or premium optimization),
                    but we&apos;ll always be transparent&mdash;and you&apos;ll never be surprised by charges.
                </p>
            </>
        ),
    },
    {
        question: 'Is my data safe?',
        answer: (
            <>
                <p>Yes. We only collect what&apos;s needed to run the product, and we don&apos;t sell your personal data.</p>
                <p>
                    You can read more in our{' '}
                    <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>.
                </p>
            </>
        ),
    },
];

function FAQAccordion({ item }: { item: FAQItem }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="border-b border-slate-200 last:border-b-0">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between py-6 text-left group"
            >
                <span className="font-medium text-slate-900 pr-4 text-lg group-hover:text-blue-600 transition-colors">
                    {item.question}
                </span>
                {open ? (
                    <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
                ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
                )}
            </button>
            {open && (
                <div className="pb-6 text-slate-600 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_p]:text-slate-600 [&_strong]:text-slate-800 [&_em]:text-slate-700">
                    {item.answer}
                </div>
            )}
        </div>
    );
}

export default function FAQPage() {
    return (
        <div className="min-h-screen bg-white">
            <Navigation />

            <div className="max-w-3xl mx-auto px-8 pt-32 pb-24">
                <h1 className="text-4xl font-bold text-slate-900 mb-2">Frequently Asked Questions</h1>
                <p className="text-lg text-slate-500 mb-12">
                    Straight answers. No jargon.
                </p>

                <div className="divide-y divide-slate-200 border-t border-slate-200">
                    {FAQ_ITEMS.map((item) => (
                        <FAQAccordion key={item.question} item={item} />
                    ))}
                </div>

                <div className="mt-16 p-8 bg-slate-50 rounded-2xl text-center">
                    <h3 className="font-semibold text-slate-900 mb-2">Still have questions?</h3>
                    <p className="text-slate-600 mb-5">We actually read these.</p>
                    <a
                        href="/contact"
                        className="inline-flex px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                    >
                        Contact Us
                    </a>
                </div>
            </div>

            <Footer />
        </div>
    );
}
