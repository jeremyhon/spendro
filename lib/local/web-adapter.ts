import { randomUUID } from "node:crypto";
import { resolveLocalPaths } from "@/lib/local/paths";
import { initializeLocalStore } from "@/lib/local/repository";
import { Database } from "@/lib/local/sqlite";
import type {
  Category,
  CategoryDeleteOptions,
  CategoryDeleteResult,
  CategoryInsert,
  CategoryUpdate,
} from "@/lib/types/category";
import type {
  DisplayExpenseWithDuplicate,
  ExpenseUpdateData,
} from "@/lib/types/expense";
import { recalculateDuplicates } from "@/lib/utils/display-transformers";

const LOCAL_USER_ID = "local-user";
const DEFAULT_SUPPRESSED_TRANSACTION_IDS = [
  "44bf38aa-4514-45ea-9b88-c1ac2c4f1425",
];

function resolveSuppressedTransactionIds(): Set<string> {
  const ids = new Set(DEFAULT_SUPPRESSED_TRANSACTION_IDS);
  const raw = process.env.SPENDRO_HIDDEN_TRANSACTION_IDS;
  if (!raw) {
    return ids;
  }

  const extraIds = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const id of extraIds) {
    ids.add(id);
  }

  return ids;
}

const SUPPRESSED_TRANSACTION_IDS = resolveSuppressedTransactionIds();

function isSuppressedTransaction(id: string): boolean {
  return SUPPRESSED_TRANSACTION_IDS.has(id);
}

function isInternalSelfTransfer(
  description: string | null | undefined,
  merchant: string | null | undefined
): boolean {
  const descriptionValue = description ?? "";
  const merchantValue = merchant ?? "";
  const combined = `${descriptionValue} ${merchantValue}`;

  if (!/JEREMY HON/i.test(combined)) {
    return false;
  }

  return /GIRO|PAYNOW|FAST|TRANSFER|FUNDS TRF|ADVICE/i.test(descriptionValue);
}

function isSuppressedTransactionRow(row: {
  id: string;
  description?: string | null;
  merchant?: string | null;
}): boolean {
  if (isSuppressedTransaction(row.id)) {
    return true;
  }

  return isInternalSelfTransfer(row.description, row.merchant);
}

