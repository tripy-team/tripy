import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Tripy",
	description: "Plan and maximize your vacation",
	icons: {
		icon: [
			{ url: "/icon.svg", type: "image/svg+xml" },
			{ url: "/favicon.ico", sizes: "any" },
		],
		apple: [
			{ url: "/icon.svg", type: "image/svg+xml" },
		],
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
