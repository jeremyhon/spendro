"use client";

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange, SelectRangeEventHandler } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getCurrentMonth,
  getLastMonth,
  getLastNMonths,
  plainDateRangeToDateRange,
} from "@/lib/utils/temporal-dates";

export function DateRangePickerWithPresets({
  className,
  date,
  onDateChange,
}: {
  className?: string;
  date?: DateRange;
  onDateChange?: (date: DateRange | undefined) => void;
}) {
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(date);

  useEffect(() => {
    setDraftRange(date);
  }, [date]);

  const presets = [
    {
      label: "Current month",
      getValue: () => plainDateRangeToDateRange(getCurrentMonth()),
    },
    {
      label: "Last month",
      getValue: () => plainDateRangeToDateRange(getLastMonth()),
    },
    {
      label: "Last 3 months",
      getValue: () => plainDateRangeToDateRange(getLastNMonths(3)),
    },
    {
      label: "Last 6 months",
      getValue: () => plainDateRangeToDateRange(getLastNMonths(6)),
    },
    {
      label: "Last 12 months",
      getValue: () => plainDateRangeToDateRange(getLastNMonths(12)),
    },
  ];

  const applyRange = (newRange: DateRange | undefined) => {
    setDraftRange(newRange);

    if (newRange?.from && newRange?.to) {
      onDateChange?.(newRange);
    }
  };

  const handleCalendarSelect: SelectRangeEventHandler = (
    newRange,
    selectedDay
  ) => {
    if (draftRange?.from && draftRange?.to && selectedDay) {
      setDraftRange({ from: selectedDay, to: undefined });
      return;
    }

    applyRange(newRange);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              "w-[260px] justify-start text-left font-normal",
              !draftRange && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {draftRange?.from ? (
              draftRange.to ? (
                <>
                  {format(draftRange.from, "LLL dd, y")} -{" "}
                  {format(draftRange.to, "LLL dd, y")}
                </>
              ) : (
                format(draftRange.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="flex w-auto flex-col space-y-2 p-2"
          align="start"
        >
          <Select
            onValueChange={(value) => {
              const preset = presets.find((p) => p.label === value);
              if (preset) {
                applyRange(preset.getValue());
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a preset" />
            </SelectTrigger>
            <SelectContent position="popper">
              {presets.map((preset) => (
                <SelectItem key={preset.label} value={preset.label}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="rounded-md border">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={draftRange?.from ?? date?.from}
              selected={draftRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
