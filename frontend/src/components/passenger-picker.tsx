"use client";

import {
	Button,
	Dialog,
	DialogTrigger,
	Popover,
	Label,
} from "react-aria-components";
import { MinusIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

export default function PassengerPicker() {
	const [adults, setAdults] = useState(1);
	const [children, setChildren] = useState(0);
	const [infantsSeat, setInfantsSeat] = useState(0);
	const [infantsLap, setInfantsLap] = useState(0);

	const [tempAdults, setTempAdults] = useState(adults);
	const [tempChildren, setTempChildren] = useState(children);
	const [tempInfantsSeat, setTempInfantsSeat] = useState(infantsSeat);
	const [tempInfantsLap, setTempInfantsLap] = useState(infantsLap);

	// const totalPassengers = adults + children + infantsSeat + infantsLap;

	const CounterRow = ({
		label,
		subLabel,
		count,
		setCount,
		min = 0,
	}: {
		label: string;
		subLabel?: string;
		count: number;
		setCount: (value: number) => void;
		min?: number;
	}) => (
		<div className="flex items-center justify-between py-2">
			<div>
				<p className="text-sm font-semibold text-slate-900">{label}</p>
				{subLabel && <p className="text-xs text-slate-500">{subLabel}</p>}
			</div>
			<div className="flex items-center gap-2">
				<Button
					onPress={() => setCount(Math.max(min, count - 1))}
					isDisabled={count <= min}
					className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white hover:bg-slate-800 active:bg-slate-700 disabled:bg-slate-300 disabled:text-white disabled:opacity-30"
				>
					<MinusIcon className="h-4 w-4" />
				</Button>
				<span className="w-5 text-center font-medium text-slate-800">
					{count}
				</span>
				<Button
					onPress={() => setCount(count + 1)}
					className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white hover:bg-slate-800 active:bg-slate-700"
				>
					<PlusIcon className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);

	return (
		<DialogTrigger>
			<Button className="flex w-full flex-col items-start justify-center rounded-md border border-gray-300 px-3 py-2 text-left">
				<Label className="text-xs text-gray-400">Passengers</Label>
				<div className="mt-0.5 flex w-full items-center justify-between">
					<span className="font-semibold text-slate-900">
						{[
							adults > 0 ? `${adults} Adult${adults > 1 ? "s" : ""}` : null,
							children > 0
								? `${children} Child${children > 1 ? "ren" : ""}`
								: null,
							infantsSeat > 0
								? `${infantsSeat} Infant${infantsSeat > 1 ? "s" : ""} (seat)`
								: null,
							infantsLap > 0
								? `${infantsLap} Infant${infantsLap > 1 ? "s" : ""} (lap)`
								: null,
						]
							.filter(Boolean)
							.join(", ") || "No passengers"}
					</span>

					<UsersIcon className="h-4 w-4 text-slate-950" />
				</div>
			</Button>

			<Popover className="w-[280px] rounded-md bg-white p-4 shadow-xl ring-1 ring-black/10">
				<Dialog>
					{({ close }) => (
						<>
							<div className="space-y-3">
								<CounterRow
									label="Adults"
									count={tempAdults}
									setCount={setTempAdults}
									min={1}
								/>
								<CounterRow
									label="Children"
									subLabel="Aged 2–11"
									count={tempChildren}
									setCount={setTempChildren}
								/>
								<CounterRow
									label="Infants"
									subLabel="In seat"
									count={tempInfantsSeat}
									setCount={setTempInfantsSeat}
								/>
								<CounterRow
									label="Infants"
									subLabel="On lap"
									count={tempInfantsLap}
									setCount={setTempInfantsLap}
								/>
							</div>

							<div className="mt-4 flex justify-end gap-4 text-sm font-medium">
								<Button
									className="text-slate-500 hover:underline"
									onPress={() => {
										// Reset values and close
										setTempAdults(adults);
										setTempChildren(children);
										setTempInfantsSeat(infantsSeat);
										setTempInfantsLap(infantsLap);
										close();
									}}
								>
									Cancel
								</Button>
								<Button
									className="text-slate-900 hover:underline"
									onPress={() => {
										// Save values and close
										setAdults(tempAdults);
										setChildren(tempChildren);
										setInfantsSeat(tempInfantsSeat);
										setInfantsLap(tempInfantsLap);
										close();
									}}
								>
									Done
								</Button>
							</div>
						</>
					)}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
