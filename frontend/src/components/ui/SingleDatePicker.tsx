'use client';

import { useMemo } from 'react';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  Calendar,
} from 'react-aria-components';
import type { ButtonProps, PopoverProps } from 'react-aria-components';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { getLocalTimeZone, parseDate, today, CalendarDate } from '@internationalized/date';

interface SingleDatePickerProps {
  value: string; // "YYYY-MM-DD"
  onChange: (date: string) => void;
  /** Pass a "YYYY-MM-DD" string to set a minimum, null for no minimum, or omit to default to today */
  minDate?: string | null;
  maxDate?: string; // "YYYY-MM-DD"
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Compact variant for inline use in admin panels */
  compact?: boolean;
  /** "YYYY-MM-DD" — when the picker has no value, the calendar opens to this date's month */
  defaultFocusedDate?: string;
  /** "YYYY-MM-DD" — visually marks this date on the calendar (e.g. departure date shown on return picker) */
  markedDate?: string;
  /** Label shown next to the marked-date dot in the calendar */
  markedDateLabel?: string;
}

function RoundButton(props: ButtonProps) {
  return (
    <Button
      {...props}
      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
    />
  );
}

function StyledPopover(props: PopoverProps) {
  return (
    <Popover
      {...props}
      className={({ isEntering, isExiting }) =>
        [
          'z-50 rounded-xl bg-white border border-slate-200 shadow-lg !max-h-none',
          isEntering
            ? 'animate-in fade-in placement-bottom:slide-in-from-top-1 placement-top:slide-in-from-bottom-1 duration-200 ease-out'
            : '',
          isExiting
            ? 'animate-out fade-out placement-bottom:slide-out-to-top-1 placement-top:slide-out-to-bottom-1 duration-150 ease-in'
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
    />
  );
}

export default function SingleDatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  disabled = false,
  placeholder = 'Select date',
  className = '',
  compact = false,
  defaultFocusedDate,
  markedDate,
  markedDateLabel,
}: SingleDatePickerProps) {
  const dateValue = useMemo(() => {
    try {
      return value ? parseDate(value) : null;
    } catch {
      return null;
    }
  }, [value]);

  const minValue = useMemo(() => {
    try {
      if (minDate === null) return undefined;
      if (minDate) return parseDate(minDate);
      return today(getLocalTimeZone());
    } catch {
      return today(getLocalTimeZone());
    }
  }, [minDate]);

  const maxValue = useMemo(() => {
    try {
      if (maxDate) {
        return parseDate(maxDate);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }, [maxDate]);

  const focusedDefault = useMemo(() => {
    try {
      if (defaultFocusedDate) return parseDate(defaultFocusedDate);
      return undefined;
    } catch {
      return undefined;
    }
  }, [defaultFocusedDate]);

  const markedValue = useMemo(() => {
    try {
      if (markedDate) return parseDate(markedDate);
      return undefined;
    } catch {
      return undefined;
    }
  }, [markedDate]);

  return (
    <AriaDatePicker
      value={dateValue}
      onChange={(v) => onChange(v ? v.toString() : '')}
      isDisabled={disabled}
      minValue={minValue}
      maxValue={maxValue}
      className={compact ? className : `w-full ${className}`}
    >
      <Group className={compact 
        ? "relative flex items-center bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors shadow-sm disabled:opacity-50"
        : "flex w-full items-center bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors"
      }>
        {!compact && <CalendarIcon className="h-4 w-4 text-slate-400 mr-3 flex-shrink-0" />}
        <DateInput className={compact ? "flex flex-1 flex-wrap text-sm text-slate-900" : "flex flex-1 flex-wrap text-sm text-slate-900"}>
          {(segment) => (
            <DateSegment
              segment={segment}
              className={({ isFocused, isPlaceholder }) =>
                [
                  'px-0.5 tabular-nums outline-none rounded min-h-[20px]',
                  isFocused ? 'bg-blue-200 text-blue-900' : '',
                  isPlaceholder ? 'text-slate-400' : 'text-slate-900',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            />
          )}
        </DateInput>
        {compact ? (
          <>
            <CalendarIcon className="h-4 w-4 text-slate-400 flex-shrink-0 ml-1" />
            <Button className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Open calendar" />
          </>
        ) : (
          <Button className="rounded-md p-1 text-slate-400 hover:bg-blue-100 transition-colors ml-2">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        )}
      </Group>

      <StyledPopover placement="bottom start" offset={8} shouldFlip={false}>
        <Dialog className="p-4 text-slate-950 outline-none">
          <Calendar defaultFocusedValue={dateValue ?? focusedDefault}>
            <header className="flex w-full items-center gap-1 px-1 pb-4">
              <Heading className="ml-2 flex-1 font-semibold text-slate-900" />
              <RoundButton slot="previous">
                <ChevronLeftIcon className="h-4 w-4 text-slate-900" />
              </RoundButton>
              <RoundButton slot="next">
                <ChevronRightIcon className="h-4 w-4 text-slate-900" />
              </RoundButton>
            </header>
            {markedValue && markedDateLabel && (
              <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-slate-500">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-400" />
                {markedDateLabel}
              </div>
            )}
            <CalendarGrid className="border-separate border-spacing-1">
              <CalendarGridHeader>
                {(day) => (
                  <CalendarHeaderCell className="text-xs font-semibold text-slate-500 py-2 w-9">
                    {day}
                  </CalendarHeaderCell>
                )}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => {
                  const isMarked = markedValue
                    ? date.year === markedValue.year && date.month === markedValue.month && date.day === markedValue.day
                    : false;
                  return (
                    <CalendarCell
                      date={date}
                      className={({ isSelected, isFocused, isOutsideMonth, isDisabled: cellDisabled }) =>
                        [
                          'relative flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors',
                          cellDisabled ? 'text-slate-300 cursor-not-allowed' : 'cursor-pointer',
                          isSelected ? 'bg-blue-600 text-white font-semibold' : '',
                          isMarked && !isSelected ? 'ring-2 ring-orange-400 font-semibold' : '',
                          isFocused && !isSelected ? 'ring-2 ring-blue-600 ring-offset-1' : '',
                          isOutsideMonth ? 'text-slate-300' : '',
                          !isSelected && !isFocused && !cellDisabled && !isOutsideMonth ? 'text-slate-900 hover:bg-blue-100' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')
                      }
                    />
                  );
                }}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </StyledPopover>
    </AriaDatePicker>
  );
}
