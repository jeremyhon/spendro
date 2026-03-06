"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { DateRange } from "react-day-picker";
import {
  createDateRange,
  dateToPlainDate,
  getLastNMonths,
  plainDateRangeToDateRange,
} from "@/lib/utils/temporal-dates";
import { ExpenseCategoryChart } from "./expense-category-chart";
import { ExpenseHeadlineNumbers } from "./expense-headline-numbers";
import { OverviewControls } from "./overview-controls";

const getDefaultDateRange = (): DateRange => {
  const plainDateRange = getLastNMonths(3);
  return plainDateRangeToDateRange(plainDateRange);
};

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dateRange = useMemo((): DateRange | undefined => {
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    if (fromParam && toParam) {
      const plainDateRange = createDateRange(fromParam, toParam);

      if (plainDateRange) {
        return plainDateRangeToDateRange(plainDateRange);
      }
    }

    return getDefaultDateRange();
  }, [searchParams]);

  const handleDateRangeChange = useCallback(
    (newDateRange: DateRange | undefined) => {
      const params = new URLSearchParams(searchParams.toString());

      if (newDateRange?.from && newDateRange?.to) {
        const fromPlainDate = dateToPlainDate(newDateRange.from);
        const toPlainDate = dateToPlainDate(newDateRange.to);

        params.set("from", fromPlainDate.toString());
        params.set("to", toPlainDate.toString());
      } else {
        params.delete("from");
        params.delete("to");
      }

      router.push(`/?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col">
      <OverviewControls
        dateRange={dateRange}
        onDateRangeChange={handleDateRangeChange}
      />

      <div className="px-4 sm:px-6 space-y-4 py-4">
        <ExpenseHeadlineNumbers dateRange={dateRange} />
        <ExpenseCategoryChart dateRange={dateRange} />
      </div>
    </div>
  );
}
