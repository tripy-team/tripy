"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Footer from "@/components/footer";
import { TripyLogo } from "@/components/tripy-logo";

export default function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();

	// Desktop CTAs
	const desktopCreate = (
		<>
			New to Tripy?{" "}
			<Link
				href="/register"
				className="ml-1 font-semibold text-blue-600 hover:text-blue-700 hover:underline"
			>
				Create an account
			</Link>
		</>
	);
	const desktopLogin = (
		<>
			Already have an account?{" "}
			<Link
				href="/login"
				className="ml-1 font-semibold text-blue-600 hover:text-blue-700 hover:underline"
			>
				Log in
			</Link>
		</>
	);
	const desktopTwoLinks = (
		<div className="flex items-center gap-3">
			<Link
				href="/login"
				className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium transition-colors"
			>
				Log in
			</Link>
			<Link
				href="/register"
				className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
			>
				Sign up
			</Link>
		</div>
	);

	// Mobile CTAs
	const mobileTwoLinks = (
		<div className="flex items-center gap-2">
			<Link
				href="/login"
				className="px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 font-medium transition-colors"
			>
				Log in
			</Link>
			<Link
				href="/register"
				className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
			>
				Sign up
			</Link>
		</div>
	);
	const mobileSignUp = (
		<Link
			href="/register"
			className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
		>
			Sign up
		</Link>
	);
	const mobileLogin = (
		<Link
			href="/login"
			className="px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 font-medium transition-colors"
		>
			Log in
		</Link>
	);

	// Choose variants by path
	const isLogin = pathname === "/login";
	const isRegister = pathname === "/register";
	const isForgotOrReset =
		pathname.startsWith("/forgot-password") ||
		pathname.startsWith("/reset-password") ||
		pathname.startsWith("/verify-email");

	const ctaDesktop = isLogin
		? desktopCreate
		: isRegister
			? desktopLogin
			: isForgotOrReset
				? desktopTwoLinks
				: null;
	const ctaMobile = isLogin
		? mobileSignUp
		: isRegister
			? mobileLogin
			: isForgotOrReset
				? mobileTwoLinks
				: null;

	return (
		<>
			<header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
				<div className="flex flex-shrink-0 items-center gap-4">
					<TripyLogo href="/" showText={false} />
				</div>
				{ctaDesktop ? (
					<div className="hidden flex-shrink-0 items-center gap-4 md:flex">
						{ctaDesktop}
					</div>
				) : null}
				{ctaMobile ? (
					<div className="md:hidden">{ctaMobile}</div>
				) : null}
			</header>
			<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
				{children}
			</main>
			<Footer />
		</>
	);
}
