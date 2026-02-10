"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plane, Mail, ArrowRight, CheckCircle2 } from "lucide-react";
import { confirmSignup } from "@/lib/api";

function ConfirmSignupForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [confirmed, setConfirmed] = useState(false);

	const redirectPath = searchParams.get("redirect");

	useEffect(() => {
		// Get email from URL query parameter
		const emailParam = searchParams.get("email");
		if (emailParam) {
			setEmail(emailParam);
		}
	}, [searchParams]);

	const validate = () => {
		const next: Record<string, string> = {};

		if (!email.trim()) next.email = "Email is required";
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
			next.email = "Enter a valid email";

		if (!code.trim()) next.code = "Confirmation code is required";
		else if (code.length !== 6) next.code = "Code must be 6 digits";

		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		setErrors({});

		try {
			// Call confirm signup API - this confirms the user in Cognito
			await confirmSignup({
				email: email,
				confirmation_code: code,
			});

			// On success, mark as confirmed
			setConfirmed(true);

			// Redirect to login page after a brief delay, preserving the redirect param
			setTimeout(() => {
				const loginUrl = redirectPath
					? `/login?redirect=${encodeURIComponent(redirectPath)}`
					: "/login";
				router.push(loginUrl);
			}, 2000);
		} catch (err) {
			// Handle different error types
			let errorMessage = "Invalid confirmation code. Please try again.";
			
			if (err instanceof Error) {
				const msg = err.message.toLowerCase();
				
				if (msg.includes("invalid") || msg.includes("mismatch")) {
					errorMessage = "Invalid confirmation code. Please check your email and try again.";
				} else if (msg.includes("expired")) {
					errorMessage = "Confirmation code has expired. Please request a new code.";
				} else {
					errorMessage = err.message;
				}
			}
			
			setErrors({ general: errorMessage });
		} finally {
			setSubmitting(false);
		}
	};

	if (confirmed) {
		return (
			<div className="min-h-full bg-white flex">
				<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
					<div className="w-full max-w-sm mx-auto text-center">
						<div className="flex items-center justify-center gap-2 mb-10">
							<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
								<Plane className="w-5 h-5 text-white" />
							</div>
							<span className="text-xl font-bold text-slate-900">Tripy</span>
						</div>

						<div className="mb-8">
							<div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
								<CheckCircle2 className="w-8 h-8 text-green-600" />
							</div>
							<h1 className="text-3xl font-bold text-slate-900 mb-3">Account confirmed!</h1>
							<p className="text-slate-600">
								Your account has been successfully confirmed. Redirecting to login...
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

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
						<h1 className="text-3xl font-bold text-slate-900 mb-3">Confirm your email</h1>
						<p className="text-slate-600">
							We sent a confirmation code to <strong>{email || "your email"}</strong>. Please enter it below.
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
									value={email}
									onChange={(e) => setEmail(e.target.value)}
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
								Confirmation Code
							</label>
							<input
								type="text"
								name="code"
								required
								value={code}
								onChange={(e) => {
									// Only allow digits and limit to 6 characters
									const value = e.target.value.replace(/\D/g, "").slice(0, 6);
									setCode(value);
								}}
								className={`block w-full px-4 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all text-center text-2xl tracking-widest font-mono ${
									errors.code ? "border-red-500" : "border-slate-200"
								}`}
								placeholder="000000"
								maxLength={6}
							/>
							{errors.code && (
								<p className="mt-1 text-xs text-red-600">{errors.code}</p>
							)}
							<p className="mt-2 text-xs text-slate-500">
								Didn&apos;t receive a code? Check your spam folder or{" "}
								<Link href={redirectPath ? `/register?redirect=${encodeURIComponent(redirectPath)}` : "/register"} className="text-blue-600 hover:text-blue-700 font-medium">
									sign up again
								</Link>
							</p>
						</div>

						<button
							type="submit"
							disabled={submitting}
							className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed font-medium"
						>
							{submitting ? (
								"Confirming..."
							) : (
								<>
									Confirm Account <ArrowRight className="w-4 h-4" />
								</>
							)}
						</button>
					</form>

				<div className="mt-8 pt-8 border-t border-slate-100 text-center">
					<p className="text-sm text-slate-600">
						Already confirmed?{" "}
						<Link href={redirectPath ? `/login?redirect=${encodeURIComponent(redirectPath)}` : "/login"} className="text-blue-600 font-medium hover:text-blue-700">
							Sign in
						</Link>
					</p>
				</div>
				</div>
			</div>

			{/* Right Column - Image */}
			<div className="hidden lg:block flex-1 bg-slate-50 relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-600/90 to-blue-800/90 mix-blend-multiply z-10"></div>
				<div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center"></div>
				<div className="relative z-20 flex items-center justify-center h-full text-white text-center px-12">
					<div>
						<h2 className="text-4xl font-bold mb-4">Verify your email</h2>
						<p className="text-xl text-blue-100">Check your inbox for the confirmation code</p>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function ConfirmSignupPage() {
	return (
		<Suspense fallback={
			<div className="min-h-full bg-white flex items-center justify-center">
				<div className="text-slate-600">Loading...</div>
			</div>
		}>
			<ConfirmSignupForm />
		</Suspense>
	);
}