interface LocalCategoryRow {
  id: string;
  name: string;
  description: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface LocalExpenseRow {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  category: string | null;
  amount: number;
  currency: string;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function withLocalDb<T>(callback: (db: Database) => T): T {
  initializeLocalStore();
  const { databasePath } = resolveLocalPaths();
  const db = new Database(databasePath);

  try {
    db.exec("PRAGMA foreign_keys = ON;");
    return callback(db);
  } finally {
    db.close();
  }
}

function toCategory(row: LocalCategoryRow): Category {
  return {
    id: row.id,
    user_id: LOCAL_USER_ID,
    name: row.name,
    description: row.description,
    is_default: row.is_default === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findCategoryByName(
  db: Database,
  name: string
): LocalCategoryRow | null {
  const row = db
    .query(
      `SELECT
        id,
        name,
        description,
        is_default,
        created_at,
        updated_at
      FROM categories
      WHERE lower(name) = lower(?1)
      LIMIT 1`
    )
    .get(name) as LocalCategoryRow | null;

  return row;
}

function getOrCreateCategoryByNameInDb(
  db: Database,
  categoryName: string
): string {
  const existing = findCategoryByName(db, categoryName);
  if (existing) {
    return existing.id;
  }

  const id = randomUUID();
  const createdAt = nowIso();

  db.query(
    `INSERT INTO categories (
      id,
      name,
      description,
      is_default,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).run(id, categoryName, null, 0, createdAt, createdAt);

  return id;
}

export function listLocalCategories(): Category[] {
  return withLocalDb((db) => {
    const rows = db
      .query(
        `SELECT
          id,
          name,
          description,
          is_default,
          created_at,
          updated_at
        FROM categories
        ORDER BY name ASC`
      )
      .all() as LocalCategoryRow[];

    return rows.map(toCategory);
  });
}

export function createLocalCategory(input: CategoryInsert): Category {
  return withLocalDb((db) => {
    const duplicate = findCategoryByName(db, input.name);
    if (duplicate) {
      throw new Error("Category with this name already exists");
    }

    const createdAt = nowIso();
    const id = randomUUID();

    db.query(
      `INSERT INTO categories (
        id,
        name,
        description,
        is_default,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).run(id, input.name, input.description ?? null, 0, createdAt, createdAt);

    const row = db
      .query(
        `SELECT
          id,
          name,
          description,
          is_default,
          created_at,
          updated_at
        FROM categories
        WHERE id = ?1`
      )
      .get(id) as LocalCategoryRow;

    return toCategory(row);
  });
}

export function updateLocalCategory(
  categoryId: string,
  input: CategoryUpdate
): Category {
  return withLocalDb((db) => {
    const existing = db
      .query("SELECT id, name FROM categories WHERE id = ?1 LIMIT 1")
      .get(categoryId) as { id: string; name: string } | null;

    if (!existing) {
      throw new Error("Category not found");
    }

    const duplicate = findCategoryByName(db, input.name);
    if (duplicate && duplicate.id !== categoryId) {
      throw new Error("Category with this name already exists");
    }

    const updatedAt = nowIso();

    db.query(
      `UPDATE categories
       SET name = ?1, description = ?2, updated_at = ?3
       WHERE id = ?4`
    ).run(input.name, input.description ?? null, updatedAt, categoryId);

    const row = db
      .query(
        `SELECT
          id,
          name,
          description,
          is_default,
          created_at,
          updated_at
        FROM categories
        WHERE id = ?1`
      )
      .get(categoryId) as LocalCategoryRow;

    return toCategory(row);
  });
}

export function deleteLocalCategory(
  categoryId: string,
  options?: CategoryDeleteOptions
): CategoryDeleteResult {
  return withLocalDb((db) => {
    const category = db
      .query("SELECT id FROM categories WHERE id = ?1 LIMIT 1")
      .get(categoryId) as { id: string } | null;

    if (!category) {
      throw new Error("Category not found");
    }

    let reassignedCount = 0;
    let deletedCount = 0;

    if (options?.targetCategoryId) {
      const target = db
        .query("SELECT id FROM categories WHERE id = ?1 LIMIT 1")
        .get(options.targetCategoryId) as { id: string } | null;

      if (!target) {
        throw new Error("Target category not found");
      }

      const countRow = db
        .query(
          "SELECT COUNT(*) as count FROM transactions WHERE category_id = ?1"
        )
        .get(categoryId) as { count: number };

      reassignedCount = countRow.count;

      db.query(
        "UPDATE transactions SET category_id = ?1 WHERE category_id = ?2"
      ).run(options.targetCategoryId, categoryId);
    } else {
      const countRow = db
        .query(
          "SELECT COUNT(*) as count FROM transactions WHERE category_id = ?1"
        )
        .get(categoryId) as { count: number };

      deletedCount = countRow.count;

      db.query("DELETE FROM transactions WHERE category_id = ?1").run(
        categoryId
      );
    }

    db.query("DELETE FROM categories WHERE id = ?1").run(categoryId);

    return {
      success: true,
      reassigned_count: reassignedCount,
      deleted_count: deletedCount,
    };
  });
}

export function getLocalCategoryExpenseCount(categoryId: string): number {
  return withLocalDb((db) => {
    const rows = db
      .query(
        `SELECT
          id,
          description,
          merchant
        FROM transactions
        WHERE category_id = ?1`
      )
      .all(categoryId) as Array<{
      id: string;
      description: string;
      merchant: string | null;
    }>;

    return rows.filter((row) => !isSuppressedTransactionRow(row)).length;
  });
}

export function getOrCreateLocalCategoryByName(categoryName: string): string {
  return withLocalDb((db) => {
    return getOrCreateCategoryByNameInDb(db, categoryName);
  });
}

export function listLocalDisplayExpenses(): DisplayExpenseWithDuplicate[] {
  return withLocalDb((db) => {
    const rows = db
      .query(
        `SELECT
          t.id,
          t.posted_on as date,
          t.description,
          t.merchant,
          c.name as category,
          t.amount,
          t.currency,
          t.created_at
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        ORDER BY t.posted_on DESC, t.created_at DESC`
      )
      .all() as LocalExpenseRow[];

    const displayRows = rows
      .filter((row) => !isSuppressedTransactionRow(row))
      .map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        merchant: row.merchant ?? "",
        category: row.category ?? "Other",
        amount: row.amount,
        originalAmount: row.amount,
        originalCurrency: row.currency,
        currency: row.currency,
        createdAt: row.created_at,
      }));

    return recalculateDuplicates(displayRows);
  });
}

