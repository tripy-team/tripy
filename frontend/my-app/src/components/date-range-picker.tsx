"use client";

import {
	Button,
	DateInput,
	DateRangePicker,
	DateSegment,
	Dialog,
	Group,
	Label,
	Popover,
	RangeCalendar,
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHeader,
	CalendarHeaderCell,
	Heading,
} from "react-aria-components";
import type { ButtonProps, PopoverProps } from "react-aria-components";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import type { RangeValue } from "@react-types/shared";
import { useState } from "react";

export default function DatePickerCustom() {
	const [range, setRange] = useState<RangeValue<CalendarDate> | null>({
		start: parseDate("2025-07-17"),
		end: parseDate("2025-07-21"),
	});
	const [activeField, setActiveField] = useState<"start" | "end" | null>(null);

	return (
		<DateRangePicker value={range} onChange={setRange} className="w-full">
			<div className="flex gap-3">
				{/* Departure Date */}
				<div className="flex w-full flex-col justify-center rounded-md border border-gray-300">
					<Label className="block px-3 pt-3 text-xs text-gray-400">
						Departure Date
					</Label>
					<div
						className="flex w-full items-center justify-between px-3 pb-3 font-semibold"
						onPointerDown={() => setActiveField("start")}
					>
						<DateInput
							slot="start"
							className={`flex flex-1 flex-wrap rounded-md bg-white ${
								activeField === "start" ? "ring-2 ring-blue-950" : ""
							}`}
						>
							{(segment) => (
								<DateSegment
									segment={segment}
									className="px-0.5 text-sm text-slate-950 tabular-nums"
								/>
							)}
						</DateInput>
						<Button className="rounded-md p-1 text-slate-950 hover:bg-gray-100">
							<CalendarIcon className="h-4 w-4" />
						</Button>
					</div>
				</div>

				{/* Arrival Date */}
				<div className="flex w-full flex-col justify-center rounded-md border border-gray-300">
					<Label className="block px-3 pt-3 text-xs text-gray-400">
						Arrival Date
					</Label>
					<div
						className="flex w-full items-center justify-between px-3 pb-3 font-semibold"
						onPointerDown={() => setActiveField("end")}
					>
						<DateInput
							slot="end"
							className={`flex flex-1 flex-wrap rounded-md bg-white ${
								activeField === "end" ? "ring-2 ring-blue-950" : ""
							}`}
						>
							{(segment) => (
								<DateSegment
									segment={segment}
									className="px-0.5 text-sm text-slate-950 tabular-nums"
								/>
							)}
						</DateInput>
						<Button className="rounded-md p-1 text-slate-950 hover:bg-gray-100">
							<CalendarIcon className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>

			<MyPopover>
				<Dialog className="p-3 text-slate-950">
					<RangeCalendar value={range} onChange={setRange}>
						<header className="flex w-full items-center gap-1 px-1 pb-4">
							<Heading className="ml-2 flex-1 font-semibold" />
							<RoundButton slot="previous">
								<ChevronLeftIcon className="h-4 w-4 text-slate-950" />
							</RoundButton>
							<RoundButton slot="next">
								<ChevronRightIcon className="h-4 w-4 text-slate-950" />
							</RoundButton>
						</header>
						<CalendarGrid className="border-separate border-spacing-1">
							<CalendarGridHeader>
								{(day) => (
									<CalendarHeaderCell className="text-xs font-semibold text-gray-400">
										{day}
									</CalendarHeaderCell>
								)}
							</CalendarGridHeader>
							<CalendarGridBody>
								{(date) => (
									<CalendarCell
										date={date}
										className={({ isSelected, isFocused, isOutsideMonth }) =>
											`flex h-9 w-9 items-center justify-center rounded-full ${
												isSelected ? "bg-slate-950 text-white" : ""
											} ${isFocused ? "ring-2 ring-slate-400" : ""} ${
												isOutsideMonth ? "text-slate-300" : "text-slate-900"
											} hover:bg-gray-100`
										}
									/>
								)}
							</CalendarGridBody>
						</CalendarGrid>
					</RangeCalendar>
				</Dialog>
			</MyPopover>
		</DateRangePicker>
	);
}

function RoundButton(props: ButtonProps) {
	return (
		<Button
			{...props}
			className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100"
		/>
	);
}

function MyPopover(props: PopoverProps) {
	return (
		<Popover
			{...props}
			className={({ isEntering, isExiting }) =>
				`rounded-lg bg-white drop-shadow-lg ${
					isEntering
						? "animate-in fade-in placement-bottom:slide-in-from-top-1 placement-top:slide-in-from-bottom-1 duration-200 ease-out"
						: ""
				} ${
					isExiting
						? "animate-out fade-out placement-bottom:slide-out-to-top-1 placement-top:slide-out-to-bottom-1 duration-150 ease-in"
						: ""
				}`
			}
		/>
	);
}
