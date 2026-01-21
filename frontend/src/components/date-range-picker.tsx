'use client';

import { useEffect, useRef, useState } from 'react';
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
import {
  getLocalTimeZone,
  parseDate,
  today,
  type DateValue,
} from '@internationalized/date';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  disabled?: boolean;
}

type DateRangeValue = { start: DateValue | null; end: DateValue | null };

// react-aria DateInput render prop receives a DateSegment-like object.
// The type exported by react-aria may not include `isPlaceholder` in your version,
// so we use a safe type guard without `any`.
type SegmentWithOptionalPlaceholder = { isPlaceholder?: boolean };
function hasIsPlaceholder(x: unknown): x is SegmentWithOptionalPlaceholder {
  return typeof x === 'object' && x !== null && 'isPlaceholder' in x;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  disabled = false,
}: DateRangePickerProps) {
  const getDateValue = (): DateRangeValue => {
    try {
      return {
        start: startDate ? parseDate(startDate) : null,
        end: endDate ? parseDate(endDate) : null,
      };
    } catch {
      return { start: null, end: null };
    }
  };

  const [range, setRange] = useState<DateRangeValue>(() => getDateValue());
  const [isOpen, setIsOpen] = useState(false);

  // Anchor the popover under whichever box was last clicked.
  const startDateRef = useRef<HTMLDivElement>(null);
  const endDateRef = useRef<HTMLDivElement>(null);
  const [activeTrigger, setActiveTrigger] = useState<'start' | 'end'>('start');

  useEffect(() => {
    setRange(getDateValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handleChange = (value: DateRangeValue | null) => {
    if (!value) {
      setRange({ start: null, end: null });
      if (startDate) onStartDateChange('');
      if (endDate) onEndDateChange('');
      return;
    }

    // Normalize: if both exist and end < start, swap.
    if (value.start && value.end && value.end.compare(value.start) < 0) {
      const tmp = value.start;
      value.start = value.end;
      value.end = tmp;
    }

    setRange(value);

    if (value.start) {
      const newStartStr = value.start.toString();
      if (newStartStr !== startDate) onStartDateChange(newStartStr);
    }
    if (value.end) {
      const newEndStr = value.end.toString();
      if (newEndStr !== endDate) onEndDateChange(newEndStr);
    }
  };

  const renderSegment = (segment: unknown) => {
    const isPlaceholder = hasIsPlaceholder(segment) ? !!segment.isPlaceholder : false;

    return (
      <DateSegment
        // DateSegment expects the same segment object passed by DateInput.
        // The lib typing may be broader than we need; passing `unknown` here is fine
        // because it's the exact runtime shape from react-aria-components.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        segment={segment as never}
        className={`px-0.5 text-sm tabular-nums outline-none rounded min-h-[20px] focus:bg-blue-100 focus:text-blue-900 cursor-pointer ${
          isPlaceholder ? 'text-slate-400' : 'text-slate-900'
        }`}
      />
    );
  };

  return (
    <div className="relative w-full">
      <AriaDateRangePicker
        value={range.start && range.end ? { start: range.start, end: range.end } : null}
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
            className="cursor-pointer w-full"
            onClick={() => {
              setActiveTrigger('start');
              setIsOpen(true);
            }}
          >
            <Group
              className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors"
              onFocusCapture={() => {
                setActiveTrigger('start');
                setIsOpen(true);
              }}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0 pointer-events-none" />
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider cursor-pointer">
                    Start Date
                  </label>

                  <DateInput slot="start" className="flex flex-wrap min-w-0 cursor-pointer">
                    {(segment) => renderSegment(segment)}
                  </DateInput>
                </div>
              </div>
            </Group>
          </div>

          {/* End Date Box */}
          <div
            ref={endDateRef}
            className="cursor-pointer w-full"
            onClick={() => {
              setActiveTrigger('end');
              setIsOpen(true);
            }}
          >
            <Group
              className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors"
              onFocusCapture={() => {
                setActiveTrigger('end');
                setIsOpen(true);
              }}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0 pointer-events-none" />
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider cursor-pointer">
                    End Date
                  </label>

                  <DateInput slot="end" className="flex flex-wrap min-w-0 cursor-pointer">
                    {(segment) => renderSegment(segment)}
                  </DateInput>
                </div>
              </div>
            </Group>
          </div>
        </div>

        {/* Popover: only render while open so clicking outside hides the calendar */}
        {isOpen && (
          <MyPopover
            key={activeTrigger}
            triggerRef={activeTrigger === 'end' ? endDateRef : startDateRef}
            placement={activeTrigger === 'end' ? 'bottom end' : 'bottom start'}
            offset={8}
          >
            <Dialog className="p-4 text-slate-950">
              <RangeCalendar>
                <header className="flex w-full items-center gap-1 px-1 pb-4">
                  <Heading className="ml-2 flex-1 font-semibold text-slate-900" />
                  <Button
                    slot="previous"
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <ChevronLeftIcon className="h-4 w-4 text-slate-900" />
                  </Button>
                  <Button
                    slot="next"
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                  >
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
                        className={({
                          isSelected,
                          isFocused,
                          isSelectionStart,
                          isSelectionEnd,
                          isOutsideMonth,
                        }) =>
                          [
                            'flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors',
                            isSelected
                              ? isSelectionStart || isSelectionEnd
                                ? 'bg-blue-600 text-white font-semibold'
                                : 'bg-blue-100 text-blue-900'
                              : '',
                            isFocused ? 'ring-2 ring-blue-600 ring-offset-1' : '',
                            isOutsideMonth ? 'text-slate-300' : 'text-slate-900',
                            'hover:bg-blue-50',
                            !isSelected && !isFocused ? 'hover:bg-slate-100' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')
                        }
                      />
                    )}
                  </CalendarGridBody>
                </CalendarGrid>
              </RangeCalendar>
            </Dialog>
          </MyPopover>
        )}
      </AriaDateRangePicker>
    </div>
  );
}

function MyPopover({ triggerRef, placement, ...props }: PopoverProps) {
  return (
    <Popover
      {...props}
      triggerRef={triggerRef}
      placement={placement}
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
