"use client";

import { useState } from "react";

export default function LocationSwapBox({
	height = "h-full",
	variant = "default",
}: {
	height?: string;
	variant?: "default" | "small";
}) {
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");

	const handleSwap = () => {
		setFrom((prevFrom) => {
			setTo(prevFrom);
			return to;
		});
	};

	const isSmall = variant === "small";
	const inputClass = isSmall ? "text-lg font-semibold" : "text-3xl font-bold";
	const labelClass = isSmall ? "text-xs mt-0.5" : "text-sm mt-1";
	const boxClass = isSmall ? "px- py-2" : "h-full px-4 py-4";
	const cutoutSize = isSmall ? "h-6 w-6" : "h-10 w-10";
	const swapIconSize = isSmall ? "h-4 w-4" : "h-5 w-5";

	return (
		<div className="flex items-center justify-center">
			<div className={`relative flex gap-2.5 ${height} w-full`}>
				{/* FROM Box */}
				<div
					className={`flex h-full w-1/2 flex-col items-center justify-center rounded-md border border-gray-400 bg-white`}
				>
					<input
						type="text"
						placeholder="From"
						value={from}
						onChange={(e) => setFrom(e.target.value)}
						className={`w-full text-center text-slate-950 placeholder:text-gray-400 focus:outline-none ${inputClass}`}
					/>
					<p className={`text-gray-400 ${labelClass}`}>Origin</p>
				</div>

				{/* TO Box */}
				<div
					className={`flex h-full w-1/2 flex-col items-center justify-center rounded-md border border-gray-400 bg-white`}
				>
					<input
						type="text"
						placeholder="To"
						value={to}
						onChange={(e) => setTo(e.target.value)}
						className={`w-full text-center text-slate-950 placeholder:text-gray-400 focus:outline-none ${inputClass}`}
					/>
					<p className={`text-gray-400 ${labelClass}`}>Destination</p>
				</div>

				{/* Center Cutout */}
				<div
					className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-400 bg-white ${cutoutSize}`}
				/>
				<div className="absolute top-1/2 left-1/2 h-full w-2.5 -translate-x-1/2 -translate-y-1/2 bg-white" />

				{/* Swap Button */}
				<button
					onClick={handleSwap}
					className={`absolute top-1/2 left-1/2 flex ${cutoutSize} -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-transparent transition hover:scale-110`}
					aria-label="Swap locations"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className={`${swapIconSize} text-blue-900`}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M7 8l-4 4m0 0l4 4m-4-4h18m-4-4l4 4m0 0l-4 4"
						/>
					</svg>
				</button>
			</div>
		</div>
	);
}
