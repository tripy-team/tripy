// app/(main)/layout.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import Footer from "@/components/footer";
import Header from "@/components/header";
import BrandLogo from "@/components/brand-logo";

export default function MainLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [loggedIn] = useState(false); // wire to your auth state/session

	const center = (
		<>
			<a href="#">Plan</a>
			<a href="#">Explore</a>
			<a href="#">Trips</a>
			<a href="#">Dashboard</a>
			<a href="#">Invite</a>
		</>
	);

	const right = loggedIn ? (
		<>
			<div className="h-[45px] w-[45px] rounded-full bg-zinc-300" />
			<Link href="/account">Account</Link>
		</>
	) : (
		<>
			<Link href="/login" className="hover:underline">
				Log in
			</Link>
			<div className="h-5 w-px bg-white opacity-30" />
			<Link href="/register" className="hover:underline">
				Register
			</Link>
		</>
	);

	const rightMobile = (
		<button
			className="md:hidden"
			onClick={() => setIsOpen(!isOpen)}
			aria-label="Toggle menu"
		>
			<div className="flex w-6 flex-col space-y-1">
				<div className="h-0.5 w-full bg-white" />
				<div className="h-0.5 w-full bg-white" />
				<div className="h-0.5 w-full bg-white" />
			</div>
		</button>
	);

	return (
		<>
			<div className="relative">
				<Header
					left={<BrandLogo />}
					center={center}
					right={right}
					rightMobile={rightMobile}
				/>

				{/* Mobile dropdown */}
				{isOpen && (
					<div className="absolute top-full left-0 z-50 flex w-full flex-col gap-4 bg-blue-950 p-4 text-center text-zinc-300 md:hidden">
						<a href="#">Plan</a>
						<a href="#">Explore</a>
						<a href="#">Trips</a>
						<a href="#">Dashboard</a>
						<a href="#">Invite</a>
						<div className="flex flex-col gap-2 border-t border-white/20 pt-4 text-white">
							{loggedIn ? (
								<Link href="/account">Account</Link>
							) : (
								<>
									<Link href="/login" className="hover:underline">
										Log in
									</Link>
									<Link href="/register" className="hover:underline">
										Register
									</Link>
								</>
							)}
						</div>
					</div>
				)}
			</div>

			<main className="min-h-screen bg-white text-slate-900">{children}</main>
			<Footer />
		</>
	);
}
