"use client";

import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo, useState } from "react";
import { pocketbase } from "@/lib/pocketbase/client";
import {
  POCKETBASE_EXPENSES_QUERY_KEY,
  pocketbaseExpensesCollection,
  pocketbaseQueryClient,
} from "@/lib/pocketbase/expenses";
import type { DatabaseExpenseRow } from "@/lib/types/expense";

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface UsePocketbaseExpensesOptions {
  enabled?: boolean;
}

interface UsePocketbaseExpensesReturn {
  expenses: DatabaseExpenseRow[];
  loading: boolean;
  error: string | null;
  subscriptionError: string | null;
  lastEventAt: string | null;
}

export function usePocketbaseExpenses(
  options: UsePocketbaseExpensesOptions = {}
): UsePocketbaseExpensesReturn {
  const enabled = options.enabled ?? true;
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null
  );
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const liveQuery = useLiveQuery(
    () => (enabled ? pocketbaseExpensesCollection : undefined),
    [enabled]
  );

  useEffect(() => {
    console.debug("[PB expenses] enabled:", enabled);
  }, [enabled]);

  useEffect(() => {
    console.debug("[PB expenses] status:", {
      status: liveQuery.status,
      isLoading: liveQuery.isLoading,
      isReady: liveQuery.isReady,
      isError: liveQuery.isError,
    });
  }, [
    liveQuery.status,
    liveQuery.isLoading,
    liveQuery.isReady,
    liveQuery.isError,
  ]);

  useEffect(() => {
    if (!enabled || !pocketbase.authStore.isValid) {
      setSubscriptionError(null);
      return undefined;
    }

    const userId = pocketbase.authStore.record?.id;
    if (!userId) {
      setSubscriptionError(null);
      return undefined;
    }

    let active = true;
    const safeUserId = escapeFilter(userId);

    const subscribe = async () => {
      try {
        console.debug("[PB expenses] subscribing to SSE");
        await pocketbase.collection("expenses").subscribe(
          "*",
          (event) => {
            if (!active) return;

            const recordUserId = Array.isArray(event.record.user_id)
              ? event.record.user_id[0]
              : event.record.user_id;
            if (recordUserId !== userId) return;

            setLastEventAt(new Date().toISOString());
            pocketbaseQueryClient.invalidateQueries({
              queryKey: POCKETBASE_EXPENSES_QUERY_KEY,
            });
          },
          {
            filter: `user_id = "${safeUserId}"`,
          }
        );
        setSubscriptionError(null);
        console.debug("[PB expenses] SSE subscription active");
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to subscribe to PocketBase";
        setSubscriptionError(message);
        console.debug("[PB expenses] SSE subscription failed:", message);
      }
    };

    subscribe();

    return () => {
      active = false;
      console.debug("[PB expenses] unsubscribing from SSE");
      pocketbase.collection("expenses").unsubscribe("*");
    };
  }, [enabled]);

  const expenses = useMemo(() => {
    if (!enabled) return [];
    return liveQuery.data ?? [];
  }, [enabled, liveQuery.data]);

  useEffect(() => {
    if (!enabled) return;
    console.debug("[PB expenses] rows:", {
      total: expenses.length,
      sample: expenses[0],
    });
  }, [enabled, expenses]);

  return {
    expenses,
    loading: enabled ? liveQuery.isLoading : false,
    error:
      enabled && liveQuery.isError
        ? "Failed to load PocketBase expenses"
        : null,
    subscriptionError,
    lastEventAt,
  };
}
