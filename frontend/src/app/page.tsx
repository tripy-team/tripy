'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plane, CreditCard, PiggyBank, Sparkles, Search } from 'lucide-react';
import { Navigation } from '@/components/navigation';
import Footer from '@/components/footer';

export default function LandingPage() {
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);
    const hasRedirectedRef = useRef(false);
    
    useEffect(() => {
        // Check if user is logged in - only run once
        const checkAuth = () => {
            // Prevent multiple redirects using ref
            if (hasRedirectedRef.current) {
                return;
            }

            const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
            const authToken = localStorage.getItem('auth_token');
            
            // Check if user data exists (required for authentication)
            const storedUser = localStorage.getItem('user');
            
            // Only redirect if we have tokens AND user data
            if ((accessToken || authToken) && storedUser) {
                try {
                    const parsedUser = JSON.parse(storedUser);
                    if (parsedUser && (parsedUser.name || parsedUser.email)) {
                        // User is logged in, redirect to dashboard
                        // Use replace instead of push to avoid adding to history stack
                        hasRedirectedRef.current = true;
                        router.replace('/dashboard');
                        return;
                    }
                } catch (_e) {
                    // Invalid user data, clear and continue
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
            
            // User is not logged in, show landing page
            setIsChecking(false);
        };

        checkAuth();
    }, [router]);

    // Show loading state while checking authentication
    if (isChecking) {
        return (
            <div data-testid="home-loading" data-slot="loading-spinner-wrapper" className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
                <Navigation />
                <div className="flex items-center justify-center min-h-screen">
                    <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-4 text-slate-600">Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Landing page - shown when user is NOT logged in
    // All buttons lead to login or signup pages

    return (
        <div data-testid="home-page" data-slot="Home" className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
            {/* Consistent Navigation */}
            <Navigation />

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
                            Optimized flight recommendations using your credit-card points.
                        </p>
                        <div className="flex gap-4">
                            <Link
                                href="/solo/setup"
                                className="px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium"
                            >
                                Plan My Trip
                            </Link>
                            <Link
                                href="/pricing"
                                className="px-8 py-4 bg-white text-slate-900 border-2 border-slate-200 rounded-2xl hover:border-slate-300 transition-all font-medium"
                            >
                                See Pricing
                            </Link>
                        </div>
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
                                    <Plane className="w-6 h-6 text-blue-600"  />
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
                    
                    <div className="grid md:grid-cols-3 gap-12">
                        {/* Feature 1 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <PiggyBank className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Save Thousands on Travel</h3>
                            <p className="text-slate-600 leading-relaxed">
                                Turn your credit card points into flights worth 3-10x more than cash back
                            </p>
                        </div>

                        {/* Feature 2 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <CreditCard className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Multi-Card Optimization</h3>
                            <p className="text-slate-600 leading-relaxed">
                                We find the best transfer paths across all your cards to maximize savings
                            </p>
                        </div>

                        {/* Feature 3 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center transform hover:scale-110 transition-transform">
                                <Search className="w-10 h-10 text-blue-600" />
                            </div>
                            <h3 className="text-xl mb-3 text-slate-900 font-semibold">Compare Cash vs Points</h3>
                            <p className="text-slate-600 leading-relaxed">
                                See exactly how much you save with points vs paying cash
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
                        <Link
                            href="/solo/setup"
                            className="px-8 py-4 bg-yellow-400 text-slate-900 rounded-2xl hover:bg-yellow-300 transition-all shadow-lg hover:shadow-xl font-medium"
                        >
                            Plan My Trip — Free
                        </Link>
                    </div>
                </div>
            </div>

            <Footer />
        </div>
    );
}
