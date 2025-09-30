"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [sent, setSent] = useState(false);

	const validate = () => {
		const next: Record<string, string> = {};
		if (!email.trim()) next.email = "Email is required";
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
			next.email = "Enter a valid email";
		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		try {
			// TODO: Call your password reset endpoint here, e.g.
			// await fetch("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) })
			//   .then(r => r.json());
			setSent(true);
		} catch (err) {
			setErrors({ general: "Something went wrong. Please try again." });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<main className="min-h-screen bg-white text-slate-900">
			{/* The (auth)/layout renders TopBar + Footer; this page only renders content */}
			<section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-12 md:grid-cols-2 md:py-16">
				{/* Left: copy */}
				<div className="order-2 md:order-1">
					<h1 className="mb-4 text-4xl font-bold text-slate-950">
						Forgot your password?
					</h1>
					<p className="mb-8 text-slate-600">
						Enter the email associated with your account. If it exists, we’ll
						send a link to reset your password.
					</p>
					<div className="rounded-xl bg-blue-50 p-6">
						<ul className="list-disc space-y-2 pl-6 text-slate-700">
							<li>
								No account?{" "}
								<Link
									href="/register"
									className="font-medium text-slate-900 underline"
								>
									Create one
								</Link>
							</li>
							<li>
								Remembered it?{" "}
								<Link
									href="/login"
									className="font-medium text-slate-900 underline"
								>
									Log in
								</Link>
							</li>
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

						{sent ? (
							<div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
								If an account exists for{" "}
								<span className="font-medium">{email}</span>, a password reset
								link has been sent.
								<div className="mt-2">
									Didn’t get it? Check spam or{" "}
									<button
										type="button"
										onClick={() => setSent(false)}
										className="underline"
									>
										try again
									</button>
									.
								</div>
							</div>
						) : (
							<>
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
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className={`mt-1 w-full rounded-md border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900 ${
										errors.email ? "border-red-500" : "border-slate-300"
									}`}
									placeholder="you@example.com"
								/>
								{errors.email && (
									<p className="mt-1 text-xs text-red-600">{errors.email}</p>
								)}

								<button
									type="submit"
									disabled={submitting}
									className="mt-6 w-full rounded-md bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{submitting ? "Sending link..." : "Send reset link"}
								</button>

								<p className="mt-4 text-center text-sm text-slate-600">
									Remember your password?{" "}
									<Link
										href="/login"
										className="font-medium text-slate-900 underline"
									>
										Log in
									</Link>
								</p>
							</>
						)}
					</form>
				</div>
			</section>
		</main>
	);
}
