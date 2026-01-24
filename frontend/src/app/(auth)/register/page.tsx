"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plane, Mail, Lock, User, ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import { signup } from "@/lib/api";

export default function RegisterPage() {
	const router = useRouter();
	const [form, setForm] = useState({
		name: "",
		email: "",
		password: "",
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);

	const onChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
	) => {
		const { name, value } = e.target;
		setForm((f) => ({ ...f, [name]: value }));
	};

	const validate = () => {
		const next: Record<string, string> = {};

		if (!form.name.trim()) next.name = "Full name is required";

		if (!form.email.trim()) next.email = "Email is required";
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
			next.email = "Enter a valid email";

		if (!form.password) next.password = "Password is required";
		else if (form.password.length < 8)
			next.password = "Use at least 8 characters";

		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		setErrors({}); // Clear previous errors
		
		try {
			// Split name into firstName and lastName for API
			const nameParts = form.name.trim().split(' ');
			const firstName = nameParts[0] || '';
			const lastName = nameParts.slice(1).join(' ') || '';

			// Call signup API - this creates user in Cognito and database
			const response = await signup({
				email: form.email,
				password: form.password,
				firstName: firstName || undefined,
				lastName: lastName || undefined,
			});

			// Store user info in localStorage
			if (typeof window !== 'undefined') {
				localStorage.setItem('user', JSON.stringify({
					name: form.name,
					email: form.email,
					userId: response.user_id,
				}));
				window.dispatchEvent(new Event('tripy_auth_change'));
			}

			// If confirmation is required, redirect to confirmation page
			if (response.confirmation_required) {
				router.push(`/auth/confirm-signup?email=${encodeURIComponent(form.email)}`);
			} else {
				// User is auto-confirmed - redirect to points setup (same as login flow)
				router.push("/points-setup");
			}
		} catch (err) {
			// Handle different error types from Cognito
			let errorMessage = "Registration failed. Please try again.";
			
			if (err instanceof Error) {
				const msg = err.message.toLowerCase();
				
				// Map common Cognito errors to user-friendly messages
				if (msg.includes('cannot connect') || msg.includes('network')) {
					errorMessage = err.message; // Show the specific network error message
				} else if (msg.includes('already exists') || msg.includes('username exists')) {
					errorMessage = "An account with this email already exists. Please sign in instead.";
				} else if (msg.includes('password') && (msg.includes('policy') || msg.includes('requirement'))) {
					errorMessage = "Password does not meet requirements. Please use at least 8 characters with uppercase, lowercase, numbers, and special characters.";
				} else if (msg.includes('invalid') && msg.includes('email')) {
					errorMessage = "Please enter a valid email address.";
				} else {
					errorMessage = err.message;
				}
				
				// Log error for debugging
				console.error('Signup error:', err);
			}
			
			setErrors({ general: errorMessage });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-full bg-white flex">
			{/* Left Column - Form */}
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<div className="w-full max-w-sm mx-auto">
					{/* Logo */}
					<div className="flex items-center gap-2 mb-10">
						<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
							<Plane className="w-5 h-5 text-white" />
						</div>
						<span className="text-xl font-bold text-slate-900">Tripy</span>
					</div>

					<div className="mb-8">
						<h1 className="text-3xl font-bold text-slate-900 mb-3">Create your account</h1>
						<p className="text-slate-600">
							Start optimizing your travel points today.
						</p>
					</div>

					{errors.general && (
						<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
							{errors.general}
						</div>
					)}

					<form onSubmit={onSubmit} className="space-y-5">
						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1.5">
								Full Name
							</label>
							<div className="relative">
								<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
									<User className="h-5 w-5 text-slate-400" />
								</div>
								<input
									type="text"
									name="name"
									required
									value={form.name}
									onChange={onChange}
									className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
										errors.name ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="John Doe"
								/>
							</div>
							{errors.name && (
								<p className="mt-1 text-xs text-red-600">{errors.name}</p>
							)}
						</div>

						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1.5">
								Email Address
							</label>
							<div className="relative">
								<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
									<Mail className="h-5 w-5 text-slate-400" />
								</div>
								<input
									type="email"
									name="email"
									required
									value={form.email}
									onChange={onChange}
									className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
										errors.email ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="you@example.com"
								/>
							</div>
							{errors.email && (
								<p className="mt-1 text-xs text-red-600">{errors.email}</p>
							)}
						</div>

						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1.5">
								Password
							</label>
							<div className="relative">
								<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
									<Lock className="h-5 w-5 text-slate-400" />
								</div>
								<input
									type={showPassword ? "text" : "password"}
									name="password"
									required
									value={form.password}
									onChange={onChange}
									className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
										errors.password ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="••••••••"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
								>
									{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
								</button>
							</div>
							{errors.password && (
								<p className="mt-1 text-xs text-red-600">{errors.password}</p>
							)}
						</div>

						<button
							type="submit"
							disabled={submitting}
							className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed font-medium"
						>
							{submitting ? (
								'Creating account...'
							) : (
								<>
									Get Started <ArrowRight className="w-4 h-4" />
								</>
							)}
						</button>
					</form>

					<div className="mt-8 pt-8 border-t border-slate-100 text-center">
						<p className="text-sm text-slate-600">
							Already have an account?{' '}
							<Link href="/login" className="text-blue-600 font-medium hover:text-blue-700">
								Sign in
							</Link>
						</p>
					</div>
				</div>
			</div>

			{/* Right Column - Feature Showcase */}
			<div className="hidden lg:flex flex-1 bg-slate-50 relative overflow-hidden">
				{/* Abstract Background */}
				<div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800"></div>
				<div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop')] bg-cover bg-center opacity-20 mix-blend-overlay"></div>
				
				{/* Content */}
				<div className="relative z-10 flex flex-col justify-center px-16 text-white h-full max-w-2xl mx-auto">
					<div className="mb-12">
						<h2 className="text-4xl font-bold mb-6 leading-tight">
							Turn your points into <br/>
							<span className="text-yellow-400">unforgettable trips</span>
						</h2>
						<p className="text-blue-100 text-lg leading-relaxed">
							Join thousands of travelers who are maximizing their credit card rewards and traveling for pennies on the dollar.
						</p>
					</div>

					<div className="space-y-6">
						<div className="flex items-start gap-4 p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10">
							<div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0">
								<Check className="w-5 h-5 text-blue-900" />
							</div>
							<div>
								<h3 className="font-semibold text-lg mb-1">Smart Point Optimization</h3>
								<p className="text-blue-100 text-sm">Automatically calculate the best redemption value across all your cards.</p>
							</div>
						</div>

						<div className="flex items-start gap-4 p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10">
							<div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0">
								<Check className="w-5 h-5 text-blue-900" />
							</div>
							<div>
								<h3 className="font-semibold text-lg mb-1">Collaborative Planning</h3>
								<p className="text-blue-100 text-sm">Vote on destinations and split costs seamlessly with friends.</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
