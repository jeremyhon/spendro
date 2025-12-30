"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { pocketbase } from "@/lib/pocketbase/client";
import {
  type StatementStatus,
  type StatementStatusData,
  transformDatabaseToStatusDisplay,
} from "@/lib/types/statement";

interface UseStatementStatusOptions {
  statementIds?: string[];
  autoSubscribe?: boolean;
}

interface UseStatementStatusReturn {
  statements: StatementStatusData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type PocketbaseStatementRecord = {
  id: string;
  file_name: string;
  status: StatementStatus;
  updated_at?: string | null;
  updated?: string;
};

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toStatusDisplay(
  record: PocketbaseStatementRecord
): StatementStatusData {
  return transformDatabaseToStatusDisplay({
    id: record.id,
    file_name: record.file_name,
    status: record.status,
    updated_at: record.updated_at ?? record.updated ?? new Date().toISOString(),
  });
}

/**
 * Hook for tracking statement status changes in real-time using PocketBase
 * Optimized for upload status tracking with minimal data transfer
 */
export function useStatementStatus(
  options: UseStatementStatusOptions = {}
): UseStatementStatusReturn {
  const { statementIds, autoSubscribe = true } = options;
  const { user, loading: authLoading } = useAuth();

  const [statements, setStatements] = useState<StatementStatusData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatements = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setError(null);

    try {
      const filter = statementIds?.length
        ? statementIds.map((id) => `id = "${escapeFilter(id)}"`).join(" || ")
        : undefined;

      const records = await pocketbase
        .collection("statements")
        .getFullList<PocketbaseStatementRecord>({
          filter,
          sort: "-updated_at",
        });

      const nextStatements = records.map(toStatusDisplay);
      setStatements(nextStatements);
    } catch (err) {
      console.error("Error fetching statement status data:", err);
      setError("Failed to load statement status data");
    } finally {
      setLoading(false);
    }
  }, [statementIds, user?.id]);

  const refetch = useCallback(() => {
    void fetchStatements();
  }, [fetchStatements]);

  useEffect(() => {
    if (authLoading) return;

    if (!user?.id) {
      setStatements([]);
      setLoading(false);
      setError("User not authenticated");
      return;
    }

    if (!autoSubscribe) {
      setLoading(false);
      return;
    }

    void fetchStatements();

    let unsubscribe: (() => void) | null = null;

    pocketbase
      .collection("statements")
      .subscribe("*", (event) => {
        if (statementIds?.length && !statementIds.includes(event.record.id)) {
          return;
        }

        if (event.action === "delete") {
          setStatements((prev) =>
            prev.filter((item) => item.id !== event.record.id)
          );
          return;
        }

        const next = toStatusDisplay(
          event.record as unknown as PocketbaseStatementRecord
        );
        setStatements((prev) => {
          const updated = prev.filter((item) => item.id !== next.id);
          const merged = [next, ...updated];
          return merged.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
      })
      .then((handler) => {
        unsubscribe = handler;
      })
      .catch((err) => {
        console.error("Error subscribing to statement status:", err);
        setError("Failed to connect to statement status updates");
      });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      } else {
        pocketbase.collection("statements").unsubscribe("*");
      }
    };
  }, [authLoading, autoSubscribe, fetchStatements, statementIds, user?.id]);

  return {
    statements,
    loading: authLoading || loading,
    error,
    refetch,
  };
}

/**
 * Hook for tracking a specific statement's status
 */
export function useStatementStatusById(statementId: string): {
  statement: StatementStatusData | null;
  loading: boolean;
  error: string | null;
} {
  const { statements, loading, error } = useStatementStatus({
    statementIds: [statementId],
    autoSubscribe: true,
  });

  const statement = statements.find((s) => s.id === statementId) || null;

  return {
    statement,
    loading,
    error,
  };
}

/**
 * Hook for tracking multiple statements' status during batch uploads
 */
export function useBatchStatementStatus(
  statementIds: string[]
): UseStatementStatusReturn {
  return useStatementStatus({
    statementIds,
    autoSubscribe: true,
  });
}
