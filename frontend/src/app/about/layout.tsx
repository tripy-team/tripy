"use client";

export default function AboutLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Navigation is now included in the page component itself
	// Footer can be added if needed
	return <>{children}</>;
}
