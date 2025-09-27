// components/header.tsx
"use client";

import { ReactNode } from "react";

type HeaderProps = {
	left?: ReactNode;
	center?: ReactNode;
	right?: ReactNode;
	rightMobile?: ReactNode;
	className?: string;
};

export default function Header({
	left,
	center,
	right,
	rightMobile,
	className,
}: HeaderProps) {
	return (
		<header
			className={`relative flex items-center justify-between bg-slate-950 px-6 py-6 text-white ${className ?? ""}`}
		>
			<div className="flex flex-shrink-0 items-center gap-4">{left}</div>

			{center ? (
				<nav className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 gap-8 text-lg text-zinc-300 md:flex">
					{center}
				</nav>
			) : null}

			{right ? (
				<div className="hidden flex-shrink-0 items-center gap-4 md:flex">
					{right}
				</div>
			) : null}

			{rightMobile ? <div className="md:hidden">{rightMobile}</div> : null}
		</header>
	);
}
