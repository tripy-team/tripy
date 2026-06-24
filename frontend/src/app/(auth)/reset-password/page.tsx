"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	Plane,
	Lock,
	ArrowRight,
	Eye,
	EyeOff,
	CheckCircle,
} from "lucide-react";
import { auth } from "@/lib/api";

function ResetPasswordForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const email = searchParams.get("email") || "";
	const code = searchParams.get("code") || "";

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [success, setSuccess] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);

	if (!email || !code) {
		return (
			<div className="w-full max-w-sm mx-auto">
				<div className="flex items-center gap-2 mb-10">
					<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
						<Plane className="w-5 h-5 text-white" />
					</div>
					<span className="text-xl font-bold text-slate-900">TripsHacker</span>
				</div>
				<div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
					<p className="font-medium mb-1">Invalid reset link</p>
					<p>
						This link is missing or malformed.{" "}
						<Link
							href="/forgot-password"
							className="underline font-medium"
						>
							Request a new one
						</Link>
						.
					</p>
				</div>
			</div>
		);
	}

	const validate = () => {
		const next: Record<string, string> = {};
		if (!password) next.password = "Password is required";
		else if (password.length < 8)
			next.password = "Use at least 8 characters";
		if (!confirmPassword)
			next.confirmPassword = "Please confirm your password";
		else if (password !== confirmPassword)
			next.confirmPassword = "Passwords do not match";
		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;
		setSubmitting(true);
		setErrors({});
		try {
			await auth.resetPassword({ email, code, new_password: password });
			setSuccess(true);
			setTimeout(() => router.push("/login"), 3000);
		} catch (err) {
			let errorMessage = "Something went wrong. Please try again.";
			if (err instanceof Error) {
				errorMessage = err.message;
			}
			setErrors({ general: errorMessage });
		} finally {
			setSubmitting(false);
		}
	};

	if (success) {
		return (
			<div className="w-full max-w-sm mx-auto">
				<div className="flex items-center gap-2 mb-10">
					<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
						<Plane className="w-5 h-5 text-white" />
					</div>
					<span className="text-xl font-bold text-slate-900">TripsHacker</span>
				</div>
				<div className="rounded-md bg-green-50 border border-green-200 p-6 text-center">
					<CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-3" />
					<h2 className="text-lg font-semibold text-slate-900 mb-1">
						Password reset!
					</h2>
					<p className="text-sm text-slate-600 mb-4">
						Your password has been updated. Redirecting you to
						login&hellip;
					</p>
					<Link
						href="/login"
						className="text-sm font-medium text-blue-600 hover:text-blue-700"
					>
						Go to login now
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="w-full max-w-sm mx-auto">
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">TripsHacker</span>
			</div>

			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">
					Set a new password
				</h1>
				<p className="text-slate-600">
					Choose a strong password for your account.
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
						New Password
					</label>
					<div className="relative">
						<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<Lock className="h-5 w-5 text-slate-400" />
						</div>
						<input
							type={showPassword ? "text" : "password"}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
								errors.password
									? "border-red-500"
									: "border-slate-200"
							}`}
							placeholder="••••••••"
						/>
						<button
							type="button"
							onClick={() => setShowPassword(!showPassword)}
							className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
						>
							{showPassword ? (
								<EyeOff className="h-5 w-5" />
							) : (
								<Eye className="h-5 w-5" />
							)}
						</button>
					</div>
					{errors.password && (
						<p className="mt-1 text-xs text-red-600">
							{errors.password}
						</p>
					)}
				</div>

				<div>
					<label className="block text-sm font-medium text-slate-700 mb-1.5">
						Confirm Password
					</label>
					<div className="relative">
						<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<Lock className="h-5 w-5 text-slate-400" />
						</div>
						<input
							type={showConfirm ? "text" : "password"}
							value={confirmPassword}
							onChange={(e) =>
								setConfirmPassword(e.target.value)
							}
							className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
								errors.confirmPassword
									? "border-red-500"
									: "border-slate-200"
							}`}
							placeholder="••••••••"
						/>
						<button
							type="button"
							onClick={() => setShowConfirm(!showConfirm)}
							className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
						>
							{showConfirm ? (
								<EyeOff className="h-5 w-5" />
							) : (
								<Eye className="h-5 w-5" />
							)}
						</button>
					</div>
					{errors.confirmPassword && (
						<p className="mt-1 text-xs text-red-600">
							{errors.confirmPassword}
						</p>
					)}
				</div>

				<button
					type="submit"
					disabled={submitting}
					className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed font-medium"
				>
					{submitting ? (
						"Resetting..."
					) : (
						<>
							Reset password <ArrowRight className="w-4 h-4" />
						</>
					)}
				</button>
			</form>

			<div className="mt-8 pt-8 border-t border-slate-100 text-center">
				<p className="text-sm text-slate-600">
					Remember your password?{" "}
					<Link
						href="/login"
						className="text-blue-600 font-medium hover:text-blue-700"
					>
						Log in
					</Link>
				</p>
			</div>
		</div>
	);
}

function ResetPasswordFallback() {
	return (
		<div className="w-full max-w-sm mx-auto">
			<div className="flex items-center gap-2 mb-10">
				<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
					<Plane className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold text-slate-900">TripsHacker</span>
			</div>
			<div className="mb-8">
				<h1 className="text-3xl font-bold text-slate-900 mb-3">
					Set a new password
				</h1>
				<p className="text-slate-600">
					Choose a strong password for your account.
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

export default function ResetPasswordPage() {
	return (
		<div className="min-h-full bg-white flex">
			<div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 xl:px-24 py-12 bg-white">
				<Suspense fallback={<ResetPasswordFallback />}>
					<ResetPasswordForm />
				</Suspense>
			</div>

			<div className="hidden lg:block flex-1 bg-slate-50 relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-600/90 to-blue-800/90 mix-blend-multiply z-10"></div>
				<div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center"></div>
				<div className="relative z-20 flex items-center justify-center h-full text-white text-center px-12">
					<div>
						<h2 className="text-4xl font-bold mb-4">
							Almost there
						</h2>
						<p className="text-xl text-blue-100">
							Set your new password and get back to planning.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
