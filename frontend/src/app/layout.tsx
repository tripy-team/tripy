import "./globals.css";
import type { Metadata } from "next";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";

export const metadata: Metadata = {
	title: "Tripy — Loyalty Optimization for Travel Advisors",
	description:
		"The loyalty optimization workspace for travel advisors. Store client points, generate cash + points strategies, and deliver branded booking guides.",
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
