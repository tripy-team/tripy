'use client';

import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-white">
            <Navigation />

            <div className="max-w-3xl mx-auto px-8 pt-32 pb-24">
                <h1 className="text-4xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
                <p className="text-sm text-slate-500 mb-12">Last updated: February 2026</p>

                <div className="space-y-12 text-slate-700 leading-relaxed">
                    <p className="text-lg text-slate-600">
                        Tripy respects your privacy. This policy explains what we collect, why we collect it,
                        and how we protect it.
                    </p>

                    {/* What we collect */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">What information we collect</h2>

                        <h3 className="text-lg font-medium text-slate-900 mb-3">Information you provide</h3>
                        <ul className="list-disc pl-6 space-y-2 mb-6">
                            <li>Email address (if you choose to share or save a plan)</li>
                            <li>Travel details (origin, destination, dates, preferences)</li>
                            <li>Point balances (exact or estimated, optional)</li>
                        </ul>

                        <h3 className="text-lg font-medium text-slate-900 mb-3">Information we collect automatically</h3>
                        <ul className="list-disc pl-6 space-y-2 mb-6">
                            <li>Anonymous session identifiers (to keep your trip working without sign-in)</li>
                            <li>Usage data (pages viewed, actions taken)</li>
                            <li>Basic device and browser information</li>
                        </ul>

                        <p className="font-medium text-slate-900 mb-2">We do <strong>not</strong> collect:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Credit card numbers</li>
                            <li>Airline login credentials</li>
                            <li>Payment information</li>
                        </ul>
                    </section>

                    {/* How we use it */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">How we use your information</h2>
                        <p className="mb-3">We use your information to:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-6">
                            <li>Generate trip recommendations</li>
                            <li>Improve accuracy and reliability</li>
                            <li>Save or restore your plans</li>
                            <li>Send you links or notifications you request</li>
                            <li>Improve the product through analytics</li>
                        </ul>

                        <p className="mb-3">We do <strong className="text-slate-900">not</strong> use your data to:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Sell ads</li>
                            <li>Train third-party models</li>
                            <li>Track you across unrelated websites</li>
                        </ul>
                    </section>

                    {/* Anonymous usage */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Anonymous usage</h2>
                        <p className="mb-3">You can use Tripy without an account.</p>
                        <p className="mb-3">When you do:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>We create an anonymous session ID stored in your browser</li>
                            <li>This lets you generate trips and see results</li>
                            <li>Anonymous data expires automatically after a limited time</li>
                        </ul>
                        <p>If you later create an account, you can choose to attach those trips to your account.</p>
                    </section>

                    {/* Sharing */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Sharing your information</h2>
                        <p className="mb-4">We do not sell your personal data.</p>
                        <p className="mb-3">We may share limited data with:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Infrastructure providers (hosting, email delivery)</li>
                            <li>Analytics tools (to understand product usage)</li>
                        </ul>
                        <p>All providers are required to protect your data and use it only to support Tripy.</p>
                    </section>

                    {/* Cookies */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Cookies and local storage</h2>
                        <p className="mb-3">We use:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Cookies or local storage to maintain sessions</li>
                            <li>Analytics cookies to understand usage</li>
                        </ul>
                        <p>You can clear your browser storage at any time.</p>
                    </section>

                    {/* Retention */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Data retention</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Anonymous trip data is automatically deleted after a fixed period</li>
                            <li>Account data is retained until you delete your account or request removal</li>
                        </ul>
                    </section>

                    {/* Your choices */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Your choices</h2>
                        <p className="mb-3">You can:</p>
                        <ul className="list-disc pl-6 space-y-2 mb-4">
                            <li>Use Tripy without signing in</li>
                            <li>Update or remove saved trips</li>
                            <li>Request deletion of your account data</li>
                        </ul>
                        <p>
                            To make a request, contact us at{' '}
                            <a href="mailto:tripy@traveltripy.com" className="text-blue-600 hover:underline">
                                tripy@traveltripy.com
                            </a>.
                        </p>
                    </section>

                    {/* Changes */}
                    <section>
                        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Changes to this policy</h2>
                        <p>
                            If we update this policy, we&apos;ll revise the date at the top and make changes clear.
                        </p>
                    </section>
                </div>
            </div>

            <Footer />
        </div>
    );
}
