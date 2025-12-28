"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { bulkDeleteExpenses, updateExpense } from "@/app/actions/expense";
import { DateRangePickerWithPresets } from "@/components/date-range-picker-with-presets";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ExpenseFilters,
  useElectricExpenses,
} from "@/hooks/use-electric-expenses";
import type { DisplayExpenseWithDuplicate } from "@/lib/types/expense";
import {
  createDateRange,
  dateToPlainDate,
  getLastNMonths,
  plainDateRangeToDateRange,
} from "@/lib/utils/temporal-dates";
import { EditExpenseDialog } from "./edit-expense-dialog";
import { ExpensesTableVirtualized } from "./expenses-table-virtualized";

// Get default date range (last 3 complete months)
const getDefaultDateRange = (): DateRange => {
  const plainDateRange = getLastNMonths(3);
  return plainDateRangeToDateRange(plainDateRange);
};

export function ExpensesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editingExpense, setEditingExpense] =
    useState<DisplayExpenseWithDuplicate | null>(null);
  const [filters, setFilters] = useState<ExpenseFilters>({});

  // Parse date range from URL params or use default
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

  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      const fromPlainDate = dateToPlainDate(dateRange.from);
      const toPlainDate = dateToPlainDate(dateRange.to);

      setFilters((prev) => ({
        ...prev,
        dateRange: {
          start: fromPlainDate.toString(),
          end: toPlainDate.toString(),
        },
      }));
      return;
    }

    setFilters((prev) => {
      if (!prev.dateRange) {
        return prev;
      }

      const nextFilters = { ...prev };
      delete nextFilters.dateRange;
      return nextFilters;
    });
  }, [dateRange]);

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

      router.push(`/expenses?${params.toString()}`);
    },
    [router, searchParams]
  );

  const { expenses, loading, error } = useElectricExpenses({
    filters,
    autoSubscribe: true,
    monthsBack: 6,
  });

  const handleEdit = (expense: DisplayExpenseWithDuplicate) => {
    setEditingExpense(expense);
  };

  const handleBulkDelete = async (expenseIds: string[]) => {
    try {
      const result = await bulkDeleteExpenses(expenseIds);
      if (result.success) {
        toast.success(
          `Successfully deleted ${result.deletedCount} expense${result.deletedCount === 1 ? "" : "s"}`
        );
      } else {
        toast.error(result.error || "Failed to delete expenses");
      }
    } catch (error) {
      console.error("Error deleting expenses:", error);
      toast.error("Failed to delete expenses");
    }
  };

  const handleUpdateExpense = async (data: {
    description: string;
    merchant: string;
    category: string;
    amount: number;
    originalAmount: number;
    originalCurrency: string;
    date: string;
  }) => {
    if (!editingExpense) return { error: "No expense selected" };

    try {
      const result = await updateExpense(editingExpense.id, data);
      if (result.success) {
        setEditingExpense(null);
        toast.success("Expense updated successfully");
      } else {
        toast.error(result.error || "Failed to update expense");
      }
      return result;
    } catch (error) {
      console.error("Error updating expense:", error);
      const errorMessage = "Failed to update expense";
      toast.error(errorMessage);
      return { error: errorMessage };
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600">Error loading expenses: {error}</p>
          <Button onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex-shrink-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>
                Manage your expenses with advanced filtering, selection, and
                real-time sync.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              )}
              <DateRangePickerWithPresets
                date={dateRange}
                onDateChange={handleDateRangeChange}
                className="flex-shrink-0"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col overflow-hidden">
          <ExpensesTableVirtualized
            expenses={expenses}
            onEdit={handleEdit}
            onBulkDelete={handleBulkDelete}
            filters={filters}
            onFiltersChange={setFilters}
            loading={loading}
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {editingExpense && (
        <EditExpenseDialog
          expense={editingExpense}
          onSave={handleUpdateExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
