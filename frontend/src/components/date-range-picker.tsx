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
  Label,
} from 'react-aria-components';
import type { ButtonProps, PopoverProps } from 'react-aria-components';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { getLocalTimeZone, parseDate, today, type DateValue, type CalendarDate } from '@internationalized/date';
import type { RangeValue } from '@react-types/shared';

interface DateRangePickerProps {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  disabled?: boolean;
  isOneWay?: boolean;
}

function RoundButton(props: ButtonProps) {
  return (
    <Button
      {...props}
      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
    />
  );
}

function MyPopover(props: PopoverProps) {
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

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  disabled = false,
  isOneWay = false,
}: DateRangePickerProps) {
  // All hooks must be called unconditionally at the top
  const minValue = useMemo(() => today(getLocalTimeZone()), []);
  
  const oneWayValue = useMemo(() => {
    try {
      return startDate ? parseDate(startDate) : null;
    } catch {
      return null;
    }
  }, [startDate]);

  const range = useMemo<RangeValue<CalendarDate> | null>(() => {
    try {
      if (!startDate || !endDate) return null;
      return {
        start: parseDate(startDate),
        end: parseDate(endDate),
      };
    } catch {
      return null;
    }
  }, [startDate, endDate]);

  const [activeField, setActiveField] = useState<'start' | 'end' | null>(null);

  // ---- ONE WAY: use DatePicker (single date) ----
  if (isOneWay) {
    return (
      <div className="relative w-full">
        <AriaDatePicker
          value={oneWayValue}
          onChange={(v) => onStartDateChange(v ? v.toString() : '')}
          isDisabled={disabled}
          minValue={minValue}
          className="w-full"
        >
          <div className="flex w-full flex-col justify-center rounded-xl border border-slate-200 bg-white">
            <Label className="block px-4 pt-3 text-xs text-slate-500 uppercase font-bold tracking-wider">
              Start Date
            </Label>
            <Group className="flex w-full items-center justify-between px-4 pb-3">
              <DateInput className="flex flex-1 flex-wrap font-semibold">
                {(segment) => (
                  <DateSegment
                    segment={segment}
                    className="px-0.5 text-sm text-slate-900 tabular-nums outline-none rounded min-h-[20px] focus:bg-blue-100 focus:text-blue-900 cursor-pointer"
                  />
                )}
              </DateInput>
              <Button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 transition-colors">
                <CalendarIcon className="h-5 w-5" />
              </Button>
            </Group>
          </div>

          <MyPopover>
            <Dialog className="p-4 text-slate-950">
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
                      <CalendarHeaderCell className="text-xs font-semibold text-slate-500 py-2">
                        {day}
                      </CalendarHeaderCell>
                    )}
                  </CalendarGridHeader>
                  <CalendarGridBody>
                    {(date) => (
                      <CalendarCell
                        date={date}
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
        </AriaDatePicker>
      </div>
    );
  }

  // ---- ROUND TRIP: use DateRangePicker ----

  return (
    <div className="relative w-full">
      <AriaDateRangePicker
        value={range}
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

          if (sStr !== startDate) onStartDateChange(sStr);
          if (eStr !== endDate) onEndDateChange(eStr);
        }}
        isDisabled={disabled}
        minValue={minValue}
        className="w-full"
      >
        <div className="grid grid-cols-2 gap-4">
          {/* Start Date */}
          <div className="flex w-full flex-col justify-center rounded-xl border border-slate-200 bg-white">
            <Label className="block px-4 pt-3 text-xs text-slate-500 uppercase font-bold tracking-wider">
              Start Date
            </Label>
            <div
              className="flex w-full items-center justify-between px-4 pb-3 font-semibold"
              onPointerDown={() => !disabled && setActiveField('start')}
            >
              <DateInput
                slot="start"
                className={`flex flex-1 flex-wrap rounded-md bg-white ${
                  activeField === 'start' ? 'ring-2 ring-blue-600' : ''
                }`}
              >
                {(segment) => (
                  <DateSegment
                    segment={segment}
                    className="px-0.5 text-sm text-slate-900 tabular-nums outline-none rounded min-h-[20px] focus:bg-blue-100 focus:text-blue-900 cursor-pointer"
                  />
                )}
              </DateInput>
              <Button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 transition-colors">
                <CalendarIcon className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* End Date */}
          <div className="flex w-full flex-col justify-center rounded-xl border border-slate-200 bg-white">
            <Label className="block px-4 pt-3 text-xs text-slate-500 uppercase font-bold tracking-wider">
              End Date
            </Label>
            <div
              className="flex w-full items-center justify-between px-4 pb-3 font-semibold"
              onPointerDown={() => !disabled && setActiveField('end')}
            >
              <DateInput
                slot="end"
                className={`flex flex-1 flex-wrap rounded-md bg-white ${
                  activeField === 'end' ? 'ring-2 ring-blue-600' : ''
                }`}
              >
                {(segment) => (
                  <DateSegment
                    segment={segment}
                    className="px-0.5 text-sm text-slate-900 tabular-nums outline-none rounded min-h-[20px] focus:bg-blue-100 focus:text-blue-900 cursor-pointer"
                  />
                )}
              </DateInput>
              <Button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 transition-colors">
                <CalendarIcon className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        <MyPopover>
          <Dialog className="p-4 text-slate-950">
            <RangeCalendar>
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
      </AriaDateRangePicker>
    </div>
  );
}
