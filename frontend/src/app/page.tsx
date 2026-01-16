'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plane, CreditCard, Users, Sparkles, Search } from 'lucide-react';

export default function LandingPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is logged in
        const token = localStorage.getItem('auth_token');
        if (token) {
            // User is logged in, redirect to dashboard
            router.push('/dashboard');
        } else {
            setLoading(false);
        }
    }, [router]);

    // Show loading state while checking auth
    if (loading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
            {/* Hero Section */}
            <div className="max-w-7xl mx-auto px-8 pt-20 pb-32">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    {/* Left Column */}
                    <div>
                        <h1 className="text-6xl lg:text-7xl mb-6 tracking-tight text-slate-900 leading-tight font-bold">
                            Spend Less.
                            <br />
                            Travel Smarter.
                        </h1>
                        <p className="text-xl text-slate-600 mb-8 leading-relaxed max-w-lg">
                            AI-powered flight & hotel recommendations using your credit-card points.
                        </p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => {
                                    // Set demo token to access dashboard
                                    localStorage.setItem('auth_token', 'demo-token');
                                    localStorage.setItem('user', JSON.stringify({
                                        name: 'Demo User',
                                        email: 'demo@tripy.com'
                                    }));
                                    router.push('/dashboard');
                                }}
                                className="px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium"
                            >
                                Try Demo
                            </button>
                            <Link
                                href="/register"
                                className="px-8 py-4 bg-white text-slate-900 border-2 border-slate-200 rounded-2xl hover:border-slate-300 transition-all font-medium"
                            >
                                Sign Up
                            </Link>
                        </div>
                        <p className="text-sm text-slate-500 mt-4">
                            No signup required for demo • Full access to all features
                        </p>
                    </div>

                    {/* Right Column - Illustration */}
                    <div className="relative">
                        <div className="relative aspect-square max-w-lg mx-auto">
                            {/* Globe Background */}
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-200 via-blue-300 to-cyan-200 rounded-full opacity-20 blur-3xl"></div>

                            {/* Card Illustration */}
                            <div className="absolute top-1/4 left-1/4 w-64 h-40 bg-gradient-to-br from-blue-500 to-blue-600 rounded-3xl shadow-2xl transform -rotate-12 hover:rotate-0 transition-transform duration-500">
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-8">
                                        <div className="w-12 h-10 bg-yellow-400 rounded-lg"></div>
                                        <div className="text-white/60 text-xs">TRIPY</div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="w-12 h-8 bg-yellow-400 rounded"></div>
                                        <div className="w-12 h-8 bg-yellow-400 rounded"></div>
                                        <div className="w-12 h-8 bg-yellow-400 rounded"></div>
                                    </div>
                                    <div className="absolute bottom-6 right-6 w-10 h-10 bg-yellow-400 rounded-full"></div>
                                </div>
                            </div>

                            {/* Points Badge */}
                            <div className="absolute bottom-1/4 right-1/4 bg-white rounded-2xl shadow-2xl p-6 hover:scale-105 transition-transform">
                                <div className="flex items-center gap-3 mb-2">
                                    <Plane className="w-6 h-6 text-blue-600" />
                                    <div className="text-sm text-slate-600">A GO FOR POINTS</div>
                                </div>
                                <div className="text-4xl font-bold text-slate-900">90,000</div>
                                <div className="text-sm text-slate-600 mt-1">Points</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Features Section */}
            <div className="bg-white py-24">
                <div className="max-w-7xl mx-auto px-8">
                    <h2 className="text-5xl text-center mb-16 text-slate-900 font-bold">How It Works</h2>

                    <div className="grid md:grid-cols-4 gap-12">
                        {/* Feature 1 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <Plane className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Maximize Your Points</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Get the most value from Amex, Chase points, and more
                            </p>
                        </div>

                        {/* Feature 2 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <CreditCard className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Multi-Card Optimization</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Finds redemptions that give 3-10x value per point
                            </p>
                        </div>

                        {/* Feature 3 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <Users className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Collaborative Travel</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Plan, split, vote on destinations with your whole group
                            </p>
                        </div>

                        {/* Feature 4 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <Search className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Transparent Flight Search</h3>
                            <p className="text-slate-600 leading-relaxed">
                                See cash vs points, time savings, and hidden routing options
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Steps Section */}
            <div className="py-24 bg-slate-50">
                <div className="max-w-6xl mx-auto px-8">
                    <h2 className="text-5xl text-center mb-20 text-slate-900 font-bold">Get Started in 3 Steps</h2>

                    <div className="grid md:grid-cols-3 gap-16">
                        {/* Step 1 */}
                        <div>
                            <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl mb-6 font-bold">
                                1
                            </div>
                            <h3 className="text-2xl mb-3 text-slate-900 font-semibold">Connect Your Cards</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Securely connect your loyalty programs
                            </p>
                        </div>

                        {/* Step 2 */}
                        <div>
                            <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl mb-6 font-bold">
                                2
                            </div>
                            <h3 className="text-2xl mb-3 text-slate-900 font-semibold">Choose Your Destination & Dates</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Choose where and when you want travel
                            </p>
                        </div>

                        {/* Step 3 */}
                        <div>
                            <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl mb-6 font-bold">
                                3
                            </div>
                            <h3 className="text-2xl mb-3 text-slate-900 font-semibold">Get Optimized Cash + Points Recommendations</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Pick from top flight + hotel recommendations
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="py-24 bg-gradient-to-br from-blue-600 to-blue-700">
                <div className="max-w-4xl mx-auto px-8 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full mb-6">
                        <Sparkles className="w-4 h-4 text-white" />
                        <span className="text-white text-sm font-medium">Start Planning Today</span>
                    </div>
                    <h2 className="text-5xl mb-6 text-white font-bold">
                        Ready to travel smarter?
                    </h2>
                    <p className="text-xl text-blue-100 mb-10 leading-relaxed">
                        Join thousands of travelers optimizing their points and saving money
                    </p>
                    <div className="flex gap-4 justify-center">
                        <button
                            onClick={() => {
                                // Set demo token to access dashboard
                                localStorage.setItem('auth_token', 'demo-token');
                                localStorage.setItem('user', JSON.stringify({
                                    name: 'Demo User',
                                    email: 'demo@tripy.com'
                                }));
                                router.push('/dashboard');
                            }}
                            className="px-8 py-4 bg-yellow-400 text-slate-900 rounded-2xl hover:bg-yellow-300 transition-all shadow-lg hover:shadow-xl font-medium"
                        >
                            Try Demo
                        </button>
                        <Link
                            href="/register"
                            className="px-8 py-4 bg-white text-blue-600 rounded-2xl hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl font-medium"
                        >
                            Sign Up
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
