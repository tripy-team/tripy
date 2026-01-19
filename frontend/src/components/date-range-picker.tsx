'use client';

import { useState, useEffect } from 'react';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DateRangePicker as AriaDateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  RangeCalendar,
} from 'react-aria-components';
import type { PopoverProps } from 'react-aria-components';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { parseDate, today, getLocalTimeZone, type DateValue } from '@internationalized/date';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  disabled?: boolean;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  disabled = false,
}: DateRangePickerProps) {
  // Convert string dates to DateValue or null
  const getDateValue = (): { start: DateValue | null; end: DateValue | null } => {
    try {
      const start = startDate ? parseDate(startDate) : null;
      const end = endDate ? parseDate(endDate) : null;
      return { start, end };
    } catch {
      return { start: null, end: null };
    }
  };

  const [range, setRange] = useState<{ start: DateValue | null; end: DateValue | null }>(() => 
    getDateValue()
  );

  // Update range when props change
  useEffect(() => {
    setRange(getDateValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handleChange = (value: { start: DateValue | null; end: DateValue | null } | null) => {
    if (value) {
      setRange(value);
      if (value.start) {
        onStartDateChange(value.start.toString());
      }
      if (value.end) {
        onEndDateChange(value.end.toString());
      }
    } else {
      setRange({ start: null, end: null });
      onStartDateChange('');
      onEndDateChange('');
    }
  };

  return (
    <div className="relative w-full">
      <AriaDateRangePicker
        value={range.start && range.end ? { start: range.start, end: range.end } : null}
        onChange={handleChange}
        isDisabled={disabled}
        minValue={today(getLocalTimeZone())}
        className="flex w-full flex-col"
      >
        <div className="grid grid-cols-2 gap-4">
          {/* Start Date Box */}
          <Group className="flex w-full items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent cursor-pointer">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider">
                  Start Date
                </label>
                <DateInput slot="start" className="flex flex-wrap min-w-0">
                  {(segment) => (
                    <DateSegment
                      segment={segment}
                      className={`px-0.5 text-sm tabular-nums outline-none rounded focus:bg-blue-100 focus:text-blue-900 ${
                        range.start ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    />
                  )}
                </DateInput>
              </div>
            </div>
            <Button className="flex items-center rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
              <CalendarIcon className="h-5 w-5" />
            </Button>
          </Group>

          {/* End Date Box */}
          <Group className="flex w-full items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent cursor-pointer">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider">
                  End Date
                </label>
                <DateInput slot="end" className="flex flex-wrap min-w-0">
                  {(segment) => (
                    <DateSegment
                      segment={segment}
                      className={`px-0.5 text-sm tabular-nums outline-none rounded focus:bg-blue-100 focus:text-blue-900 ${
                        range.end ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    />
                  )}
                </DateInput>
              </div>
            </div>
            <Button className="flex items-center rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
              <CalendarIcon className="h-5 w-5" />
            </Button>
          </Group>
        </div>

        <MyPopover>
          <Dialog className="p-4 text-slate-950">
            <RangeCalendar>
              <header className="flex w-full items-center gap-1 px-1 pb-4">
                <Heading className="ml-2 flex-1 font-semibold text-slate-900" />
                <Button slot="previous" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors">
                  <ChevronLeftIcon className="h-4 w-4 text-slate-900" />
                </Button>
                <Button slot="next" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors">
                  <ChevronRightIcon className="h-4 w-4 text-slate-900" />
                </Button>
              </header>
              <CalendarGrid className="border-separate border-spacing-1">
                <CalendarGridHeader>
                  {(day) => (
                    <CalendarHeaderCell className="text-xs font-semibold text-slate-500 py-2">
                      {day}
                    </CalendarHeaderCell>
                  )}
                </CalendarGridHeader>
                <CalendarGridBody>
                  {(date) => (
                    <CalendarCell
                      date={date}
                      className={({ isSelected, isFocused, isSelectionStart, isSelectionEnd, isOutsideMonth }) =>
                        `flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors ${
                          isSelected
                            ? isSelectionStart || isSelectionEnd
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'bg-blue-100 text-blue-900'
                            : ''
                        } ${
                          isFocused ? 'ring-2 ring-blue-600 ring-offset-1' : ''
                        } ${
                          isOutsideMonth ? 'text-slate-300' : 'text-slate-900'
                        } hover:bg-blue-50 ${
                          !isSelected && !isFocused ? 'hover:bg-slate-100' : ''
                        }`
                      }
                    />
                  )}
                </CalendarGridBody>
              </CalendarGrid>
            </RangeCalendar>
          </Dialog>
        </MyPopover>
      </AriaDateRangePicker>
    </div>
  );
}

function MyPopover(props: PopoverProps) {
  return (
    <Popover
      {...props}
      className={({ isEntering, isExiting }) =>
        `rounded-xl bg-white border border-slate-200 shadow-lg ${
          isEntering
            ? 'animate-in fade-in placement-bottom:slide-in-from-top-1 placement-top:slide-in-from-bottom-1 duration-200 ease-out'
            : ''
        } ${
          isExiting
            ? 'animate-out fade-out placement-bottom:slide-out-to-top-1 placement-top:slide-out-to-bottom-1 duration-150 ease-in'
            : ''
        }`
      }
    />
  );
}
