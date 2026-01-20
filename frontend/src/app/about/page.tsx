'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Plane, CreditCard, Users, Sparkles, Search, Zap, MapPin, Calendar } from 'lucide-react';
import { Navigation } from '@/components/navigation';

interface UserData {
  name?: string;
  email?: string;
}

export default function AboutPage() {
	const [user, setUser] = useState<UserData | null>(null);

	useEffect(() => {
		const checkUser = () => {
			const storedUser = localStorage.getItem('user');
			if (storedUser) {
				try {
					const parsedUser = JSON.parse(storedUser);
					if (parsedUser && (parsedUser.name || parsedUser.email)) {
						setUser(parsedUser);
					}
				} catch (e) {
					console.error('Failed to parse user', e);
				}
			}
		};

		checkUser();
		window.addEventListener('tripy_auth_change', checkUser);
		return () => window.removeEventListener('tripy_auth_change', checkUser);
	}, []);

	return (
		<div className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
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
							AI-powered flight & hotel recommendations using your credit-card points.
						</p>
						{user ? (
							<div className="flex gap-4">
								<Link
									href="/solo/setup"
									className="px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium"
								>
									Plan a Trip
								</Link>
								<Link
									href="/my-trips"
									className="px-8 py-4 bg-white text-slate-900 border-2 border-slate-200 rounded-2xl hover:border-slate-300 transition-all font-medium"
								>
									My Trips
								</Link>
							</div>
						) : (
							<div className="flex gap-4">
								<Link
									href="/login"
									className="px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium"
								>
									Get Started
								</Link>
								<Link
									href="/register"
									className="px-8 py-4 bg-white text-slate-900 border-2 border-slate-200 rounded-2xl hover:border-slate-300 transition-all font-medium"
								>
									Sign Up
								</Link>
							</div>
						)}
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
								Securely connect your loyalty programs and credit card points. We support Amex, Chase, Citi, and more.
							</p>
						</div>

						{/* Step 2 */}
						<div>
							<div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl mb-6 font-bold">
								2
							</div>
							<h3 className="text-2xl mb-3 text-slate-900 font-semibold">Choose Your Destination & Dates</h3>
							<p className="text-slate-600 leading-relaxed">
								Tell us where you want to go and when. Use our smart chatbot to quickly fill in your trip details, or enter them manually.
							</p>
						</div>

						{/* Step 3 */}
						<div>
							<div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl mb-6 font-bold">
								3
							</div>
							<h3 className="text-2xl mb-3 text-slate-900 font-semibold">Get Optimized Recommendations</h3>
							<p className="text-slate-600 leading-relaxed">
								Receive personalized flight and hotel recommendations optimized for your points. Compare cash vs points, see savings, and book directly.
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Key Features Detail Section */}
			<div className="py-24 bg-white">
				<div className="max-w-6xl mx-auto px-8">
					<h2 className="text-5xl text-center mb-20 text-slate-900 font-bold">Why Choose Tripy?</h2>
					
					<div className="grid md:grid-cols-2 gap-12">
						{/* Feature Detail 1 */}
						<div className="bg-slate-50 rounded-2xl p-8">
							<div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
								<Zap className="w-7 h-7 text-white" />
							</div>
							<h3 className="text-2xl mb-4 text-slate-900 font-semibold">Smart Point Optimization</h3>
							<p className="text-slate-600 leading-relaxed">
								Our AI analyzes millions of redemption options to find the best value. Get 3-10x more value per point compared to standard redemptions.
							</p>
						</div>

						{/* Feature Detail 2 */}
						<div className="bg-slate-50 rounded-2xl p-8">
							<div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
								<MapPin className="w-7 h-7 text-white" />
							</div>
							<h3 className="text-2xl mb-4 text-slate-900 font-semibold">Multi-Destination Planning</h3>
							<p className="text-slate-600 leading-relaxed">
								Plan complex multi-city trips with ease. Our system finds the optimal routing and suggests the best order to visit destinations.
							</p>
						</div>

						{/* Feature Detail 3 */}
						<div className="bg-slate-50 rounded-2xl p-8">
							<div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
								<Users className="w-7 h-7 text-white" />
							</div>
							<h3 className="text-2xl mb-4 text-slate-900 font-semibold">Group Trip Collaboration</h3>
							<p className="text-slate-600 leading-relaxed">
								Plan trips with friends and family. Vote on destinations, split costs, and coordinate travel plans all in one place.
							</p>
						</div>

						{/* Feature Detail 4 */}
						<div className="bg-slate-50 rounded-2xl p-8">
							<div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
								<Calendar className="w-7 h-7 text-white" />
							</div>
							<h3 className="text-2xl mb-4 text-slate-900 font-semibold">Flexible Date Planning</h3>
							<p className="text-slate-600 leading-relaxed">
								Not sure when to travel? Our system finds the best dates for your trip based on availability, prices, and point redemptions.
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
						Join thousands of travelers optimizing their points and saving money on every trip.
					</p>
					<div className="flex gap-4 justify-center">
						<Link
							href="/login"
							className="px-8 py-4 bg-yellow-400 text-slate-900 rounded-2xl hover:bg-yellow-300 transition-all shadow-lg hover:shadow-xl font-medium"
						>
							Get Started
						</Link>
						<Link
							href="/register"
							className="px-8 py-4 bg-white text-blue-600 rounded-2xl hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl font-medium"
						>
							Sign Up Free
						</Link>
					</div>
				</div>
			</div>

			{/* Footer */}
			<footer className="bg-slate-900 text-white py-12">
				<div className="max-w-7xl mx-auto px-8">
					<div className="grid md:grid-cols-4 gap-8">
						<div>
							<div className="flex items-center gap-3 mb-4">
								<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
									<Plane className="w-5 h-5 text-white" />
								</div>
								<span className="text-xl font-bold">Tripy</span>
							</div>
							<p className="text-slate-400 text-sm">
								Maximize your travel points and plan smarter trips.
							</p>
						</div>
						<div>
							<h4 className="font-semibold mb-4">Product</h4>
							<ul className="space-y-2 text-sm text-slate-400">
								<li><Link href="/solo/setup" className="hover:text-white">Solo Trips</Link></li>
								<li><Link href="/group/setup" className="hover:text-white">Group Trips</Link></li>
								<li><Link href="/explore" className="hover:text-white">Explore</Link></li>
							</ul>
						</div>
						<div>
							<h4 className="font-semibold mb-4">Company</h4>
							<ul className="space-y-2 text-sm text-slate-400">
								<li><Link href="/about" className="hover:text-white">About</Link></li>
								<li><Link href="/contact" className="hover:text-white">Contact</Link></li>
							</ul>
						</div>
						<div>
							<h4 className="font-semibold mb-4">Legal</h4>
							<ul className="space-y-2 text-sm text-slate-400">
								<li><Link href="/privacy" className="hover:text-white">Privacy Policy</Link></li>
								<li><Link href="/terms" className="hover:text-white">Terms of Service</Link></li>
							</ul>
						</div>
					</div>
					<div className="border-t border-slate-800 mt-8 pt-8 text-center text-sm text-slate-400">
						<p>&copy; {new Date().getFullYear()} Tripy. All rights reserved.</p>
					</div>
				</div>
			</footer>
		</div>
	);
}
