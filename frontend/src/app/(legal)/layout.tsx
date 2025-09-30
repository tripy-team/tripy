// app/(legal)/layout.tsx

import BrandLogo from "@/components/brand-logo";
import Footer from "@/components/footer";
import Header from "@/components/header";

export default function MainLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<Header left={<BrandLogo />} />
			{children}
			<Footer />
		</>
	);
}
