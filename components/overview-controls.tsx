"use client";

import type { DateRange } from "react-day-picker";
import { DateRangePickerWithPresets } from "./date-range-picker-with-presets";

interface OverviewControlsProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}

export function OverviewControls({
  dateRange,
  onDateRangeChange,
}: OverviewControlsProps) {
  return (
    <div className="flex flex-col gap-4 p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <DateRangePickerWithPresets
            date={dateRange}
            onDateChange={onDateRangeChange}
            className="flex-shrink-0"
          />
        </div>
      </div>
    </div>
  );
}
