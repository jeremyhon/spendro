"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { getExpenses } from "@/app/actions/expense";
import type { DisplayExpenseWithDuplicate } from "@/lib/types/expense";
import {
  createDateRange,
  plainDateFromString,
} from "@/lib/utils/temporal-dates";

export interface ExpenseFilters {
  dateRange?: {
    start: string;
    end: string;
  };
  categories?: string[];
  merchants?: string[];
  amountRange?: {
    min: number;
    max: number;
  };
  searchText?: string;
  showColumns?: string[];
  sortBy?: "date" | "amount" | "merchant";
  sortDirection?: "asc" | "desc";
}

export interface UseExpensesOptions {
  filters?: ExpenseFilters;
  autoSubscribe?: boolean;
  monthsBack?: number;
}

interface UseExpensesReturn {
  expenses: DisplayExpenseWithDuplicate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  totalCount: number;
  filteredCount: number;
}

export function useExpenses(
  options: UseExpensesOptions = {}
): UseExpensesReturn {
  const { filters, autoSubscribe = true, monthsBack = 6 } = options;

  const [expenses, setExpenses] = useState<DisplayExpenseWithDuplicate[]>([]);
  const [loading, setLoading] = useState(autoSubscribe);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getExpenses();
      if (result.error) {
        setError(result.error);
        setExpenses([]);
        return;
      }

      setExpenses(result.expenses || []);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch expenses";
      setError(message);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoSubscribe) {
      setLoading(false);
      return;
    }

    void fetchExpenses();
  }, [autoSubscribe, fetchExpenses]);

  const defaultDateRange = useMemo(() => {
    const end = Temporal.Now.plainDateISO();
    const start = end.subtract({ months: monthsBack });
    return { from: start, to: end };
  }, [monthsBack]);

  const dateRange = useMemo(() => {
    if (filters?.dateRange?.start && filters?.dateRange?.end) {
      const parsed = createDateRange(
        filters.dateRange.start,
        filters.dateRange.end
      );
      if (parsed) {
        return parsed;
      }
    }

    return defaultDateRange;
  }, [defaultDateRange, filters?.dateRange?.end, filters?.dateRange?.start]);

  const baseFilteredRows = useMemo(() => {
    return expenses.filter((expense) => {
      if (dateRange) {
        const expenseDate = plainDateFromString(expense.date);
        if (!expenseDate) return false;

        if (
          Temporal.PlainDate.compare(expenseDate, dateRange.from) < 0 ||
          Temporal.PlainDate.compare(expenseDate, dateRange.to) > 0
        ) {
          return false;
        }
      }

      if (filters?.categories?.length) {
        if (!filters.categories.includes(expense.category)) {
          return false;
        }
      }

      if (filters?.merchants?.length) {
        if (!filters.merchants.includes(expense.merchant || "")) {
          return false;
        }
      }

      if (filters?.amountRange) {
        if (
          expense.amount < filters.amountRange.min ||
          expense.amount > filters.amountRange.max
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    dateRange,
    expenses,
    filters?.amountRange?.max,
    filters?.amountRange?.min,
    filters?.amountRange,
    filters?.categories,
    filters?.merchants,
  ]);

  const sortedExpenses = useMemo(() => {
    const sortBy = filters?.sortBy ?? "date";
    const sortDirection = filters?.sortDirection ?? "desc";
    const direction = sortDirection === "asc" ? 1 : -1;

    return [...baseFilteredRows].sort((a, b) => {
      if (sortBy === "amount") {
        return (a.amount - b.amount) * direction;
      }
      if (sortBy === "merchant") {
        return a.merchant.localeCompare(b.merchant) * direction;
      }
      const aDate = plainDateFromString(a.date);
      const bDate = plainDateFromString(b.date);
      if (aDate && bDate) {
        return Temporal.PlainDate.compare(aDate, bDate) * direction;
      }
      return (
        (new Date(a.date).getTime() - new Date(b.date).getTime()) * direction
      );
    });
  }, [baseFilteredRows, filters?.sortBy, filters?.sortDirection]);

  const filteredExpenses = useMemo(() => {
    const searchText = filters?.searchText?.trim();
    if (!searchText) return sortedExpenses;

    const searchLower = searchText.toLowerCase();
    return sortedExpenses.filter((expense) => {
      const description = expense.description.toLowerCase();
      const merchant = expense.merchant.toLowerCase();
      const category = expense.category.toLowerCase();
      return (
        description.includes(searchLower) ||
        merchant.includes(searchLower) ||
        category.includes(searchLower)
      );
    });
  }, [filters?.searchText, sortedExpenses]);

  const refetch = useCallback(() => {
    void fetchExpenses();
  }, [fetchExpenses]);

  return {
    expenses: filteredExpenses,
    loading,
    error,
    refetch,
    totalCount: baseFilteredRows.length,
    filteredCount: filteredExpenses.length,
  };
}

export function useFilteredExpenses(filters: ExpenseFilters) {
  return useExpenses({
    filters,
    autoSubscribe: true,
  });
}

export function useRecentExpenses(monthsBack = 3) {
  return useExpenses({
    monthsBack,
    autoSubscribe: true,
  });
}
