"use server";

import { revalidatePath } from "next/cache";
import {
  deleteLocalExpense,
  deleteLocalExpenses,
  listLocalDisplayExpenses,
  listLocalExpenseFacts,
  updateLocalExpense,
} from "@/lib/local/web-adapter";
import type {
  DisplayExpenseWithDuplicate,
  ExpenseUpdateData,
} from "@/lib/types/expense";
import {
  countMonthsInRange,
  dateToPlainDate,
  getDisplayMonthKey,
  plainDateFromString,
} from "@/lib/utils/temporal-dates";

export async function getExpenses(): Promise<{
  expenses?: DisplayExpenseWithDuplicate[];
  error?: string;
}> {
  return { expenses: listLocalDisplayExpenses() };
}

export async function updateExpense(
  expenseId: string,
  data: ExpenseUpdateData
): Promise<{ success?: boolean; error?: string }> {
  try {
    updateLocalExpense(expenseId, data);
    revalidatePath("/");
    revalidatePath("/expenses");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update expense";
    return { error: message };
  }
}

export async function updateExpenseWithBulkMerchantUpdate(
  expenseId: string,
  data: ExpenseUpdateData,
  _applyToAllMerchantExpenses = false
): Promise<{ success?: boolean; error?: string; updatedCount?: number }> {
  const result = await updateExpense(expenseId, data);
  if (!result.success) {
    return { error: result.error || "Failed to update expense" };
  }

  return { success: true, updatedCount: 1 };
}

export async function deleteExpense(
  expenseId: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    deleteLocalExpense(expenseId);
    revalidatePath("/");
    revalidatePath("/expenses");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete expense";
    return { error: message };
  }
}

export async function bulkDeleteExpenses(
  expenseIds: string[]
): Promise<{ success?: boolean; error?: string; deletedCount?: number }> {
  if (!expenseIds || expenseIds.length === 0) {
    return { error: "No expenses selected for deletion" };
  }

  try {
    const deletedCount = deleteLocalExpenses(expenseIds);
    revalidatePath("/");
    revalidatePath("/expenses");
    return { success: true, deletedCount };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete expenses";
    return { error: message };
  }
}

export async function getMonthlyExpensesByCategory(dateRange?: {
  from: Date;
  to: Date;
}): Promise<{
  data?: Array<{ month: string; [category: string]: string | number }>;
  error?: string;
}> {
  const facts = listLocalExpenseFacts(
    dateRange?.from && dateRange?.to
      ? {
          from: dateToPlainDate(dateRange.from).toString(),
          to: dateToPlainDate(dateRange.to).toString(),
        }
      : undefined
  );

  const monthlyData = new Map<string, Map<string, number>>();
  const allCategories = new Set<string>();

  for (const expense of facts) {
    const date = plainDateFromString(expense.date);
    if (!date) continue;

    const monthKey = getDisplayMonthKey(date);
    allCategories.add(expense.category);

    if (!monthlyData.has(monthKey)) {
      monthlyData.set(monthKey, new Map());
    }

    const monthMap = monthlyData.get(monthKey);
    if (!monthMap) continue;

    const currentAmount = monthMap.get(expense.category) || 0;
    monthMap.set(expense.category, currentAmount + Number(expense.amount));
  }

  const chartData = Array.from(monthlyData.entries()).map(
    ([month, categories]) => {
      const dataPoint: { month: string; [key: string]: string | number } = {
        month,
      };
      let total = 0;

      allCategories.forEach((category) => {
        const amount = categories.get(category) || 0;
        dataPoint[category] = amount;
        total += amount;
      });

      dataPoint.Total = total;
      return dataPoint;
    }
  );

  return { data: chartData };
}

export async function getExpenseHeadlineNumbers(dateRange?: {
  from: Date;
  to: Date;
}): Promise<{
  data?: {
    categoryTotals: Record<string, number>;
    categoryAverages: Record<string, number>;
    totalSpending: number;
    averageSpending: number;
    monthCount: number;
  };
  error?: string;
}> {
  const facts = listLocalExpenseFacts(
    dateRange?.from && dateRange?.to
      ? {
          from: dateToPlainDate(dateRange.from).toString(),
          to: dateToPlainDate(dateRange.to).toString(),
        }
      : undefined
  );

  if (!facts.length) {
    return {
      data: {
        categoryTotals: {},
        categoryAverages: {},
        totalSpending: 0,
        averageSpending: 0,
        monthCount: 0,
      },
    };
  }

  const categoryTotals: Record<string, number> = {};
  let totalSpending = 0;
  const monthsSet = new Set<string>();

  for (const expense of facts) {
    const date = plainDateFromString(expense.date);
    if (!date) continue;

    const monthKey = `${date.year}-${date.month}`;
    monthsSet.add(monthKey);

    categoryTotals[expense.category] =
      (categoryTotals[expense.category] || 0) + Number(expense.amount);
    totalSpending += Number(expense.amount);
  }

  let monthCount: number;
  if (dateRange?.from && dateRange?.to) {
    monthCount = countMonthsInRange(
      dateToPlainDate(dateRange.from),
      dateToPlainDate(dateRange.to)
    );
  } else {
    monthCount = monthsSet.size || 1;
  }

  const categoryAverages: Record<string, number> = {};
  Object.keys(categoryTotals).forEach((category) => {
    categoryAverages[category] = categoryTotals[category] / monthCount;
  });

  const averageSpending = totalSpending / monthCount;

  return {
    data: {
      categoryTotals,
      categoryAverages,
      totalSpending,
      averageSpending,
      monthCount,
    },
  };
}
