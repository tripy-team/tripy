'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DateRangePicker as AriaDateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  RangeCalendar,
  Calendar,
} from 'react-aria-components';
import type { PopoverProps } from 'react-aria-components';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date';

interface DateRangePickerProps {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  disabled?: boolean;
  isOneWay?: boolean;
}

type DateRangeValue = {
  start: DateValue;
  end: DateValue;
} | null;


// react-aria DateInput render prop receives a DateSegment-like object.
// Some versions don't type `isPlaceholder`, so guard safely.
type SegmentWithOptionalPlaceholder = { isPlaceholder?: boolean };
function hasIsPlaceholder(x: unknown): x is SegmentWithOptionalPlaceholder {
  return typeof x === 'object' && x !== null && 'isPlaceholder' in x;
}

function renderSegment(segment: unknown) {
  const isPlaceholder = hasIsPlaceholder(segment) ? !!segment.isPlaceholder : false;
  return (
    <DateSegment
      segment={segment as never}
      className={[
        'px-0.5 text-sm tabular-nums outline-none rounded min-h-[20px] cursor-pointer',
        'focus:bg-blue-100 focus:text-blue-900',
        isPlaceholder ? 'text-slate-400' : 'text-slate-900',
      ].join(' ')}
    />
  );
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  disabled = false,
  isOneWay = false,
}: DateRangePickerProps) {
  const minValue = useMemo(() => today(getLocalTimeZone()), []);

  // ---- ONE WAY: use DatePicker (single date) ----
  if (isOneWay) {
    return (
      <OneWayDatePicker
        date={startDate}
        onChange={(d) => onStartDateChange(d)}
        disabled={disabled}
        minValue={minValue}
      />
    );
  }

  // ---- ROUND TRIP: use DateRangePicker ----
  return (
    <RoundTripDateRangePicker
      startDate={startDate}
      endDate={endDate}
      onStartDateChange={onStartDateChange}
      onEndDateChange={onEndDateChange}
      disabled={disabled}
      minValue={minValue}
    />
  );
}

function OneWayDatePicker({
  date,
  onChange,
  disabled,
  minValue,
}: {
  date: string;
  onChange: (date: string) => void;
  disabled: boolean;
  minValue: DateValue;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const value = useMemo(() => {
    try {
      return date ? parseDate(date) : null;
    } catch {
      return null;
    }
  }, [date]);

  return (
    <div className="relative w-full">
      <AriaDatePicker
        value={value}
        onChange={(v) => onChange(v ? v.toString() : '')}
        isDisabled={disabled}
        minValue={minValue}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col"
      >
        <div
          ref={triggerRef}
          className="cursor-pointer w-full"
          onMouseDown={(e) => {
            // prevent focus thrash and keep click snappy
            e.preventDefault();
            if (!disabled) setIsOpen(true);
          }}
        >
          <Group className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CalendarIcon className="w-5 h-5 text-slate-400 flex-shrink-0 pointer-events-none" />
              <div className="flex-1 min-w-0">
                <label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider cursor-pointer">
                  Start Date
                </label>
                <DateInput className="flex flex-wrap min-w-0 cursor-pointer">
                  {(segment) => renderSegment(segment)}
                </DateInput>
              </div>
            </div>
          </Group>
        </div>

        {isOpen && (
          <MyPopover triggerRef={triggerRef} placement="bottom start" offset={8} isOpen={isOpen} onOpenChange={setIsOpen}>
            <Dialog className="p-4 text-slate-950">
              <Calendar>
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
                    {(d) => (
                      <CalendarCell
                        date={d}
                        className={({ isSelected, isFocused, isOutsideMonth }) =>
                          [
                            'flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors cursor-pointer',
                            isSelected ? 'bg-blue-600 text-white font-semibold' : '',
                            isFocused ? 'ring-2 ring-blue-600 ring-offset-1' : '',
                            isOutsideMonth ? 'text-slate-300' : 'text-slate-900',
                            !isSelected && !isFocused ? 'hover:bg-slate-100' : '',
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
          </MyPopover>
        )}
      </AriaDatePicker>
    </div>
  );
}

function RoundTripDateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  disabled,
  minValue,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  disabled: boolean;
  minValue: DateValue;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Anchor under the box you click
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [activeTrigger, setActiveTrigger] = useState<'start' | 'end'>('start');

  const controlledValue: DateRangeValue = useMemo(() => {
    try {
      if (!startDate || !endDate) return null;
      return { start: parseDate(startDate), end: parseDate(endDate) };
    } catch {
      return null;
    }
  }, [startDate, endDate]);

  return (
    <div className="relative w-full">
      <AriaDateRangePicker
        value={controlledValue}
        onChange={(val) => {
          if (!val) {
            if (startDate) onStartDateChange('');
            if (endDate) onEndDateChange('');
            return;
          }

          // Normalize in case end < start
          let s = val.start;
          let e = val.end;
          if (s && e && e.compare(s) < 0) [s, e] = [e, s];

          const sStr = s?.toString() ?? '';
          const eStr = e?.toString() ?? '';

          // Write-through to parent state (no timeouts)
          if (sStr !== startDate) onStartDateChange(sStr);
          if (eStr !== endDate) onEndDateChange(eStr);

          // Close only when both picked
          if (s && e) setIsOpen(false);
        }}
        isDisabled={disabled}
        minValue={minValue}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col"
      >
        <div className="grid grid-cols-2 gap-4">
          {/* Start */}
          <div
            ref={startRef}
            className="cursor-pointer w-full"
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                setActiveTrigger('start');
                setIsOpen(true);
              }
            }}
          >
            <Group className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors">
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

          {/* End */}
          <div
            ref={endRef}
            className="cursor-pointer w-full"
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                setActiveTrigger('end');
                setIsOpen(true);
              }
            }}
          >
            <Group className="flex w-full items-center px-4 py-3 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent hover:border-slate-300 transition-colors">
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

        {isOpen && (
          <MyPopover
            key={activeTrigger}
            triggerRef={activeTrigger === 'end' ? endRef : startRef}
            placement={activeTrigger === 'end' ? 'bottom end' : 'bottom start'}
            offset={8}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
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
                    {(d) => (
                      <CalendarCell
                        date={d}
                        className={({ isSelected, isFocused, isSelectionStart, isSelectionEnd, isOutsideMonth }) =>
                          [
                            'flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors cursor-pointer',
                            isSelected
                              ? isSelectionStart || isSelectionEnd
                                ? 'bg-blue-600 text-white font-semibold'
                                : 'bg-blue-100 text-blue-900'
                              : '',
                            isFocused ? 'ring-2 ring-blue-600 ring-offset-1' : '',
                            isOutsideMonth ? 'text-slate-300' : 'text-slate-900',
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

function MyPopover({
  triggerRef,
  placement,
  isOpen,
  onOpenChange,
  ...props
}: PopoverProps & { isOpen?: boolean; onOpenChange?: (isOpen: boolean) => void }) {
  return (
    <Popover
      {...props}
      triggerRef={triggerRef}
      placement={placement}
      shouldFlip={false}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
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
