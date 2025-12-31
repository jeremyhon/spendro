import type { DateRange } from "react-day-picker";
import { Temporal } from "temporal-polyfill";

/**
 * Converts a YYYY-MM-DD string to a Temporal.PlainDate
 * Returns null if the string is invalid
 */
export function plainDateFromString(
  dateStr: string
): Temporal.PlainDate | null {
  try {
    const normalized = dateStr.trim();
    const baseDate =
      normalized.split("T")[0]?.split(" ")[0]?.trim() ?? normalized;

    // Validate format YYYY-MM-DD with strict regex
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(baseDate)) return null;

    const parts = baseDate.split("-");
    if (parts.length !== 3) return null;

    const [year, month, day] = parts.map(Number);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day))
      return null;

    // Additional validation for realistic ranges
    if (year < 1000 || year > 9999) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const result = Temporal.PlainDate.from({ year, month, day });

    // Verify the date components match what we parsed (catches invalid dates like Feb 30)
    if (result.year !== year || result.month !== month || result.day !== day) {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Converts a Temporal.PlainDate to YYYY-MM-DD string format
 */
export function plainDateToString(date: Temporal.PlainDate): string {
  return date.toString(); // PlainDate.toString() returns YYYY-MM-DD format
}

/**
 * Normalizes a date-like string into YYYY-MM-DD when possible.
 * Falls back to the original string if parsing fails.
 */
export function normalizeDateString(dateStr: string): string {
  const parsed = plainDateFromString(dateStr);
  return parsed ? parsed.toString() : dateStr;
}

/**
 * Creates a date range from two YYYY-MM-DD strings
 * Returns null if either date is invalid or from > to
 */
export function createDateRange(
  from: string,
  to: string
): { from: Temporal.PlainDate; to: Temporal.PlainDate } | null {
  const fromDate = plainDateFromString(from);
  const toDate = plainDateFromString(to);

  if (!fromDate || !toDate) return null;

  // Ensure from <= to
  if (Temporal.PlainDate.compare(fromDate, toDate) > 0) return null;

  return { from: fromDate, to: toDate };
}

/**
 * Converts a PlainDate range to URL parameter format
 */
export function dateRangeToUrlParams(range: {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}): { from: string; to: string } {
  return {
    from: plainDateToString(range.from),
    to: plainDateToString(range.to),
  };
}

/**
 * Counts the number of complete months in a date range
 * Uses the start of each month as the counting unit
 */
export function countMonthsInRange(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate
): number {
  // Get start of months for both dates
  const startMonth = from.with({ day: 1 });
  const endMonth = to.with({ day: 1 });

  let current = startMonth;
  let count = 0;

  // Count months from start to end (inclusive)
  while (Temporal.PlainDate.compare(current, endMonth) <= 0) {
    count++;
    current = current.add({ months: 1 });
  }

  return count;
}

/**
 * Gets a consistent month key for grouping (YYYY-MM format)
 */
export function getMonthKey(date: Temporal.PlainDate): string {
  return `${date.year}-${date.month.toString().padStart(2, "0")}`;
}

/**
 * Gets a display-friendly month key (e.g., "Jan 2025")
 */
export function getDisplayMonthKey(date: Temporal.PlainDate): string {
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[date.month - 1]} ${date.year}`;
}

/**
 * Gets the current month as a date range (1st to last day of month)
 */
export function getCurrentMonth(): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} {
  const today = Temporal.Now.plainDateISO();
  const firstOfMonth = today.with({ day: 1 });
  const lastOfMonth = firstOfMonth.add({ months: 1 }).subtract({ days: 1 });

  return { from: firstOfMonth, to: lastOfMonth };
}

/**
 * Gets the previous month as a date range
 */
export function getLastMonth(): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} {
  const today = Temporal.Now.plainDateISO();
  const firstOfThisMonth = today.with({ day: 1 });
  const firstOfLastMonth = firstOfThisMonth.subtract({ months: 1 });
  const lastOfLastMonth = firstOfThisMonth.subtract({ days: 1 });

  return { from: firstOfLastMonth, to: lastOfLastMonth };
}

/**
 * Gets the last N complete months as a date range
 * Does not include the current month
 */
export function getLastNMonths(n: number): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} {
  const today = Temporal.Now.plainDateISO();
  const firstOfThisMonth = today.with({ day: 1 });

  // Go back n months from the start of this month
  const firstOfRangeMonth = firstOfThisMonth.subtract({ months: n });
  // End at the last day of the previous month
  const lastOfRangeMonth = firstOfThisMonth.subtract({ days: 1 });

  return { from: firstOfRangeMonth, to: lastOfRangeMonth };
}

// Legacy conversion utilities for gradual migration

/**
 * Converts a Temporal.PlainDate to a JavaScript Date
 * Uses local timezone
 */
export function plainDateToDate(plainDate: Temporal.PlainDate): Date {
  return new Date(plainDate.year, plainDate.month - 1, plainDate.day);
}

/**
 * Converts a JavaScript Date to a Temporal.PlainDate
 * Uses the date components in local timezone
 */
export function dateToPlainDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/**
 * Converts a React DayPicker DateRange to PlainDate range
 * Returns null if either date is undefined
 */
export function dateRangeToPlainDateRange(range: DateRange): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} | null {
  if (!range.from || !range.to) return null;

  return {
    from: dateToPlainDate(range.from),
    to: dateToPlainDate(range.to),
  };
}

/**
 * Converts a PlainDate range to React DayPicker DateRange
 */
export function plainDateRangeToDateRange(range: {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}): DateRange {
  return {
    from: plainDateToDate(range.from),
    to: plainDateToDate(range.to),
  };
}
