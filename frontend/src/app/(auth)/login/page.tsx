"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plane, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { auth } from "@/lib/api";
import { DEV_AUTH_BYPASS, ensureDevSession } from "@/lib/dev-auth";
import { syncSessionCookie } from "@/lib/session-cookie";

function LoginForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const redirectPath = searchParams.get('redirect');
	const [form, setForm] = useState({ email: "", password: "" });
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [unconfirmed, setUnconfirmed] = useState(false);
	const [resending, setResending] = useState(false);
	const [resendNotice, setResendNotice] = useState("");
	const [resendCooldown, setResendCooldown] = useState(0);

	// Tick down the resend cooldown so we don't spam Cognito (which rate-limits).
	useEffect(() => {
		if (resendCooldown <= 0) return;
		const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
		return () => clearTimeout(t);
	}, [resendCooldown]);

	const onResend = async () => {
		setResendNotice("");
		setResending(true);
		try {
			await auth.resendConfirmation(form.email.trim());
			setResendNotice("A new verification email is on its way. Check your inbox (and spam folder).");
			setResendCooldown(30); // seconds before they can request another
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Could not resend the email. Please try again.";
			setErrors({ general: message });
		} finally {
			setResending(false);
		}
	};

	// Local dev: clicking "Sign In" (which routes here) should just log you in —
	// seed the fake session and bounce straight to the destination.
	useEffect(() => {
		if (!DEV_AUTH_BYPASS) return;
		ensureDevSession();
		router.replace(redirectPath || "/explore");
	}, [router, redirectPath]);

	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
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
		setErrors({});
		setUnconfirmed(false);
		setResendNotice("");

		try {
			const response = await auth.login({ email: form.email, password: form.password });
			localStorage.setItem('tripy_token', response.tokens.id_token);
			// Mirror the token into an httpOnly cookie so server components can
			// render this user's data on the server (deeper first-load latency fix).
			// Fire-and-forget: this is best-effort, and blocking navigation on it
			// only adds latency — the app falls back to client-side fetch if it fails.
			void syncSessionCookie(response.tokens.id_token);
			localStorage.setItem('tripy_user', JSON.stringify(response.user));
			localStorage.setItem('user', JSON.stringify({
				name: response.user.name,
				email: response.user.email,
				userId: response.user.userId,
			}));
			window.dispatchEvent(new Event('tripy_auth_change'));
			router.push(redirectPath || "/dashboard");
		} catch (err) {
			let message = "Login failed. Please try again.";
			if (err instanceof Error) {
				const msg = err.message;
				const lower = msg.toLowerCase();
				if (lower.includes('not confirmed')) {
					message = "Your email isn't verified yet. Check your inbox for the verification email.";
					setUnconfirmed(true);
				} else if (lower.includes('too many')) {
					message = "Too many attempts. Please try again later.";
				} else if (lower.includes('invalid email or password')) {
					message = "Invalid email or password.";
				} else {
					// Show the actual error so infrastructure/config problems are visible
					message = msg;
				}
			}
			setErrors({ general: message });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="w-full max-w-sm mx-auto">
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">TripsHacker</span>
			</div>

			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome back</h1>
				<p className="text-slate-600">Sign in to your account.</p>
			</div>

			{errors.general && (
				<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
					<p>{errors.general}</p>
					{unconfirmed && (
						<div className="mt-2">
							<button
								type="button"
								onClick={onResend}
								disabled={resending || resendCooldown > 0}
								className="font-medium text-red-800 underline underline-offset-2 hover:text-red-900 disabled:no-underline disabled:opacity-60 disabled:cursor-not-allowed"
							>
								{resending
									? "Sending..."
									: resendCooldown > 0
										? `Resend available in ${resendCooldown}s`
										: "Resend verification email"}
							</button>
						</div>
					)}
				</div>
			)}

			{resendNotice && (
				<div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
					<p>{resendNotice}</p>
					<Link
						href={`/auth/confirm-signup?email=${encodeURIComponent(form.email)}`}
						className="mt-1 inline-block font-medium text-green-800 underline underline-offset-2 hover:text-green-900"
					>
						Enter your verification code
					</Link>
				</div>
			)}

			<form onSubmit={onSubmit} className="space-y-5">
				<div>
					<label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
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
					{errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
				</div>

				<div>
					<div className="flex items-center justify-between mb-1.5">
						<label className="block text-sm font-medium text-slate-700">Password</label>
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
					{errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
				</div>

				<button
					type="submit"
					disabled={submitting}
					className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed font-medium"
				>
					{submitting ? 'Signing in...' : (
						<>Sign In <ArrowRight className="w-4 h-4" /></>
					)}
				</button>
			</form>

			<div className="mt-8 pt-8 border-t border-slate-100 text-center">
				<p className="text-sm text-slate-600">
					Don&apos;t have an account?{' '}
					<Link href={redirectPath ? `/register?redirect=${encodeURIComponent(redirectPath)}` : "/register"} className="text-blue-600 font-medium hover:text-blue-700">
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
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">TripsHacker</span>
			</div>
			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome back</h1>
				<p className="text-slate-600">Sign in to your account.</p>
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
		<div data-testid="login-page" className="min-h-full bg-white flex">
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<Suspense fallback={<LoginFormFallback />}>
					<LoginForm />
				</Suspense>
			</div>

			<div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-blue-700 relative overflow-hidden">
				{/* Large faint background quote mark for depth */}
				<span className="absolute -top-8 -left-4 text-[22rem] font-serif text-white/[0.04] leading-none select-none pointer-events-none">"</span>

				<div className="relative px-14 w-full max-w-[26rem]">
					{/* Opening quote mark */}
					<div className="text-blue-300 text-5xl font-serif leading-none mb-4 select-none">"</div>

					{/* Quote */}
					<blockquote className="text-white text-2xl font-light leading-relaxed" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
						Better travel planning starts with better understanding of the traveler.
					</blockquote>

					{/* Rule */}
					<div className="mt-8 w-10 border-t-2 border-blue-300/50" />

					{/* Body */}
					<p className="mt-6 text-blue-100 text-sm leading-relaxed">
						TripsHacker gives trip hackers a structured space to capture your preferences, build a lasting profile, and plan trips that feel effortlessly personal.
					</p>

					{/* Feature tags */}
					<div className="mt-8 flex items-center gap-5">
						<div className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-blue-200" />
							<span className="text-blue-100 text-xs tracking-wide">Discovery</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-blue-200" />
							<span className="text-blue-100 text-xs tracking-wide">Profiles</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-blue-200" />
							<span className="text-blue-100 text-xs tracking-wide">Planning</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
