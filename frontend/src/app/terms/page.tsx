'use client';

import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-white">
            <Navigation />

            <div className="max-w-3xl mx-auto px-8 pt-32 pb-24">
                <h1 className="text-4xl font-bold text-slate-900 mb-2">Terms of Service</h1>
                <p className="text-sm text-slate-500 mb-12">Last updated: February 2026</p>

                <div className="space-y-12 text-slate-700 leading-relaxed">
                    <p className="text-lg text-slate-600">
                        By using Tripy, you agree to these terms.
                    </p>

                    {/* What Tripy provides */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">What Tripy provides</h2>
                        <p className="mb-4">Tripy provides travel recommendations and decision guidance.</p>
                        <p className="mb-3">We help you:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-6">
                            <li>Compare flight options</li>
                            <li>Optimize points and cash usage</li>
                            <li>Understand tradeoffs and risks</li>
                        </ul>

                        <p className="mb-3">Tripy does <strong className="text-slate-900">not</strong>:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Book flights on your behalf</li>
                            <li>Guarantee prices or availability</li>
                            <li>Act as a travel agent</li>
                        </ul>
                        <p>All bookings are completed directly with airlines or providers.</p>
                    </section>

                    {/* No guarantees */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">No guarantees</h2>
                        <p className="mb-4">Travel pricing and availability change constantly.</p>
                        <p className="mb-3">While we aim to provide accurate, helpful guidance:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Prices may change</li>
                            <li>Award space may disappear</li>
                            <li>Airlines may alter schedules or policies</li>
                        </ul>
                        <p>Tripy is an advisory tool, not a guarantee.</p>
                    </section>

                    {/* Your responsibility */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Your responsibility</h2>
                        <p className="mb-3">You are responsible for:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Verifying details before booking</li>
                            <li>Understanding airline rules and fees</li>
                            <li>Completing transfers and bookings correctly</li>
                        </ul>
                        <p>We encourage users to review booking details carefully.</p>
                    </section>

                    {/* Acceptable use */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Acceptable use</h2>
                        <p className="mb-3">Please do not:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Abuse or overload the service</li>
                            <li>Attempt to scrape or reverse engineer the system</li>
                            <li>Use Tripy for unlawful purposes</li>
                        </ul>
                        <p>We may limit or suspend access if misuse occurs.</p>
                    </section>

                    {/* IP */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Intellectual property</h2>
                        <p className="mb-4">Tripy&apos;s software, design, and content are owned by Tripy.</p>
                        <p>You may not copy, modify, or redistribute them without permission.</p>
                    </section>

                    {/* Changes */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Changes to the service</h2>
                        <p className="mb-4">Tripy is evolving.</p>
                        <p className="mb-3">We may:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Add or remove features</li>
                            <li>Change pricing in the future</li>
                            <li>Improve or modify recommendations</li>
                        </ul>
                        <p>We&apos;ll aim to make changes thoughtfully and transparently.</p>
                    </section>

                    {/* Liability */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Limitation of liability</h2>
                        <p className="mb-4">Tripy is provided &ldquo;as is.&rdquo;</p>
                        <p className="mb-3">To the extent allowed by law, Tripy is not liable for:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Missed flights</li>
                            <li>Lost points</li>
                            <li>Price changes</li>
                            <li>Travel disruptions</li>
                        </ul>
                    </section>

                    {/* Governing law */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Governing law</h2>
                        <p>
                            These terms are governed by the laws of the United States (or your operating jurisdiction).
                        </p>
                    </section>

                    {/* Contact */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Contact</h2>
                        <p className="mb-2">Questions or concerns?</p>
                        <p>
                            Email us at{' '}
                            <a href="mailto:tripy@traveltripy.com" className="text-blue-600 hover:underline">
                                tripy@traveltripy.com
                            </a>
                        </p>
                        <p className="mt-1 text-slate-500">We actually read it.</p>
                    </section>
                </div>
            </div>

            <Footer />
        </div>
    );
}
