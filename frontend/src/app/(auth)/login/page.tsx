"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
	const router = useRouter();
	const [form, setForm] = useState({
		email: "",
		password: "",
		remember: true,
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
		try {
			// TODO: Hook into your auth provider / API
			// Example: await signIn("credentials", { redirect: false, email: form.email, password: form.password })
			// On success:
			router.push("/account");
		} catch (err) {
			setErrors({ general: "Invalid email or password." });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<main className="min-h-screen bg-white text-slate-900">
			{/* Content */}
			<section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-12 md:grid-cols-2 md:py-16">
				{/* Left: copy / benefits */}
				<div className="order-2 md:order-1">
					<h1 className="mb-4 text-4xl font-bold text-slate-950">
						Welcome back
					</h1>
					<p className="mb-8 text-slate-600">
						Log in to access your saved searches, fare alerts, and itineraries.
					</p>
					<div className="rounded-xl bg-blue-50 p-6">
						<ul className="list-disc space-y-2 pl-6 text-slate-700">
							<li>Sync trips across devices</li>
							<li>Faster checkout with saved travelers</li>
							<li>Share plans with friends and family</li>
						</ul>
					</div>
				</div>

				{/* Right: form */}
				<div className="order-1 md:order-2">
					<form
						onSubmit={onSubmit}
						noValidate
						className="rounded-xl border border-slate-200 p-6 shadow-sm"
					>
						{errors.general && (
							<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
								{errors.general}
							</div>
						)}

						<div className="mt-0">
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
								className={`mt-1 w-full rounded-md border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900 ${
									errors.email ? "border-red-500" : "border-slate-300"
								}`}
								placeholder="you@example.com"
							/>
							{errors.email && (
								<p className="mt-1 text-xs text-red-600">{errors.email}</p>
							)}
						</div>

						<div className="mt-4">
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
									autoComplete="current-password"
									value={form.password}
									onChange={onChange}
									className={`w-full rounded-md border px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-slate-900 ${
										errors.password ? "border-red-500" : "border-slate-300"
									}`}
									placeholder="Enter your password"
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

						<div className="mt-5 flex items-center justify-between">
							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input
									type="checkbox"
									name="remember"
									checked={form.remember}
									onChange={onChange}
									className="h-4 w-4 rounded border border-slate-400 accent-slate-900"
								/>
								Remember me
							</label>
							<Link
								href="/forgot-password"
								className="text-sm font-medium text-slate-900 underline"
							>
								Forgot password?
							</Link>
						</div>

						<button
							type="submit"
							disabled={submitting}
							className="mt-6 w-full rounded-md bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{submitting ? "Signing in..." : "Log in"}
						</button>

						<p className="mt-4 text-center text-sm text-slate-600">
							New to Tripy?{" "}
							<Link
								href="/register"
								className="font-medium text-slate-900 underline"
							>
								Create an account
							</Link>
						</p>
					</form>
				</div>
			</section>
		</main>
	);
}
