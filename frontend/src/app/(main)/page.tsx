"use client";

import { useState } from "react";

import LocationSwapBox from "@/components/location-swap-box";
import DateRangePickerCustom from "@/components/date-range-picker";
import DatePickerCustom from "@/components/date-picker";
import PassengerPicker from "@/components/passenger-picker";
import SearchableSelect from "@/components/searchable-select";

import { PlusIcon } from "lucide-react";

const classOptions = [
	{ id: "economy", name: "Economy" },
	{ id: "premium", name: "Premium Economy" },
	{ id: "business", name: "Business" },
	{ id: "first", name: "First Class" },
];

export default function Home() {
	const [tab, setTab] = useState<"round" | "oneway" | "multi">("round");
	const [multiLocations, setMultiLocations] = useState<number[]>([0, 1]);
	const [recentSearches, setRecentSearches] = useState<
		{ route: string; date: string }[]
	>([]);

	const renderTabButton = (key: string) => (
		<button
			key={key}
			onClick={() => setTab(key as any)}
			className={`flex-1 py-3 font-semibold transition-all ${
				tab === key
					? "border-x-2 border-b-2 border-gray-300 bg-white text-slate-950"
					: "bg-transparent text-white"
			}`}
		>
			{key === "round" && "Round Trip"}
			{key === "oneway" && "One Way"}
			{key === "multi" && "Multi City"}
		</button>
	);

	const addLocationBox = () => {
		setMultiLocations((prev) => [...prev, prev.length + 1]);
	};

	const addRecentSearch = (route: string, date: string) => {
		setRecentSearches((prev) => {
			const updated = [{ route, date }, ...prev];
			return updated.slice(0, 4);
		});
	};

	const removeRecentSearch = (index: number) => {
		setRecentSearches((prev) => prev.filter((_, i) => i !== index));
	};

	const renderGenericTabOptions = () => (
		<div>
			<div className="grid grid-cols-2 gap-6 pt-6">
				<SearchableSelect
					label="Travel Class"
					placeholder="What travel class are you looking for?"
					options={classOptions}
				/>
				<button
					onClick={() => addRecentSearch("MCO - SEA", "July 16, 2025")}
					className="rounded-md bg-slate-950 p-3 font-semibold text-white"
				>
					Search
				</button>
			</div>

			<div className="mt-6 flex flex-wrap items-center gap-6">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						className="h-5 w-5 rounded border border-slate-500 accent-slate-900"
					/>
					<span className="font-semibold text-slate-900">Shop with Miles</span>
				</label>

				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						className="h-5 w-5 rounded border border-slate-500 accent-slate-900"
					/>
					<span className="font-semibold text-slate-900">Refundable Fares</span>
				</label>

				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						className="h-5 w-5 rounded border border-slate-500 accent-slate-900"
					/>
					<span className="font-semibold text-slate-900">Flexible Dates</span>
				</label>

				<input
					type="text"
					placeholder="Promo Code"
					className="ml-auto border-0 border-b-2 border-slate-400 bg-transparent px-2 py-1 text-slate-600 placeholder-slate-400 focus:ring-0 focus:outline-none"
				/>
			</div>
		</div>
	);

	const renderRecentSearches = () => {
		if (recentSearches.length === 0) return null;

		return (
			<div className="mt-8">
				<div className="mb-4 flex items-center gap-2">
					<div className="h-5 w-1.5 rounded-sm bg-yellow-400" />
					<h2 className="text-lg font-semibold text-slate-900">
						Recent Searches
					</h2>
				</div>

				<div className="flex flex-wrap gap-5">
					{recentSearches.map(({ route, date }, index) => (
						<div
							key={index}
							className="flex w-[310px] items-center justify-between rounded-md border border-slate-500 bg-slate-50 px-4 py-2 text-sm text-slate-800"
						>
							<div className="flex flex-col">
								<span className="font-medium">{route}</span>
								<span className="text-slate-500">{date}</span>
							</div>
							<button
								onClick={() => removeRecentSearch(index)}
								className="ml-2 h-5 w-5 shrink-0 rounded-full bg-slate-900 text-white hover:bg-slate-700"
							>
								×
							</button>
						</div>
					))}
				</div>
			</div>
		);
	};

	return (
		<main className="min-h-screen bg-white text-gray-900">
			{/* Hero Section */}
			<section className="relative overflow-hidden bg-blue-950 px-6 py-16 text-white">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-12 md:flex-row">
					<div className="text-center md:text-left">
						<h1 className="mb-6 text-4xl leading-tight font-bold md:text-5xl">
							Maximize
							<br />
							Your Vacation
						</h1>
						<button className="rounded bg-yellow-400 px-24 py-3 text-lg font-semibold text-black transition hover:bg-yellow-300">
							Get Started
						</button>
					</div>
					<div className="hidden w-full max-w-[700px] md:block">
						<img
							src="/trip.svg"
							alt="Trip illustration"
							className="h-auto w-full"
						/>
					</div>
				</div>
			</section>

			{/* Tab Layout */}
			<div className="relative mx-auto mt-[-4rem] max-w-[1400px] rounded-md bg-white shadow-md">
				<div className="flex overflow-hidden bg-slate-950">
					{["round", "oneway", "multi"].map(renderTabButton)}
				</div>

				<div className="border border-gray-300 p-12">
					{/* Round Trip */}
					{tab === "round" && (
						<>
							<div className="grid grid-cols-2 gap-6">
								<div className="flex justify-center">
									<LocationSwapBox />
								</div>
								<div className="flex flex-col justify-center gap-6">
									<DateRangePickerCustom />
									<PassengerPicker />
								</div>
							</div>

							{renderGenericTabOptions()}
							{renderRecentSearches()}
						</>
					)}

					{/* One Way */}
					{tab === "oneway" && (
						<>
							<div className="grid grid-cols-2 gap-6">
								<div className="flex justify-center">
									<LocationSwapBox />
								</div>
								<div className="flex flex-col justify-center gap-6">
									<DatePickerCustom label="Departure Date" />
									<PassengerPicker />
								</div>
							</div>
							{renderGenericTabOptions()}
							{renderRecentSearches()}
						</>
					)}

					{/* Multi City */}
					{tab === "multi" && (
						<>
							<div className="grid grid-cols-2 items-stretch gap-6">
								{/* Left: Scrollable box with fixed height */}
								<div className="flex h-[150px] flex-col overflow-hidden">
									{/* Scrollable content area */}
									<div className="flex-1 overflow-y-auto pr-1">
										<div className="flex flex-col gap-3">
											{multiLocations.map((id) => (
												<LocationSwapBox key={id} variant="small" />
											))}
										</div>
									</div>

									{/* Add Flight Button pinned to bottom */}
									<div className="shrink-0 pt-2">
										<div className="flex items-center justify-center">
											<hr className="flex-1 border-gray-300" />
											<button
												onClick={addLocationBox}
												className="mx-4 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
											>
												<div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
													<PlusIcon className="h-4 w-4" />
												</div>
												Add Flight
											</button>
											<hr className="flex-1 border-gray-300" />
										</div>
									</div>
								</div>

								{/* Right: Match height */}
								<div className="flex flex-col justify-center gap-6">
									<DatePickerCustom label="Departure Date" />
									<PassengerPicker />
								</div>
							</div>
							{renderGenericTabOptions()}
							{renderRecentSearches()}
						</>
					)}
				</div>
			</div>
		</main>
	);
}
