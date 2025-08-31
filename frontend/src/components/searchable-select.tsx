import type { ListBoxItemProps } from "react-aria-components";
import {
	Autocomplete,
	Button,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	SearchField,
	Select,
	SelectValue,
	useFilter,
} from "react-aria-components";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from "lucide-react";

type Option = { id: string; name: string };

interface SearchableSelectProps {
	label: string;
	placeholder?: string;
	options: Option[];
	className?: string;
}

export default function SearchableSelect({
	label,
	options,
	placeholder = "Search...",
	className = "",
}: SearchableSelectProps) {
	const { contains } = useFilter({ sensitivity: "base" });

	return (
		<div
			className={`flex w-full justify-center rounded-md border border-gray-300 ${className}`}
		>
			<Select
				className="flex w-full flex-col"
				defaultSelectedKey={options.length > 0 ? options[0].id : undefined}
			>
				<Label className="block px-3 pt-3 text-xs text-gray-400">{label}</Label>
				<Button className="flex w-full items-center justify-between px-3 pb-3 focus:outline-none">
					<SelectValue className="font-semibold" />
					<ChevronsUpDownIcon className="h-4 w-4" />
				</Button>

				<Popover className="entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out flex !max-h-80 w-(--trigger-width) flex-col rounded-md bg-white text-base shadow-lg ring-1 ring-black/5">
					<Autocomplete filter={contains}>
						<SearchField
							aria-label="Search"
							autoFocus
							className="group m-1 flex items-center rounded-full border-2 border-gray-300 bg-white has-focus:border-sky-600 forced-colors:bg-[Field]"
						>
							<SearchIcon
								aria-hidden
								className="ml-2 h-4 w-4 text-gray-600 forced-colors:text-[ButtonText]"
							/>
							<Input
								placeholder={placeholder}
								className="min-w-0 flex-1 border-none bg-white px-2 py-1 font-[inherit] text-base text-gray-800 placeholder-gray-500 outline outline-0 [&::-webkit-search-cancel-button]:hidden"
							/>
							<Button className="pressed:bg-black/10 mr-1 flex w-6 items-center justify-center rounded-full border-0 bg-transparent p-1 text-center text-sm text-gray-600 transition group-empty:invisible hover:bg-black/[5%]">
								<XIcon aria-hidden className="h-4 w-4" />
							</Button>
						</SearchField>
						<ListBox
							items={options}
							className="flex-1 scroll-pb-1 overflow-auto p-1 outline-hidden"
						>
							{(item) => <SelectItem>{item.name}</SelectItem>}
						</ListBox>
					</Autocomplete>
				</Popover>
			</Select>
		</div>
	);
}

function SelectItem(props: ListBoxItemProps & { children: string }) {
	return (
		<ListBoxItem
			{...props}
			textValue={props.children}
			className="group flex cursor-default items-center gap-2 rounded-sm px-4 py-2 text-gray-900 outline-hidden select-none focus:bg-sky-600 focus:text-white"
		>
			{({ isSelected }) => (
				<>
					<span className="group-selected:font-medium flex flex-1 items-center gap-2 truncate">
						{props.children}
					</span>
					<span className="text-sk flex w-5 items-center group-focus:text-white">
						{isSelected && <CheckIcon size="S" />}
					</span>
				</>
			)}
		</ListBoxItem>
	);
}
