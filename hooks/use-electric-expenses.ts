"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { electricClient } from "@/lib/electric/client";
import { shapeFactory } from "@/lib/electric/shapes";
import type {
  DatabaseExpenseRow,
  DisplayExpenseWithDuplicate,
} from "@/lib/types/expense";
import { transformDatabaseRowsToDisplay } from "@/lib/utils/display-transformers";

// Schema for ElectricSQL expense data
const electricExpenseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  statement_id: z.string().uuid(),
  created_at: z.string(),
  date: z.string(),
  description: z.string(),
  amount_sgd: z.string().transform((val) => Number.parseFloat(val)), // Electric SQL returns as string
  currency: z.string(),
  foreign_amount: z
    .string()
    .nullable()
    .transform((val) => (val ? Number.parseFloat(val) : null)),
  foreign_currency: z.string().nullable(),
  original_amount: z
    .string()
    .nullable()
    .transform((val) => (val ? Number.parseFloat(val) : null)),
  original_currency: z.string().nullable(),
  merchant: z.string().nullable(),
  category: z.string(),
  line_hash: z.string(),
});

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

export interface UseElectricExpensesOptions {
  filters?: ExpenseFilters;
  autoSubscribe?: boolean;
  monthsBack?: number;
}

interface UseElectricExpensesReturn {
  expenses: DisplayExpenseWithDuplicate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  totalCount: number;
  filteredCount: number;
}

/**
 * Hook for managing expenses with ElectricSQL real-time sync
 * Syncs a filtered expense shape based on the active filters
 */
export function useElectricExpenses(
  options: UseElectricExpensesOptions = {}
): UseElectricExpensesReturn {
  const { filters, autoSubscribe = true, monthsBack = 6 } = options;
  const { user, loading: authLoading } = useAuth();

  const [expenses, setExpenses] = useState<DisplayExpenseWithDuplicate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateRange = useMemo(() => {
    if (filters?.dateRange?.start && filters?.dateRange?.end) {
      return filters.dateRange;
    }

    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - monthsBack);

    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }, [
    filters?.dateRange?.start,
    filters?.dateRange?.end,
    monthsBack,
    filters?.dateRange,
  ]);

  const shapeParams = useMemo(() => {
    const categories = filters?.categories?.length
      ? [...filters.categories].sort()
      : undefined;
    const merchants = filters?.merchants?.length
      ? [...filters.merchants].sort()
      : undefined;
    const amountRange = filters?.amountRange;

    return shapeFactory.createExpenseShape({
      dateRange,
      categories,
      merchants,
      amountRange,
    });
  }, [
    dateRange,
    filters?.categories,
    filters?.merchants,
    filters?.amountRange?.min,
    filters?.amountRange?.max,
    filters?.amountRange,
  ]);

  const sortedExpenses = useMemo(() => {
    return [...expenses].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [expenses]);

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

  // Transform Electric data to display format
  const transformElectricToDisplay = useCallback(
    (rows: Record<string, unknown>[]) => {
      try {
        const validatedRows = rows
          .map((row) => {
            try {
              return electricExpenseSchema.parse(row);
            } catch {
              console.warn("Invalid expense row:", row);
              return null;
            }
          })
          .filter((row): row is DatabaseExpenseRow => row !== null);

        return transformDatabaseRowsToDisplay(validatedRows);
      } catch (err) {
        console.error("Error transforming electric data:", err);
        return [];
      }
    },
    []
  );

  // Setup expenses subscription
  const setupExpensesSync = useCallback(() => {
    if (!user?.id) return () => {};

    setLoading(true);
    setError(null);

    try {
      const shape = electricClient.createShape(shapeParams);

      const unsubscribe = shape.subscribe(({ rows }) => {
        try {
          const displayExpenses = transformElectricToDisplay(rows);
          setExpenses(displayExpenses);
          setError(null);
        } catch (err) {
          console.error("Error processing expenses:", err);
          setError("Failed to process expenses data");
        } finally {
          setLoading(false);
        }
      });

      return unsubscribe;
    } catch (err) {
      console.error("Error setting up expenses sync:", err);
      setError("Failed to connect to expenses updates");
      setLoading(false);
      return () => {};
    }
  }, [user?.id, shapeParams, transformElectricToDisplay]);

  // Refetch function
  const refetch = useCallback(() => {
    if (!user?.id) return;

    setError(null);
    setLoading(true);
  }, [user?.id]);

  // Setup subscriptions on mount and auth changes
  useEffect(() => {
    if (authLoading) return;

    if (!user?.id) {
      setExpenses([]);
      setLoading(false);
      setError("User not authenticated");
      return;
    }

    if (!autoSubscribe) {
      setLoading(false);
      return;
    }

    const unsubscribe = setupExpensesSync();

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [user?.id, authLoading, autoSubscribe, setupExpensesSync]);

  return {
    expenses: filteredExpenses,
    loading: authLoading || loading,
    error,
    refetch,
    totalCount: sortedExpenses.length,
    filteredCount: filteredExpenses.length,
  };
}

/**
 * Hook for loading expenses with specific filters
 * Useful for filtered views or search results
 */
export function useFilteredElectricExpenses(filters: ExpenseFilters) {
  return useElectricExpenses({
    filters,
    autoSubscribe: true,
  });
}

/**
 * Hook for loading recent expenses only
 * Optimized for dashboard and quick views
 */
export function useRecentElectricExpenses(monthsBack = 3) {
  return useElectricExpenses({
    autoSubscribe: true,
    monthsBack,
  });
}
