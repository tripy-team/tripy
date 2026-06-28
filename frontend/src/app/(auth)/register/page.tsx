"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plane, Mail, Lock, User, ArrowRight, Eye, EyeOff, Check } from "lucide-react";
import { auth } from "@/lib/api";

const PASSWORD_REQUIREMENTS = [
	{ label: "At least 8 characters", test: (p: string) => p.length >= 8 },
	{ label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
	{ label: "At least one lowercase letter", test: (p: string) => /[a-z]/.test(p) },
];

function RegisterForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const redirectPath = searchParams.get('redirect');
	const [form, setForm] = useState({
		firstName: "",
		lastName: "",
		email: "",
		password: "",
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);

	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
	};

	const validate = () => {
		const next: Record<string, string> = {};
		if (!form.firstName.trim()) next.firstName = "First name is required";
		if (!form.lastName.trim()) next.lastName = "Last name is required";
		if (!form.email.trim()) next.email = "Email is required";
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
			next.email = "Enter a valid email";
		if (!form.password) next.password = "Password is required";
		else if (PASSWORD_REQUIREMENTS.some((r) => !r.test(form.password)))
			next.password = "Password does not meet the requirements below";
		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		setErrors({});

		try {
			const email = form.email.trim();
			// Create the Cognito user via the backend. No tokens are issued yet —
			// the user must verify their email before they can log in. (The Prisma
			// org/user record is auto-provisioned on first authenticated request.)
			const response = await auth.signup({
				email,
				password: form.password,
				firstName: form.firstName.trim(),
				lastName: form.lastName.trim(),
			});

			const redirectQs = redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : "";

			if (response.confirmation_required) {
				// Cognito emailed a 6-digit code — finish on the confirmation page.
				router.push(`/auth/confirm-signup?email=${encodeURIComponent(email)}${redirectQs}`);
			} else {
				// Auto-confirmed account — send straight to login.
				router.push(redirectPath ? `/login?redirect=${encodeURIComponent(redirectPath)}` : "/login");
			}
		} catch (err) {
			let message = "Registration failed. Please try again.";
			if (err instanceof Error) {
				const msg = err.message.toLowerCase();
				if (msg.includes('already exists')) message = "An account with this email already exists.";
				else if (msg.includes('password')) message = "Password does not meet the requirements: at least 8 characters, one number, and one lowercase letter.";
				else message = err.message;
			}
			setErrors({ general: message });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div data-testid="register-page" className="min-h-full bg-white flex">
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<div className="w-full max-w-sm mx-auto">
					<div className="flex items-center gap-2 mb-10">
						<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
							<Plane className="w-5 h-5 text-white" fill="currentColor" />
						</div>
						<span className="text-xl font-bold text-slate-900">TripsHacker</span>
					</div>

					<div className="mb-8">
						<h1 className="text-3xl font-bold text-slate-900 mb-3">Create your account</h1>
						<p className="text-slate-600">
							Start planning cheaper, smarter trips in minutes. Free to start.
						</p>
					</div>

					{errors.general && (
						<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
							{errors.general}
						</div>
					)}

					<form onSubmit={onSubmit} className="space-y-5">
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
								<div className="relative">
									<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
										<User className="h-5 w-5 text-slate-400" />
									</div>
									<input
										type="text"
										name="firstName"
										required
										value={form.firstName}
										onChange={onChange}
										className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
											errors.firstName ? "border-red-500" : "border-slate-200"
										}`}
										placeholder="John"
									/>
								</div>
								{errors.firstName && <p className="mt-1 text-xs text-red-600">{errors.firstName}</p>}
							</div>
							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1.5">Last Name *</label>
								<input
									type="text"
									name="lastName"
									required
									value={form.lastName}
									onChange={onChange}
									className={`block w-full px-3 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
										errors.lastName ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="Doe"
								/>
								{errors.lastName && <p className="mt-1 text-xs text-red-600">{errors.lastName}</p>}
							</div>
						</div>

						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address *</label>
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
									className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
										errors.email ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="you@example.com"
								/>
							</div>
							{errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
						</div>

						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1.5">Password *</label>
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
									className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
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
							{errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
							<ul className="mt-2 space-y-1">
								{PASSWORD_REQUIREMENTS.map((req) => {
									const met = req.test(form.password);
									return (
										<li
											key={req.label}
											className={`flex items-center gap-1.5 text-xs ${
												met ? "text-green-600" : "text-slate-500"
											}`}
										>
											<Check
												className={`h-3.5 w-3.5 flex-shrink-0 ${
													met ? "text-green-600" : "text-slate-300"
												}`}
											/>
											{req.label}
										</li>
									);
								})}
							</ul>
						</div>

						<button
							type="submit"
							disabled={submitting}
							className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed font-medium"
						>
							{submitting ? 'Creating workspace...' : (
								<>Start Free Trial <ArrowRight className="w-4 h-4" /></>
							)}
						</button>
					</form>

					<div className="mt-8 pt-8 border-t border-slate-100 text-center">
						<p className="text-sm text-slate-600">
							Already have an account?{' '}
							<Link href={redirectPath ? `/login?redirect=${encodeURIComponent(redirectPath)}` : "/login"} className="text-blue-600 font-medium hover:text-blue-700">
								Sign in
							</Link>
						</p>
					</div>
				</div>
			</div>

			<div className="hidden lg:flex flex-1 bg-slate-50 relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800"></div>
				<div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop')] bg-cover bg-center opacity-20 mix-blend-overlay"></div>

				<div className="relative z-10 flex flex-col justify-center px-16 text-white h-full max-w-2xl mx-auto">
					<div className="mb-12">
						<h2 className="text-4xl font-bold mb-6 leading-tight">
							Stop rebuilding points strategies<br/>
							<span className="text-yellow-400">from scratch</span>
						</h2>
						<p className="text-blue-100 text-lg leading-relaxed">
							Store your loyalty balances, get optimized recommendations, and book smarter — all in one place.
						</p>
					</div>

					<div className="space-y-6">
						{[
							{ title: 'Your Travel Profile', desc: 'Store your loyalty balances and preferences once. Reuse them across every trip.' },
							{ title: 'Smart Recommendations', desc: 'Get personalized cash-vs-points recommendations for every trip.' },
							{ title: 'Savings You Can See', desc: 'Track how much you save with points and smart booking.' },
						].map((item) => (
							<div key={item.title} className="flex items-start gap-4 p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10">
								<div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center flex-shrink-0">
									<Check className="w-5 h-5 text-blue-900" />
								</div>
								<div>
									<h3 className="font-semibold text-lg mb-1">{item.title}</h3>
									<p className="text-blue-100 text-sm">{item.desc}</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function RegisterFormFallback() {
	return (
		<div className="min-h-full bg-white flex">
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<div className="w-full max-w-sm mx-auto">
					<div className="flex items-center gap-2 mb-10">
						<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
							<Plane className="w-5 h-5 text-white" fill="currentColor" />
						</div>
						<span className="text-xl font-bold text-slate-900">TripsHacker</span>
					</div>
					<div className="mb-8">
						<h1 className="text-3xl font-bold text-slate-900 mb-3">Create your account</h1>
						<p className="text-slate-600">Start planning cheaper, smarter trips in minutes.</p>
					</div>
					<div className="space-y-5 animate-pulse">
						<div className="h-12 bg-slate-200 rounded-xl"></div>
						<div className="h-12 bg-slate-200 rounded-xl"></div>
						<div className="h-12 bg-slate-200 rounded-xl"></div>
						<div className="h-12 bg-blue-200 rounded-xl"></div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function RegisterPage() {
	return (
		<Suspense fallback={<RegisterFormFallback />}>
			<RegisterForm />
		</Suspense>
	);
}
