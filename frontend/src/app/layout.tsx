import "./globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";
import { DevAutoLogin } from "@/components/DevAutoLogin";

const jakarta = Plus_Jakarta_Sans({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700", "800"],
	variable: "--font-jakarta",
	display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	weight: ["500", "600"],
	variable: "--font-jetbrains",
	display: "swap",
});

export const metadata: Metadata = {
	title: "TripsHacker — Loyalty Strategy Copilot for Trip Hackers",
	description:
		"TripsHacker helps trip hackers decide the best way to book with cash, points, or both. Compare redemption paths, optimize every trip, and book with confidence.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
			<body>
				<DevAutoLogin />
				<PageViewTracker />
				{children}
			</body>
		</html>
	);
}
