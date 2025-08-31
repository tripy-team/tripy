import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import BackgroundVideo from "@/components/BackgroundVideo";
import { Inter } from "next/font/google";

const inter = Inter({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-inter",
});

export const metadata: Metadata = {
	title: "Tripy",
	description: "Your AI Travel Companion",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={inter.variable}>
			{/* Using inter.className ensures the font applies even without Tailwind config */}
			<body className={`${inter.className} relative min-h-dvh`}>
				{/* Background on every page */}
				<BackgroundVideo
					desktopSrc="/lp-video-airplane.mp4"
					mobileSrc="/lp-video-airplane-mobile.mp4"
					overlayClassName="bg-black/40"
				/>

				{/* Global Nav */}
				<NavBar />

				{/* Content */}
				<div className="relative z-10 flex min-h-dvh flex-col">
					<main className="flex-1">{children}</main>

					<footer className="w-full py-2 text-center text-white/60 md:py-4">
						<p className="px-4 text-[12px] md:text-[13px]">
							Copyright © 2025 Soar Intelligence. All rights reserved.{" "}
							<a href="/privacy" className="hover:underline">
								Privacy Policy
							</a>{" "}
							•{" "}
							<a href="/terms" className="hover:underline">
								Terms
							</a>
							.
						</p>
					</footer>
				</div>

				<div id="modal-root" />
			</body>
		</html>
	);
}
