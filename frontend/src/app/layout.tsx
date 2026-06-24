import "./globals.css";
import type { Metadata } from "next";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";

export const metadata: Metadata = {
	title: "TripsHacker — Loyalty Strategy Copilot for Travel Advisors",
	description:
		"TripsHacker helps advisors decide the best way to book with cash, points, or both. Compare redemption paths, optimize every trip, and deliver client-ready guidance.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>
				<PageViewTracker />
				{children}
			</body>
		</html>
	);
}
