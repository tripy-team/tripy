"use client";
import { useState } from "react";

export default function Page() {
	const [start, setStart] = useState("");
	const [end, setEnd] = useState("");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [datesDeparting, setDatesDeparting] = useState("");
	const [cities, setCities] = useState("");
	const [adults, setAdults] = useState(1);
	const [children, setChildren] = useState(0);

	const [creditCards, setCreditCards] = useState([{ name: "", points: "" }]);
	const [hotels, setHotels] = useState([{ name: "", points: "" }]);
	const [airlines, setAirlines] = useState([{ name: "", points: "" }]);

	const [json, setJson] = useState("{}");

	const handleChange = (
		list: { name: string; points: string }[],
		setList: Function,
		index: number,
		field: "name" | "points",
		value: string,
	) => {
		const updated = [...list];
		updated[index][field] = value;
		setList(updated);
	};

	const addRow = (
		list: { name: string; points: string }[],
		setList: Function,
	) => setList([...list, { name: "", points: "" }]);

	const removeRow = (
		list: { name: string; points: string }[],
		setList: Function,
		index: number,
	) => setList(list.filter((_, i) => i !== index));

	const toPointsObj = (list: { name: string; points: string }[]) =>
		list.reduce(
			(acc, c) => {
				if (c.name.trim()) acc[c.name.trim()] = parseInt(c.points || "0", 10);
				return acc;
			},
			{} as Record<string, number>,
		);

	const generateJSON = () => {
		const payload = {
			cities: cities
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
			start,
			end,
			start_date: startDate,
			dates_departing: datesDeparting
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
			end_date: endDate,
			num_people: { adults, children },
			loyalty_points: {
				credit_card: toPointsObj(creditCards),
				hotel: toPointsObj(hotels),
				airline: toPointsObj(airlines),
			},
		};
		setJson(JSON.stringify(payload, null, 2));
	};

	return (
		<main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
			<h1>Test Page</h1>

			<div>
				<label>
					Start City:{" "}
					<input value={start} onChange={(e) => setStart(e.target.value)} />
				</label>
			</div>
			<div>
				<label>
					End City:{" "}
					<input value={end} onChange={(e) => setEnd(e.target.value)} />
				</label>
			</div>
			<div>
				<label>
					Start Date:{" "}
					<input
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
					/>
				</label>
			</div>
			<div>
				<label>
					End Date:{" "}
					<input
						type="date"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
					/>
				</label>
			</div>
			<div>
				<label>
					Departing Dates (one per line):
					<br />
					<textarea
						rows={3}
						cols={30}
						value={datesDeparting}
						onChange={(e) => setDatesDeparting(e.target.value)}
					/>
				</label>
			</div>
			<div>
				<label>
					Cities (one per line):
					<br />
					<textarea
						rows={3}
						cols={30}
						value={cities}
						onChange={(e) => setCities(e.target.value)}
					/>
				</label>
			</div>
			<div>
				<label>
					Adults:{" "}
					<input
						type="number"
						value={adults}
						min={0}
						onChange={(e) => setAdults(parseInt(e.target.value))}
					/>
				</label>
			</div>
			<div>
				<label>
					Children:{" "}
					<input
						type="number"
						value={children}
						min={0}
						onChange={(e) => setChildren(parseInt(e.target.value))}
					/>
				</label>
			</div>

			<h2>Credit Card Points</h2>
			{creditCards.map((c, i) => (
				<div key={i} style={{ display: "flex", gap: "0.5rem" }}>
					<input
						type="text"
						placeholder="Program"
						value={c.name}
						onChange={(e) =>
							handleChange(
								creditCards,
								setCreditCards,
								i,
								"name",
								e.target.value,
							)
						}
					/>
					<input
						type="number"
						placeholder="Points"
						value={c.points}
						onChange={(e) =>
							handleChange(
								creditCards,
								setCreditCards,
								i,
								"points",
								e.target.value,
							)
						}
					/>
					<button onClick={() => removeRow(creditCards, setCreditCards, i)}>
						Remove
					</button>
				</div>
			))}
			<button onClick={() => addRow(creditCards, setCreditCards)}>+ Add</button>

			<h2>Hotel Points</h2>
			{hotels.map((h, i) => (
				<div key={i} style={{ display: "flex", gap: "0.5rem" }}>
					<input
						type="text"
						placeholder="Hotel Program"
						value={h.name}
						onChange={(e) =>
							handleChange(hotels, setHotels, i, "name", e.target.value)
						}
					/>
					<input
						type="number"
						placeholder="Points"
						value={h.points}
						onChange={(e) =>
							handleChange(hotels, setHotels, i, "points", e.target.value)
						}
					/>
					<button onClick={() => removeRow(hotels, setHotels, i)}>
						Remove
					</button>
				</div>
			))}
			<button onClick={() => addRow(hotels, setHotels)}>+ Add</button>

			<h2>Airline Points</h2>
			{airlines.map((a, i) => (
				<div key={i} style={{ display: "flex", gap: "0.5rem" }}>
					<input
						type="text"
						placeholder="Airline Program"
						value={a.name}
						onChange={(e) =>
							handleChange(airlines, setAirlines, i, "name", e.target.value)
						}
					/>
					<input
						type="number"
						placeholder="Points"
						value={a.points}
						onChange={(e) =>
							handleChange(airlines, setAirlines, i, "points", e.target.value)
						}
					/>
					<button onClick={() => removeRow(airlines, setAirlines, i)}>
						Remove
					</button>
				</div>
			))}
			<button onClick={() => addRow(airlines, setAirlines)}>+ Add</button>

			<div style={{ marginTop: "1rem" }}>
				<button onClick={generateJSON}>Generate JSON</button>
			</div>

			<h2>Output</h2>
			<pre style={{ background: "#111", color: "#0f0", padding: "1rem" }}>
				{json}
			</pre>
		</main>
	);
}
