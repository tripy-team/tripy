"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plane, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/api";

function LoginForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const redirectPath = searchParams.get('redirect');
	const [form, setForm] = useState({
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
			// Call login API - this authenticates with Cognito via backend
			const response = await login({
				email: form.email,
				password: form.password,
			});
			
			// Store user info in localStorage for navigation component
			if (typeof window !== 'undefined' && response.user) {
				localStorage.setItem('user', JSON.stringify({
					name: response.user.name || form.email.split('@')[0],
					email: response.user.email,
					userId: response.user.userId,
				}));
				// Dispatch event to notify other components of auth change
				window.dispatchEvent(new Event('tripy_auth_change'));
			}
			
			// On success, redirect to the specified page or default to points setup
			const destination = redirectPath || "/points-setup";
			router.push(destination);
		} catch (err) {
			// Handle different error types from Cognito
			let errorMessage = "Invalid email or password.";
			
			if (err instanceof Error) {
				const msg = err.message.toLowerCase();
				
				// Map common Cognito errors to user-friendly messages
				if (msg.includes('not confirmed') || msg.includes('confirmation')) {
					errorMessage = "Your account is not confirmed. Please check your email for a verification code.";
				} else if (msg.includes('not found') || msg.includes('does not exist')) {
					errorMessage = "No account found with this email address.";
				} else if (msg.includes('password') || msg.includes('not authorized')) {
					errorMessage = "Invalid email or password.";
				} else if (msg.includes('too many')) {
					errorMessage = "Too many login attempts. Please try again later.";
				} else {
					errorMessage = err.message;
				}
			}
			
			setErrors({ general: errorMessage });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="w-full max-w-sm mx-auto">
			{/* Logo */}
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">Tripy</span>
			</div>

			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome back</h1>
				<p className="text-slate-600">
					Continue your travel planning journey.
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
					<div className="flex items-center justify-between mb-1.5">
						<label className="block text-sm font-medium text-slate-700">
							Password
						</label>
						<Link href="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
							Forgot password?
						</Link>
					</div>
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
						'Signing in...'
					) : (
						<>
							Sign In <ArrowRight className="w-4 h-4" />
						</>
					)}
				</button>
			</form>

			<div className="mt-8 pt-8 border-t border-slate-100 text-center">
				<p className="text-sm text-slate-600">
					Don&apos;t have an account?{' '}
					<Link href="/register" className="text-blue-600 font-medium hover:text-blue-700">
						Sign up
					</Link>
				</p>
			</div>
		</div>
	);
}

function LoginFormFallback() {
	return (
		<div className="w-full max-w-sm mx-auto">
			{/* Logo */}
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">Tripy</span>
			</div>

			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome back</h1>
				<p className="text-slate-600">
					Continue your travel planning journey.
				</p>
			</div>

			<div className="space-y-5 animate-pulse">
				<div className="h-12 bg-slate-200 rounded-xl"></div>
				<div className="h-12 bg-slate-200 rounded-xl"></div>
				<div className="h-12 bg-blue-200 rounded-xl"></div>
			</div>
		</div>
	);
}

export default function LoginPage() {
	return (
		<div data-testid="login-page" data-slot="Login" className="min-h-full bg-white flex">
			{/* Left Column - Form */}
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<Suspense fallback={<LoginFormFallback />}>
					<LoginForm />
				</Suspense>
			</div>

			{/* Right Column - Image */}
			<div className="hidden lg:block flex-1 bg-slate-50 relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-600/90 to-blue-800/90 mix-blend-multiply z-10"></div>
				<div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center"></div>
				<div className="relative z-20 flex items-center justify-center h-full text-white text-center px-12">
					<div>
						<h2 className="text-4xl font-bold mb-4">Welcome back to Tripy</h2>
						<p className="text-xl text-blue-100">Your next adventure awaits.</p>
					</div>
				</div>
			</div>
		</div>
	);
}
