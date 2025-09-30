"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Header from "@/components/header";
import BrandLogo from "@/components/brand-logo";
import Footer from "@/components/footer";

export default function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();

	// Compact two-link (mobile) as pills
	const mobileTwoPills = (
		<div className="flex items-center gap-2">
			<Link
				href="/login"
				className="rounded-full border border-white/40 px-3 py-1 text-xs text-white hover:bg-white/10"
			>
				Log in
			</Link>
			<Link
				href="/register"
				className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-300"
			>
				Create account
			</Link>
		</div>
	);

	// Single pill for pages where only one action makes sense (mobile)
	const mobileSignUp = (
		<Link
			href="/register"
			className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-300"
		>
			Create account
		</Link>
	);
	const mobileLogin = (
		<Link
			href="/login"
			className="rounded-full border border-white/40 px-3 py-1 text-xs text-white hover:bg-white/10"
		>
			Log in
		</Link>
	);

	// Desktop sentence CTAs
	const desktopCreate = (
		<>
			New to Tripy?{" "}
			<Link
				href="/register"
				className="ml-1 font-semibold text-yellow-400 hover:underline"
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
				className="ml-1 font-semibold text-yellow-400 hover:underline"
			>
				Log in
			</Link>
		</>
	);
	const desktopTwoLinks = (
		<div className="flex items-center gap-4">
			<Link href="/login" className="hover:underline">
				Log in
			</Link>
			<div className="h-5 w-px bg-white opacity-30" aria-hidden />
			<Link href="/register" className="hover:underline">
				Register
			</Link>
		</div>
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
				? mobileTwoPills
				: null;

	return (
		<>
			<Header left={<BrandLogo />} right={ctaDesktop} rightMobile={ctaMobile} />
			<main className="min-h-screen bg-white text-slate-900">{children}</main>
			<Footer />
		</>
	);
}
