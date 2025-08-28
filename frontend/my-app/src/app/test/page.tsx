"use client";
import { useState } from "react";

export default function Page() {
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [locations, setLocations] = useState("");
	const [cards, setCards] = useState([{ name: "", points: "" }]);
	const [json, setJson] = useState("{}");

	const handleCardChange = (
		index: number,
		field: "name" | "points",
		value: string,
	) => {
		const updated = [...cards];
		updated[index][field] = value;
		setCards(updated);
	};

	const addCard = () => {
		setCards([...cards, { name: "", points: "" }]);
	};

	const removeCard = (index: number) => {
		setCards(cards.filter((_, i) => i !== index));
	};

	const generateJSON = () => {
		const payload = {
			startDate,
			endDate,
			locations: locations
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
			points: cards.reduce(
				(acc, c) => {
					if (c.name.trim()) {
						acc[c.name.trim()] = parseInt(c.points || "0", 10);
					}
					return acc;
				},
				{} as Record<string, number>,
			),
		};
		setJson(JSON.stringify(payload, null, 2));
	};

	return (
		<main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
			<h1>Test Page</h1>

			<div style={{ marginBottom: "1rem" }}>
				<label>
					Start Date:
					<input
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
					/>
				</label>
			</div>

			<div style={{ marginBottom: "1rem" }}>
				<label>
					End Date:
					<input
						type="date"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
					/>
				</label>
			</div>

			<div style={{ marginBottom: "1rem" }}>
				<label>
					Desired Locations (one per line):
					<br />
					<textarea
						rows={4}
						cols={40}
						value={locations}
						onChange={(e) => setLocations(e.target.value)}
					/>
				</label>
			</div>

			<div>
				<h2>Card Points</h2>
				{cards.map((card, index) => (
					<div
						key={index}
						style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}
					>
						<input
							type="text"
							placeholder="Program (e.g., Amex)"
							value={card.name}
							onChange={(e) => handleCardChange(index, "name", e.target.value)}
						/>
						<input
							type="number"
							placeholder="Points"
							value={card.points}
							onChange={(e) =>
								handleCardChange(index, "points", e.target.value)
							}
						/>
						<button type="button" onClick={() => removeCard(index)}>
							Remove
						</button>
					</div>
				))}
				<button type="button" onClick={addCard}>
					+ Add Card
				</button>
			</div>

			<div style={{ marginTop: "1rem" }}>
				<button type="button" onClick={generateJSON}>
					Generate JSON
				</button>
			</div>

			<h2>Output</h2>
			<pre style={{ background: "#111", color: "#0f0", padding: "1rem" }}>
				{json}
			</pre>
		</main>
	);
}
