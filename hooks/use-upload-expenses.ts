"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateExpense } from "@/app/actions/expense";
import { pocketbase } from "@/lib/pocketbase/client";
import type {
  DatabaseExpenseRow,
  DisplayExpenseWithDuplicate,
  ExpenseUpdateData,
} from "@/lib/types/expense";
import {
  addExpenseToArray,
  removeExpenseFromArray,
  transformDatabaseToDisplay,
  updateExpenseInArray,
} from "@/lib/utils/display-transformers";

/**
 * Hook for managing expenses during upload sessions
 * Tracks expenses by statement_id with real-time updates
 */
export function useUploadExpenses(statementIds: string[]) {
  const [expenses, setExpenses] = useState<DisplayExpenseWithDuplicate[]>([]);

  // Create a stable key for the subscription
  const subscriptionKey = useMemo(() => statementIds.join(","), [statementIds]);

  useEffect(() => {
    if (statementIds.length === 0) {
      setExpenses([]);
    }
  }, [statementIds]);

  // Set up realtime subscription for specific statement IDs
  useEffect(() => {
    if (!subscriptionKey || statementIds.length === 0) return;
    if (!pocketbase.authStore.isValid) return;

    setExpenses([]);

    // First, fetch any existing expenses for these statement IDs
    const fetchExistingExpenses = async () => {
      try {
        const filters = statementIds
          .map((id) => `statement_id = "${id}"`)
          .join(" || ");
        const data = await pocketbase.collection("expenses").getFullList({
          filter: filters,
          sort: "-date",
        });

        if (data && data.length > 0) {
          const displayExpenses = data.map((expense) =>
            transformDatabaseToDisplay(expense as unknown as DatabaseExpenseRow)
          );
          setExpenses(displayExpenses as DisplayExpenseWithDuplicate[]);
        }
      } catch (error) {
        console.error("Error fetching expenses:", error);
      }
    };

    fetchExistingExpenses();

    let unsubscribe: (() => void) | null = null;

    pocketbase
      .collection("expenses")
      .subscribe("*", (event) => {
        const record = event.record;
        const statementId = Array.isArray(record.statement_id)
          ? record.statement_id[0]
          : record.statement_id;

        if (!statementId || !statementIds.includes(statementId)) {
          return;
        }

        switch (event.action) {
          case "create": {
            const displayExpense = transformDatabaseToDisplay(
              record as unknown as DatabaseExpenseRow
            );
            setExpenses((prev) => addExpenseToArray(prev, displayExpense));
            break;
          }
          case "update": {
            const updatedFields = transformDatabaseToDisplay(
              record as unknown as DatabaseExpenseRow
            );
            setExpenses((prev) => updateExpenseInArray(prev, updatedFields));
            break;
          }
          case "delete": {
            setExpenses((prev) => removeExpenseFromArray(prev, record.id));
            break;
          }
        }
      })
      .then((handler) => {
        unsubscribe = handler;
      })
      .catch((error) => {
        console.error("Error subscribing to expenses:", error);
      });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      } else {
        pocketbase.collection("expenses").unsubscribe("*");
      }
    };
  }, [subscriptionKey, statementIds]);

  // Update expense function
  const handleUpdateExpense = async (
    expenseId: string,
    data: ExpenseUpdateData
  ) => {
    try {
      const result = await updateExpense(expenseId, data);

      if (result.error) {
        toast.error("Failed to update expense", {
          description: result.error,
        });
        return { error: result.error };
      }

      toast.success("Expense updated successfully");
      return { success: true };
    } catch (_err) {
      const errorMessage = "Failed to update expense";
      toast.error(errorMessage, {
        description: "An unexpected error occurred",
      });
      return { error: errorMessage };
    }
  };

  // Get expenses for a specific statement
  const getExpensesForStatement = (_statementId: string) => {
    return expenses.filter(
      (_expense) =>
        // We need to check the statement relationship
        // For now, we'll return all expenses since we're filtering by statement_id in the subscription
        true
    );
  };

  return {
    expenses,
    updateExpense: handleUpdateExpense,
    getExpensesForStatement,
    expenseCount: expenses.length,
  };
}
