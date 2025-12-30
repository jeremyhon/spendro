import { createCollection } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { pocketbase } from "@/lib/pocketbase/client";
import {
  type DatabaseExpenseRow,
  databaseExpenseRowSchema,
} from "@/lib/types/expense";

export const POCKETBASE_EXPENSES_QUERY_KEY = ["pocketbase", "expenses"];

type PocketbaseExpenseRecord = {
  id: string;
  created: string;
  created_at?: string;
  user_id: string | string[];
  statement_id: string | string[];
  category_id?: string | string[];
  date: string;
  description: string;
  amount_sgd: number;
  currency?: string;
  foreign_amount?: number | null;
  foreign_currency?: string | null;
  original_amount?: number | null;
  original_currency?: string | null;
  merchant?: string | null;
  category: string;
  category_text?: string | null;
  line_hash: string;
  expand?: {
    category_id?: {
      id: string;
      name: string;
      description?: string | null;
      is_default?: boolean;
    };
    statement_id?: {
      id: string;
      checksum?: string;
      file_name?: string;
      status?: string;
    };
  };
};

export const pocketbaseQueryClient = new QueryClient();

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parsePocketbaseExpense(
  record: PocketbaseExpenseRecord
): DatabaseExpenseRow | null {
  const userId = Array.isArray(record.user_id)
    ? record.user_id[0]
    : record.user_id;
  const statementId = Array.isArray(record.statement_id)
    ? record.statement_id[0]
    : record.statement_id;
  const categoryName =
    record.expand?.category_id?.name ??
    record.category ??
    record.category_text ??
    "Other";

  try {
    return databaseExpenseRowSchema.parse({
      id: record.id,
      user_id: userId,
      statement_id: record.expand?.statement_id?.id ?? statementId,
      created_at: record.created_at ?? record.created,
      date: record.date,
      description: record.description,
      amount_sgd: record.amount_sgd,
      currency: record.currency ?? "SGD",
      foreign_amount: record.foreign_amount ?? null,
      foreign_currency: record.foreign_currency ?? null,
      original_amount: record.original_amount ?? null,
      original_currency: record.original_currency ?? null,
      merchant: record.merchant ?? null,
      category: categoryName,
      line_hash: record.line_hash,
    });
  } catch (error) {
    console.warn("Invalid PocketBase expense row:", record, error);
    return null;
  }
}

export const pocketbaseExpensesCollection = createCollection(
  queryCollectionOptions<DatabaseExpenseRow>({
    queryClient: pocketbaseQueryClient,
    queryKey: POCKETBASE_EXPENSES_QUERY_KEY,
    queryFn: async () => {
      if (!pocketbase.authStore.isValid) return [];

      const userId = pocketbase.authStore.record?.id;
      if (!userId) return [];

      const records = await pocketbase
        .collection("expenses")
        .getFullList<PocketbaseExpenseRecord>({
          sort: "-date",
          expand: "category_id,statement_id",
          filter: `user_id = "${escapeFilter(userId)}"`,
        });

      return records
        .map(parsePocketbaseExpense)
        .filter((row): row is DatabaseExpenseRow => row !== null);
    },
    getKey: (row) => row.id,
  })
);
