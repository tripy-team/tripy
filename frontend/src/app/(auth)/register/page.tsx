"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function RegisterPage() {
	const [form, setForm] = useState({
		firstName: "",
		lastName: "",
		email: "",
		password: "",
		confirm: "",
		agree: false,
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [showPw, setShowPw] = useState(false);

	const onChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
	) => {
		const { name, value, type, checked } = e.target as HTMLInputElement;
		setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
	};

	const validate = () => {
		const next: Record<string, string> = {};

		if (!form.firstName.trim()) next.firstName = "First name is required";
		if (!form.lastName.trim()) next.lastName = "Last name is required";

		if (!form.email.trim()) next.email = "Email is required";
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
			next.email = "Enter a valid email";

		if (!form.password) next.password = "Password is required";
		else if (form.password.length < 8)
			next.password = "Use at least 8 characters";

		if (!form.confirm) next.confirm = "Please confirm your password";
		else if (form.confirm !== form.password)
			next.confirm = "Passwords do not match";

		if (!form.agree)
			next.agree = "You must agree to the Terms & Privacy Policy";

		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		try {
			// TODO: Implement registration API call
			// Endpoint needed: POST /auth/register (needs to be added to backend)
			// Data to send: { firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password }
			// On success: Store auth token, then redirect to dashboard
			// Example: await fetch("/api/auth/register", { method: "POST", body: JSON.stringify({ ... }) })
			alert("Registered! (wire this to your backend)");
		} catch (_err) {
			setErrors({ general: "Registration failed. Please try again." });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
			<section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-8 py-12 md:grid-cols-2 md:py-16">
				<div className="order-2 md:order-1">
					<h1 className="mb-4 text-5xl font-bold text-slate-900 tracking-tight">
						Create your account
					</h1>
					<p className="mb-8 text-lg text-slate-600">
						Join Tripy to plan smarter, track deals, and sync itineraries across
						devices.
					</p>
					<div className="rounded-2xl bg-blue-50 p-6 border border-blue-100">
						<ul className="list-disc space-y-2 pl-6 text-slate-700">
							<li>Save recent searches and fare alerts</li>
							<li>One-click checkout with stored travelers</li>
							<li>Share trips with friends and family</li>
						</ul>
					</div>
				</div>

				<div className="order-1 md:order-2">
					<form
						onSubmit={onSubmit}
						noValidate
						className="rounded-2xl border border-slate-200 p-8 shadow-sm bg-white"
					>
						{errors.general && (
							<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
								{errors.general}
							</div>
						)}

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label
									htmlFor="firstName"
									className="block text-sm font-medium text-slate-700"
								>
									First name
								</label>
								<input
									id="firstName"
									name="firstName"
									autoComplete="given-name"
									value={form.firstName}
									onChange={onChange}
									className={`mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
										errors.firstName ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="John"
								/>
								{errors.firstName && (
									<p className="mt-1 text-xs text-red-600">
										{errors.firstName}
									</p>
								)}
							</div>

							<div>
								<label
									htmlFor="lastName"
									className="block text-sm font-medium text-slate-700"
								>
									Last name
								</label>
								<input
									id="lastName"
									name="lastName"
									autoComplete="family-name"
									value={form.lastName}
									onChange={onChange}
									className={`mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
										errors.lastName ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="Doe"
								/>
								{errors.lastName && (
									<p className="mt-1 text-xs text-red-600">{errors.lastName}</p>
								)}
							</div>
						</div>

						<div className="mt-4">
							<label
								htmlFor="email"
								className="block text-sm font-medium text-slate-700"
							>
								Email
							</label>
							<input
								id="email"
								name="email"
								type="email"
								autoComplete="email"
								value={form.email}
								onChange={onChange}
								className={`mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
									errors.email ? "border-red-500" : "border-slate-200"
								}`}
								placeholder="you@example.com"
							/>
							{errors.email && (
								<p className="mt-1 text-xs text-red-600">{errors.email}</p>
							)}
						</div>

						<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label
									htmlFor="password"
									className="block text-sm font-medium text-slate-700"
								>
									Password
								</label>
								<div className="relative mt-1">
									<input
										id="password"
										name="password"
										type={showPw ? "text" : "password"}
										autoComplete="new-password"
										value={form.password}
										onChange={onChange}
										className={`w-full rounded-xl border px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
											errors.password ? "border-red-500" : "border-slate-200"
										}`}
										placeholder="Enter password"
									/>
									<button
										type="button"
										onClick={() => setShowPw((s) => !s)}
										className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
										aria-label={showPw ? "Hide password" : "Show password"}
									>
										{showPw ? (
											<EyeOff className="h-4 w-4" />
										) : (
											<Eye className="h-4 w-4" />
										)}
									</button>
								</div>
								{errors.password && (
									<p className="mt-1 text-xs text-red-600">{errors.password}</p>
								)}
							</div>

							<div>
								<label
									htmlFor="confirm"
									className="block text-sm font-medium text-slate-700"
								>
									Confirm password
								</label>
								<input
									id="confirm"
									name="confirm"
									type={showPw ? "text" : "password"}
									autoComplete="new-password"
									value={form.confirm}
									onChange={onChange}
									className={`mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
										errors.confirm ? "border-red-500" : "border-slate-200"
									}`}
									placeholder="Re-enter password"
								/>
								{errors.confirm && (
									<p className="mt-1 text-xs text-red-600">{errors.confirm}</p>
								)}
							</div>
						</div>

						<div className="mt-5 flex items-start gap-3">
							<input
								id="agree"
								name="agree"
								type="checkbox"
								checked={form.agree}
								onChange={onChange}
								className={`mt-1 h-4 w-4 rounded border ${
									errors.agree ? "border-red-500" : "border-slate-400"
								} accent-slate-900`}
							/>
							<label htmlFor="agree" className="text-sm text-slate-700">
								I agree to the{" "}
								<Link
									href="/terms"
									className="font-medium text-blue-600 hover:text-blue-700 underline"
								>
									Terms
								</Link>{" "}
								and{" "}
								<Link
									href="/privacy"
									className="font-medium text-blue-600 hover:text-blue-700 underline"
								>
									Privacy Policy
								</Link>
								.
							</label>
						</div>
						{errors.agree && (
							<p className="mt-1 text-xs text-red-600">{errors.agree}</p>
						)}

						<button
							type="submit"
							disabled={submitting}
							className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
						>
							{submitting ? "Creating account..." : "Create account"}
						</button>

						<p className="mt-4 text-center text-sm text-slate-600">
							Already have an account?{" "}
							<Link
								href="/login"
								className="font-medium text-slate-900 underline"
							>
								Log in
							</Link>
						</p>
					</form>
				</div>
			</section>
		</main>
	);
}
