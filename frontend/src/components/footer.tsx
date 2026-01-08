"use client";

import Link from "next/link";

export default function Footer() {
	return (
		<footer className="mt-12 border-t border-slate-200 bg-white">
			<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-600 md:flex-row">
				{/* Left: Brand / © */}
				<p className="text-center md:text-left">
					© {new Date().getFullYear()} Tripy. All rights reserved.
				</p>

			{/* Right: Links */}
			<div className="flex items-center gap-6 flex-wrap justify-center">
				<Link
					href="/about"
					className="transition hover:text-slate-900 hover:underline"
				>
					About
				</Link>
				<Link
					href="/contact"
					className="transition hover:text-slate-900 hover:underline"
				>
					Contact
				</Link>
				<Link
					href="/terms"
					className="transition hover:text-slate-900 hover:underline"
				>
					Terms
				</Link>
				<Link
					href="/privacy"
					className="transition hover:text-slate-900 hover:underline"
				>
					Privacy Policy
				</Link>
			</div>
			</div>
		</footer>
	);
}
