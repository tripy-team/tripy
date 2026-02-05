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
  minDate?: string; // "YYYY-MM-DD"
  maxDate?: string; // "YYYY-MM-DD"
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Compact variant for inline use in admin panels */
  compact?: boolean;
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
          'z-50 rounded-xl bg-white border border-slate-200 shadow-lg',
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
      if (minDate) {
        return parseDate(minDate);
      }
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
        ? "flex items-center bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors shadow-sm disabled:opacity-50"
        : "flex w-full items-center bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors"
      }>
        {!compact && <CalendarIcon className="h-4 w-4 text-slate-400 mr-3 flex-shrink-0" />}
        <DateInput className={compact ? "flex flex-wrap text-sm text-slate-900" : "flex flex-1 flex-wrap text-sm text-slate-900"}>
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
        {!compact && (
          <Button className="rounded-md p-1 text-slate-400 hover:bg-blue-100 transition-colors ml-2">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        )}
      </Group>

      <StyledPopover placement="bottom start" offset={8}>
        <Dialog className="p-4 text-slate-950 outline-none">
          <Calendar>
            <header className="flex w-full items-center gap-1 px-1 pb-4">
              <Heading className="ml-2 flex-1 font-semibold text-slate-900" />
              <RoundButton slot="previous">
                <ChevronLeftIcon className="h-4 w-4 text-slate-900" />
              </RoundButton>
              <RoundButton slot="next">
                <ChevronRightIcon className="h-4 w-4 text-slate-900" />
              </RoundButton>
            </header>
            <CalendarGrid className="border-separate border-spacing-1">
              <CalendarGridHeader>
                {(day) => (
                  <CalendarHeaderCell className="text-xs font-semibold text-slate-500 py-2 w-9">
                    {day}
                  </CalendarHeaderCell>
                )}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => (
                  <CalendarCell
                    date={date}
                    className={({ isSelected, isFocused, isOutsideMonth, isDisabled }) =>
                      [
                        'flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors',
                        isDisabled ? 'text-slate-300 cursor-not-allowed' : 'cursor-pointer',
                        isSelected ? 'bg-blue-600 text-white font-semibold' : '',
                        isFocused && !isSelected ? 'ring-2 ring-blue-600 ring-offset-1' : '',
                        isOutsideMonth ? 'text-slate-300' : '',
                        !isSelected && !isFocused && !isDisabled && !isOutsideMonth ? 'text-slate-900 hover:bg-blue-100' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                  />
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </StyledPopover>
    </AriaDatePicker>
  );
}
