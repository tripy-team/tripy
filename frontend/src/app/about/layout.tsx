"use client";

import { ScrollToTop } from "@/components/scroll-to-top";

export default function AboutLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Navigation is now included in the page component itself
	// Footer can be added if needed
	return (
		<>
			<ScrollToTop />
			{children}
		</>
	);
}
