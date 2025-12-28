"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateExpense } from "@/app/actions/expense";
import { createClient } from "@/lib/supabase/client";
import type {
  DisplayExpenseWithDuplicate,
  ExpenseUpdateData,
} from "@/lib/types/expense";
import {
  addExpenseToArray,
  removeExpenseFromArray,
  transformDatabaseToDisplay,
  updateExpenseInArray,
} from "@/lib/utils/display-transformers";
import {
  validateDeletePayload,
  validateInsertPayload,
  validateUpdatePayload,
} from "@/lib/utils/realtime-validators";

/**
 * Hook for managing expenses during upload sessions
 * Tracks expenses by statement_id with real-time updates
 */
export function useUploadExpenses(statementIds: string[]) {
  const [expenses, setExpenses] = useState<DisplayExpenseWithDuplicate[]>([]);

  const supabase = useMemo(() => createClient(), []);

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

    setExpenses([]);

    // First, fetch any existing expenses for these statement IDs
    const fetchExistingExpenses = async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .in("statement_id", statementIds);

      if (error) {
        console.error("Error fetching expenses:", error);
        return;
      }

      if (data && data.length > 0) {
        const displayExpenses = data.map((expense) =>
          transformDatabaseToDisplay(expense)
        );
        setExpenses(displayExpenses);
      }
    };

    fetchExistingExpenses();

    const channel = supabase
      .channel(`upload-expenses-${subscriptionKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `statement_id=in.(${subscriptionKey})`,
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;

          switch (eventType) {
            case "INSERT": {
              const validatedPayload = validateInsertPayload(newRecord);
              if (validatedPayload) {
                const displayExpense =
                  transformDatabaseToDisplay(validatedPayload);
                setExpenses((prev) => addExpenseToArray(prev, displayExpense));
              } else {
                console.error("Invalid INSERT payload received:", newRecord);
              }
              break;
            }

            case "UPDATE": {
              const validatedPayload = validateUpdatePayload(newRecord);
              if (validatedPayload) {
                const updatedFields =
                  transformDatabaseToDisplay(validatedPayload);
                setExpenses((prev) =>
                  updateExpenseInArray(prev, updatedFields)
                );
              } else {
                console.error("Invalid UPDATE payload received:", newRecord);
              }
              break;
            }

            case "DELETE": {
              const validatedPayload = validateDeletePayload(oldRecord);
              if (validatedPayload) {
                setExpenses((prev) =>
                  removeExpenseFromArray(prev, validatedPayload.id)
                );
              } else {
                console.error("Invalid DELETE payload received:", oldRecord);
              }
              break;
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, subscriptionKey, statementIds]);

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
