"use client";

import Link from "next/link";
import { Plane } from "lucide-react";
import Footer from "@/components/footer";
import { ScrollToTop } from "@/components/scroll-to-top";

export default function LegalLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<ScrollToTop />
			<header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
				<div className="flex flex-shrink-0 items-center gap-4">
					<Link href="/" className="flex items-center gap-3">
						<div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 flex-shrink-0">
							<Plane className="w-5 h-5 text-white" />
						</div>
					</Link>
				</div>
			</header>
			<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
				{children}
			</main>
			<Footer />
		</>
	);
}
