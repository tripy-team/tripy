"use client";

import { useEffect, useState } from "react";

type Props = {
	desktopSrc: string;
	mobileSrc: string;
	breakpoint?: number; // default 768
	overlayClassName?: string; // e.g. "bg-black/40"
};

export default function BackgroundVideo({
	desktopSrc,
	mobileSrc,
	breakpoint = 768,
	overlayClassName = "bg-black/40",
}: Props) {
	const [src, setSrc] = useState(desktopSrc);

	useEffect(() => {
		const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
		const pick = () => setSrc(mq.matches ? mobileSrc : desktopSrc);
		pick();
		mq.addEventListener?.("change", pick);
		return () => mq.removeEventListener?.("change", pick);
	}, [desktopSrc, mobileSrc, breakpoint]);

	return (
		<div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
			<video
				key={src}
				className="absolute inset-0 h-full w-full object-cover"
				autoPlay
				loop
				muted
				playsInline
				preload="auto"
			>
				<source src={src} type="video/mp4" />
			</video>
			<div className={`absolute inset-0 ${overlayClassName}`} />
		</div>
	);
}
