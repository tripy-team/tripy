// components/brand-logo.tsx
import Link from "next/link";

type BrandLogoProps = {
	href?: string;
	imgSrc?: string;
	alt?: string;
	/** Show the square mark to the left of the logo */
	showMark?: boolean;
	/** Tailwind classes for the square mark */
	markClassName?: string;
	/** Tailwind classes for the <img> */
	imgClassName?: string;
	/** Wrapper classes (outer div) */
	className?: string;
};

export default function BrandLogo({
	href = "/",
	imgSrc = "/logo.png",
	alt = "Tripy",
	showMark = true,
	markClassName = "h-8 w-8 rounded-sm bg-gray-500/50",
	imgClassName = "h-[15px] w-auto object-contain md:h-[25px]",
	className = "",
}: BrandLogoProps) {
	return (
		<div className={`flex items-center gap-3 ${className}`}>
			{showMark && <div className={markClassName} />}
			<Link
				href={href}
				className="logo-group pointer-events-auto z-10"
				aria-label={`${alt} home`}
			>
				<img src={imgSrc} alt={alt} className={imgClassName} />
			</Link>
		</div>
	);
}
