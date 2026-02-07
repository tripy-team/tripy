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
    {
        question: 'What does "Protected" mean?',
        answer: (
            <>
                <p>
                    <strong>Protected</strong> means your entire itinerary is booked on a <strong>single ticket</strong> (one reservation).
                    If something goes wrong&mdash;a delay, cancellation, or missed connection&mdash;the airline is responsible for rebooking you at no extra cost.
                </p>
                <p>
                    This is the safest way to fly with connections. Your bags are checked through to your final destination,
                    and the airline treats your journey as one trip.
                </p>
            </>
        ),
    },
    {
        question: 'What does "Fragile" mean?',
        answer: (
            <>
                <p>
                    <strong>Fragile</strong> means the itinerary has <strong>moderate risk</strong>. This could be due to:
                </p>
                <ul>
                    <li>A carrier change mid-trip (e.g., United to Lufthansa) where bags may need rechecking</li>
                    <li>A connection time that&apos;s legal but tight</li>
                    <li>An international connection that adds complexity (immigration, customs)</li>
                </ul>
                <p>
                    Fragile itineraries are still bookable, but you should be aware of the added complexity.
                    Tripy flags these so you can decide if the savings are worth the risk.
                </p>
            </>
        ),
    },
    {
        question: 'What does "Risky" mean?',
        answer: (
            <>
                <p>
                    <strong>Risky</strong> means the itinerary has <strong>significant execution risk</strong>. Common causes:
                </p>
                <ul>
                    <li><strong>Separate tickets</strong> &mdash; flights booked as independent reservations, so the airline won&apos;t rebook you if you miss a connection</li>
                    <li><strong>Self-transfer required</strong> &mdash; you must collect your bags, exit security, and check in again at the connecting airport</li>
                    <li><strong>Connection time below minimum</strong> &mdash; the layover is shorter than the airport&apos;s recommended minimum connection time</li>
                </ul>
                <p>
                    Risky itineraries can still be booked, but Tripy requires you to acknowledge the risks first.
                    In Safe mode, these options are hidden entirely.
                </p>
            </>
        ),
    },
    {
        question: 'What is a "single ticket" vs. "separate tickets"?',
        answer: (
            <>
                <p>
                    A <strong>single ticket</strong> means all your flights are on one booking (one confirmation number / PNR).
                    The airline is responsible for your entire journey. If a delay causes you to miss a connection,
                    they&apos;ll rebook you for free.
                </p>
                <p>
                    <strong>Separate tickets</strong> means your flights are booked as independent reservations.
                    Each ticket is its own trip in the airline&apos;s system. If you miss a connection because your first flight was late,
                    the second airline has no obligation to help&mdash;you may need to buy a new ticket.
                </p>
                <p>Tripy always labels which type applies so you know exactly what you&apos;re booking.</p>
            </>
        ),
    },
    {
        question: 'What is a "self-transfer"?',
        answer: (
            <>
                <p>
                    A <strong>self-transfer</strong> (sometimes called &quot;self-connect&quot;) means you are responsible for
                    making your own connection between flights. This typically involves:
                </p>
                <ul>
                    <li>Collecting your checked bags at the connecting airport</li>
                    <li>Exiting the secure area</li>
                    <li>Checking in again for your next flight</li>
                    <li>Going back through security</li>
                </ul>
                <p>
                    This adds significant time and risk compared to a normal connection where bags are checked through.
                    Tripy warns you whenever self-transfer is required and recommends at least 3 hours of buffer time.
                </p>
            </>
        ),
    },
    {
        question: 'What is "Minimum Connection Time" (MCT)?',
        answer: (
            <>
                <p>
                    <strong>Minimum Connection Time (MCT)</strong> is the shortest layover an airport considers safe for
                    passengers to make a connection. It varies by airport and whether you&apos;re connecting domestically or internationally.
                </p>
                <p>For example:</p>
                <ul>
                    <li>A domestic connection at Atlanta (ATL) might need 45 minutes</li>
                    <li>An international connection at Paris (CDG) might need 2 hours</li>
                    <li>A connection at Chicago O&apos;Hare (ORD) is notoriously tight and may need 60&ndash;120 minutes</li>
                </ul>
                <p>
                    If your layover is below the MCT, Tripy flags it as risky&mdash;even on a single ticket,
                    you have a high chance of missing your connection.
                </p>
            </>
        ),
    },
    {
        question: 'What is "CPP" (cents per point)?',
        answer: (
            <>
                <p>
                    <strong>CPP</strong> stands for <strong>cents per point</strong>. It measures how much value you&apos;re
                    getting from your points on a specific redemption.
                </p>
                <p>
                    For example, if a flight costs $300 cash or 15,000 points, you&apos;re getting
                    2.0&cent; per point ($300 &divide; 15,000 = $0.02). The higher the CPP, the more value you&apos;re extracting
                    from your points.
                </p>
                <p>
                    Tripy uses CPP alongside other factors (like risk and convenience) to recommend the best way to pay&mdash;but
                    a high CPP alone doesn&apos;t make a booking the best choice if it comes with risky connections or complex transfers.
                </p>
            </>
        ),
    },
    {
        question: 'What is "out-of-pocket" cost?',
        answer: (
            <>
                <p>
                    <strong>Out-of-pocket (OOP)</strong> is the total cash you actually spend on a trip, after applying points.
                    It includes:
                </p>
                <ul>
                    <li>Cash fares for any flights not covered by points</li>
                    <li>Taxes and surcharges on award tickets (points bookings often still have fees)</li>
                    <li>Any remaining costs not offset by points</li>
                </ul>
                <p>
                    Tripy&apos;s default optimization minimizes your out-of-pocket cost&mdash;the real money leaving your
                    bank account&mdash;while still getting good value from your points.
                </p>
            </>
        ),
    },
    {
        question: 'What is a "transfer partner"?',
        answer: (
            <>
                <p>
                    A <strong>transfer partner</strong> is an airline or hotel loyalty program that your credit card points
                    can be converted to. For example, Chase Ultimate Rewards can transfer to United MileagePlus, Hyatt, and others.
                </p>
                <p>Important things to know about transfers:</p>
                <ul>
                    <li>Transfers are usually <strong>irreversible</strong>&mdash;once you send points to an airline, you can&apos;t get them back</li>
                    <li>Transfer ratios vary (most are 1:1, but some are not)</li>
                    <li>Some transfers are instant; others can take days</li>
                </ul>
                <p>
                    Tripy maps your credit card points to available transfer partners automatically and only recommends
                    transfers when the value justifies the commitment.
                </p>
            </>
        ),
    },
    {
        question: 'What are the confidence levels?',
        answer: (
            <>
                <p>Tripy assigns a <strong>confidence level</strong> to every recommendation to help you understand how safe it is to book:</p>
                <ul>
                    <li>
                        <strong>High confidence</strong> (green) &mdash; Clean booking, low execution risk.
                        Data is solid, no tricky connections or estimated balances.
                    </li>
                    <li>
                        <strong>Good confidence</strong> (amber) &mdash; Plan is sound but has caveats.
                        Maybe your balances are estimated, or there&apos;s moderate complexity like a carrier change.
                    </li>
                    <li>
                        <strong>Proceed with caution</strong> (red) &mdash; Real execution risk exists.
                        Separate tickets, very tight connections, or self-transfer required.
                    </li>
                </ul>
                <p>
                    Confidence reflects <strong>execution risk</strong>&mdash;not how good the price is.
                    A cash-only trip can be high confidence. A great points deal with risky connections can be low confidence.
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
