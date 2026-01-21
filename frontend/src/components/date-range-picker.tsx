'use client';

import { useState, useEffect, useRef } from 'react';
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
  const startDateRef = useRef<HTMLDivElement>(null);
  const endDateRef = useRef<HTMLDivElement>(null);
  const [activeTrigger, setActiveTrigger] = useState<'start' | 'end' | null>(null);

  // Update range when props change
  useEffect(() => {
    setRange(getDateValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handleChange = (value: { start: DateValue | null; end: DateValue | null } | null) => {
    if (value) {
      // Ensure end date is not before start date
      if (value.start && value.end && value.end.compare(value.start) < 0) {
        // If end is before start, swap them
        const temp = value.start;
        value.start = value.end;
        value.end = temp;
      }
      
      setRange(value);
      
      // Only update start date if it actually changed
      if (value.start) {
        const newStartStr = value.start.toString();
        if (newStartStr !== startDate) {
          onStartDateChange(newStartStr);
        }
      }
      
      // Only update end date if it actually changed
      if (value.end) {
        const newEndStr = value.end.toString();
        if (newEndStr !== endDate) {
          onEndDateChange(newEndStr);
        }
      }
    } else {
      setRange({ start: null, end: null });
      if (startDate) onStartDateChange('');
      if (endDate) onEndDateChange('');
    }
  };

  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative w-full">
      <AriaDateRangePicker
        value={range.start && range.end ? { start: range.start, end: range.end } : (range.start ? { start: range.start, end: range.start } : null)}
        onChange={handleChange}
        isDisabled={disabled}
        minValue={today(getLocalTimeZone())}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col"
      >
        <div className="grid grid-cols-2 gap-4">
          {/* Start Date Box */}
          <div
            ref={startDateRef}
            onClick={() => {
              setActiveTrigger('start');
              setIsOpen(true);
            }}
            className="cursor-pointer"
          >
            <Group 
              className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors"
            >
              <div
                className="flex items-center gap-3 flex-1 min-w-0"
                onClick={() => {
                  setActiveTrigger('start');
                  setIsOpen(true);
                }}
              >
                <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0 pointer-events-none" />
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    Start Date
                  </label>
                  <DateInput
                    slot="start"
                    className="flex flex-wrap min-w-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTrigger('start');
                      setIsOpen(true);
                    }}
                  >
                    {(segment) => (
                      <DateSegment
                        segment={segment}
                        className={`px-0.5 text-sm tabular-nums outline-none rounded focus:bg-blue-100 focus:text-blue-900 cursor-pointer ${
                          range.start ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      />
                    )}
                  </DateInput>
                </div>
              </div>
            </Group>
          </div>

          {/* End Date Box */}
          <div
            ref={endDateRef}
            onClick={() => {
              setActiveTrigger('end');
              setIsOpen(true);
            }}
            className="cursor-pointer"
          >
            <Group 
              className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors"
            >
              <div
                className="flex items-center gap-3 flex-1 min-w-0"
                onClick={() => {
                  setActiveTrigger('end');
                  setIsOpen(true);
                }}
              >
                <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0 pointer-events-none" />
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    End Date
                  </label>
                  <DateInput
                    slot="end"
                    className="flex flex-wrap min-w-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTrigger('end');
                      setIsOpen(true);
                    }}
                  >
                    {(segment) => (
                      <DateSegment
                        segment={segment}
                        className={`px-0.5 text-sm tabular-nums outline-none rounded focus:bg-blue-100 focus:text-blue-900 cursor-pointer ${
                          range.end ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      />
                    )}
                  </DateInput>
                </div>
              </div>
            </Group>
          </div>
        </div>

        <MyPopover
          placement={activeTrigger === 'end' ? 'bottom end' : 'bottom start'}
          offset={8}
        >
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

function MyPopover({ placement, ...props }: PopoverProps) {
  const placementStr = placement as string | undefined;
  return (
    <Popover
      {...props}
      placement={placement}
      className={({ isEntering, isExiting }) =>
        `rounded-xl bg-white border border-slate-200 shadow-lg ${
          placementStr?.includes('end')
            ? '[&[data-placement^=bottom]]:!right-0 [&[data-placement^=bottom]]:!left-auto'
            : '[&[data-placement^=bottom]]:!left-0 [&[data-placement^=bottom]]:!right-auto'
        } ${
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
