import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Tripy",
	description: "Plan and maximize your vacation",
	icons: {
		icon: "/icon.svg",
		apple: "/icon.svg",
		shortcut: "/favicon.ico",
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
