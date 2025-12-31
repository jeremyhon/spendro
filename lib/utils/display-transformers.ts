import type {
  DatabaseExpenseRow,
  DisplayExpense,
  DisplayExpenseWithDuplicate,
} from "@/lib/types/expense";
import { normalizeDateString } from "@/lib/utils/temporal-dates";

/**
 * Transform a database expense row to display format
 * This handles the snake_case to camelCase conversion and field mapping
 */
export function transformDatabaseToDisplay(
  dbExpense: DatabaseExpenseRow,
  isDuplicate?: boolean
): DisplayExpenseWithDuplicate;
export function transformDatabaseToDisplay(
  dbExpense: Partial<DatabaseExpenseRow> & { id: string },
  isDuplicate?: boolean
): Partial<DisplayExpenseWithDuplicate> & { id: string };
export function transformDatabaseToDisplay(
  dbExpense: Partial<DatabaseExpenseRow> & { id: string },
  isDuplicate = false
): Partial<DisplayExpenseWithDuplicate> & { id: string } {
  const result: Partial<DisplayExpenseWithDuplicate> & { id: string } = {
    id: dbExpense.id,
    isDuplicate,
  };

  if (dbExpense.date) result.date = normalizeDateString(dbExpense.date);
  if (dbExpense.description) result.description = dbExpense.description;
  if (dbExpense.merchant !== undefined)
    result.merchant = dbExpense.merchant || "";
  if (dbExpense.category) result.category = dbExpense.category;
  if (dbExpense.amount_sgd !== undefined) result.amount = dbExpense.amount_sgd;
  if (
    dbExpense.original_amount !== undefined ||
    dbExpense.amount_sgd !== undefined
  ) {
    result.originalAmount =
      dbExpense.original_amount || dbExpense.amount_sgd || 0;
  }
  if (dbExpense.original_currency || dbExpense.currency) {
    result.originalCurrency =
      dbExpense.original_currency || dbExpense.currency || "";
  }
  if (dbExpense.currency) result.currency = dbExpense.currency;
  if (dbExpense.created_at) result.createdAt = dbExpense.created_at;

  return result;
}

/**
 * Transform multiple database expense rows to display format with duplicate checking
 */
export function transformDatabaseRowsToDisplay(
  dbExpenses: DatabaseExpenseRow[]
): DisplayExpenseWithDuplicate[] {
  const lineHashes = new Set<string>();

  return dbExpenses.map((expense) => {
    const isDuplicate = lineHashes.has(expense.line_hash);
    lineHashes.add(expense.line_hash);
    return transformDatabaseToDisplay(expense, isDuplicate);
  });
}

/**
 * Add or update duplicate flags on an array of display expenses
 * Uses date + merchant + amount for duplicate detection (excludes description)
 * Note: This may differ from database-level duplicate detection which uses line_hash
 */
export function recalculateDuplicates(
  expenses: DisplayExpense[]
): DisplayExpenseWithDuplicate[] {
  // Use date + merchant + amount for duplicate detection
  const seenCombinations = new Set<string>();

  return expenses.map((expense) => {
    // Create a combination key using date, merchant, and amount (NOT description)
    const normalizedMerchant = expense.merchant.toLowerCase().trim();
    const combination = `${expense.date}-${normalizedMerchant}-${expense.amount}`;

    const isDuplicate = seenCombinations.has(combination);
    seenCombinations.add(combination);

    return {
      ...expense,
      isDuplicate,
    };
  });
}

/**
 * Update a single expense in an array while recalculating duplicates
 */
export function updateExpenseInArray(
  expenses: DisplayExpenseWithDuplicate[],
  updatedExpense: Partial<DisplayExpenseWithDuplicate> & { id: string }
): DisplayExpenseWithDuplicate[] {
  const updated = expenses.map((exp) =>
    exp.id === updatedExpense.id ? { ...exp, ...updatedExpense } : exp
  );

  // Recalculate duplicates after the update
  return recalculateDuplicates(updated);
}

/**
 * Add a new expense to the array while recalculating duplicates
 */
export function addExpenseToArray(
  expenses: DisplayExpenseWithDuplicate[],
  newExpense: DisplayExpense
): DisplayExpenseWithDuplicate[] {
  const allExpenses = [newExpense, ...expenses];
  return recalculateDuplicates(allExpenses);
}

/**
 * Remove an expense from the array while recalculating duplicates
 */
export function removeExpenseFromArray(
  expenses: DisplayExpenseWithDuplicate[],
  expenseId: string
): DisplayExpenseWithDuplicate[] {
  const filtered = expenses.filter((exp) => exp.id !== expenseId);
  return recalculateDuplicates(filtered);
}
