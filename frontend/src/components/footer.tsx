"use client";

import Link from "next/link";

export default function Footer() {
	return (
		<footer data-testid="footer" data-slot="Footer" className="mt-12 border-t border-slate-200 bg-white">
			<div className="mx-auto max-w-6xl px-6 py-8">
				<div className="flex flex-col items-center justify-between gap-6 md:flex-row">
					{/* Left: Brand / © */}
					<p className="text-center text-sm text-slate-600 md:text-left">
						© {new Date().getFullYear()} Tripy. All rights reserved.
					</p>

					{/* Right: Links */}
					<div className="flex items-center gap-6 flex-wrap justify-center text-sm text-slate-600">
						<Link href="/pricing" className="transition hover:text-slate-900 hover:underline">
							Pricing
						</Link>
						<Link href="/faq" className="transition hover:text-slate-900 hover:underline">
							FAQ
						</Link>
						<Link href="/contact" className="transition hover:text-slate-900 hover:underline">
							Contact
						</Link>
						<Link href="/terms" className="transition hover:text-slate-900 hover:underline">
							Terms
						</Link>
						<Link href="/privacy" className="transition hover:text-slate-900 hover:underline">
							Privacy
						</Link>
					</div>
				</div>
			</div>
		</footer>
	);
}
