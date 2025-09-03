"use client";

import { useState } from "react";

export default function Header() {
	const [isOpen, setIsOpen] = useState(false);
	const [loggedIn] = useState(true);

	return (
		<header className="relative flex items-center justify-between bg-slate-950 px-6 py-6 text-white">
			{/* Left: Logo */}
			<div className="flex flex-shrink-0 items-center gap-4">
				<div className="h-8 w-8 rounded-sm bg-gray-500/50" />
				<span className="text-2xl font-medium">Tripy</span>
			</div>

			{/* Center: Nav (desktop only) */}
			<nav className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 gap-8 text-lg text-zinc-300 md:flex">
				<a href="#">Plan</a>
				<a href="#">Explore</a>
				<a href="#">Trips</a>
				<a href="#">Dashboard</a>
				<a href="#">Invite</a>
			</nav>

			{/* Right: Auth OR Account */}
			{loggedIn ? (
				<div className="hidden flex-shrink-0 items-center gap-4 text-lg md:flex">
					<div className="h-[45px] w-[45px] rounded-full bg-zinc-300" />
					<span>Account</span>
				</div>
			) : (
				<div className="hidden flex-shrink-0 items-center gap-4 text-lg md:flex">
					<span>Log in</span>
					<div className="h-5 w-px bg-white opacity-30" />
					<span>Register</span>
				</div>
			)}

			{/* Mobile: Hamburger */}
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

			{/* Mobile dropdown (unchanged) */}
			{isOpen && (
				<div className="absolute top-full left-0 z-50 flex w-full flex-col gap-4 bg-blue-950 p-4 text-center text-zinc-300 md:hidden">
					<a href="#">Plan</a>
					<a href="#">Explore</a>
					<a href="#">Trips</a>
					<a href="#">Dashboard</a>
					<a href="#">Invite</a>
					<div className="flex flex-col gap-2 border-t border-white/20 pt-4 text-white">
						{loggedIn ? (
							<>
								<span>Account</span>
							</>
						) : (
							<>
								<span>Log in</span>
								<span>Register</span>
							</>
						)}
					</div>
				</div>
			)}
		</header>
	);
}