export function listLocalExpenseFacts(dateRange?: {
  from: string;
  to: string;
}): Array<{ date: string; category: string; amount: number }> {
  return withLocalDb((db) => {
    if (dateRange) {
      const rows = db
        .query(
          `SELECT
            t.id,
            t.posted_on as date,
            t.description,
            t.merchant,
            c.name as category,
            t.amount
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.posted_on >= ?1 AND t.posted_on <= ?2
          ORDER BY t.posted_on ASC`
        )
        .all(dateRange.from, dateRange.to) as Array<{
        id: string;
        date: string;
        description: string;
        merchant: string | null;
        category: string | null;
        amount: number;
      }>;

      return rows
        .filter((row) => !isSuppressedTransactionRow(row))
        .map((row) => ({
          date: row.date,
          category: row.category ?? "Other",
          amount: row.amount,
        }));
    }

    const rows = db
      .query(
        `SELECT
          t.id,
          t.posted_on as date,
          t.description,
          t.merchant,
          c.name as category,
          t.amount
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        ORDER BY t.posted_on ASC`
      )
      .all() as Array<{
      id: string;
      date: string;
      description: string;
      merchant: string | null;
      category: string | null;
      amount: number;
    }>;

    return rows
      .filter((row) => !isSuppressedTransactionRow(row))
      .map((row) => ({
        date: row.date,
        category: row.category ?? "Other",
        amount: row.amount,
      }));
  });
}

export function updateLocalExpense(
  expenseId: string,
  data: ExpenseUpdateData
): void {
  withLocalDb((db) => {
    const row = db
      .query("SELECT id FROM transactions WHERE id = ?1 LIMIT 1")
      .get(expenseId) as { id: string } | null;

    if (!row) {
      throw new Error("Expense not found");
    }

    const categoryId = getOrCreateCategoryByNameInDb(db, data.category);
    const updatedAt = nowIso();

    db.query(
      `UPDATE transactions
       SET posted_on = ?1,
           description = ?2,
           merchant = ?3,
           category_id = ?4,
           amount = ?5,
           currency = ?6,
           updated_at = ?7
       WHERE id = ?8`
    ).run(
      data.date,
      data.description,
      data.merchant,
      categoryId,
      data.amount,
      data.originalCurrency,
      updatedAt,
      expenseId
    );
  });
}

export function deleteLocalExpense(expenseId: string): void {
  withLocalDb((db) => {
    db.query("DELETE FROM transactions WHERE id = ?1").run(expenseId);
  });
}

export function deleteLocalExpenses(expenseIds: string[]): number {
  if (expenseIds.length === 0) {
    return 0;
  }

  return withLocalDb((db) => {
    const deleteQuery = db.query("DELETE FROM transactions WHERE id = ?1");
    let deletedCount = 0;

    for (const id of expenseIds) {
      const result = deleteQuery.run(id) as { changes: number };
      deletedCount += result.changes;
    }

    return deletedCount;
  });
}
