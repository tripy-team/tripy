"use client";

import Link from "next/link";
import { Plane } from "lucide-react";

export default function Footer() {
	return (
		<footer
			data-testid="footer"
			data-slot="Footer"
			className="border-t border-slate-200 bg-slate-900 text-white"
		>
			<div className="mx-auto max-w-7xl px-6 py-12">
				{/* Top section: columns */}
				<div className="grid grid-cols-2 gap-8 md:grid-cols-4">
					{/* Brand */}
					<div>
						<div className="mb-4 flex items-center gap-3">
							<div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/20">
								<Plane className="h-5 w-5 text-white" />
							</div>
							<span className="text-xl font-bold">Tripy</span>
						</div>
					<p className="text-sm leading-relaxed text-slate-400">
						The loyalty optimization workspace for travel advisors.
					</p>
					</div>

					{/* Contact Us */}
					<div>
						<h4 className="mb-4 font-semibold">Contact Us</h4>
						<ul className="space-y-2 text-sm text-slate-400">
							<li>
								<Link href="/contact" className="transition hover:text-white">
									Get in Touch
								</Link>
							</li>
							<li>
								<a
									href="mailto:tripy@traveltripy.com"
									className="transition hover:text-white"
								>
									tripy@traveltripy.com
								</a>
							</li>
						</ul>
					</div>

					{/* Resources */}
					<div>
						<h4 className="mb-4 font-semibold">Resources</h4>
						<ul className="space-y-2 text-sm text-slate-400">
							<li>
								<Link href="/faq" className="transition hover:text-white">
									Frequently Asked Questions
								</Link>
							</li>
							<li>
								<Link href="/pricing" className="transition hover:text-white">
									Pricing
								</Link>
							</li>
							<li>
								<Link href="/about" className="transition hover:text-white">
									About Tripy
								</Link>
							</li>
							<li>
								<Link
									href="/learn/point-transfers"
									className="transition hover:text-white"
								>
									Why Transfer Points?
								</Link>
							</li>
						</ul>
					</div>

					{/* Legal */}
					<div>
						<h4 className="mb-4 font-semibold">Legal</h4>
						<ul className="space-y-2 text-sm text-slate-400">
							<li>
								<Link href="/terms" className="transition hover:text-white">
									Terms of Service
								</Link>
							</li>
							<li>
								<Link href="/privacy" className="transition hover:text-white">
									Privacy Policy
								</Link>
							</li>
						</ul>
					</div>
				</div>

				{/* Bottom bar */}
				<div className="mt-10 border-t border-slate-800 pt-8 text-center text-sm text-slate-400">
					<p>&copy; {new Date().getFullYear()} Tripy. All rights reserved.</p>
				</div>
			</div>
		</footer>
	);
}
