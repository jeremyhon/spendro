import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { parseTransactionsWithEmbeddedLlm } from "@/lib/local/llm-parser";
import {
  parseAgentTransactionsJson,
  parseEmbeddedTransactions,
} from "@/lib/local/parser";
import { ensureLocalDirectories, resolveLocalPaths } from "@/lib/local/paths";
import { DEFAULT_LOCAL_CATEGORIES, LOCAL_SCHEMA_SQL } from "@/lib/local/schema";
import type {
  AddCategoryInput,
  AddStatementTextInput,
  CategoryRecord,
  ParsedTransactionInput,
  ParseMode,
  ParseResult,
  ParseRunRecord,
  StatementRecord,
  StoreStatementInput,
  TransactionRecord,
} from "@/lib/local/types";

interface StatementRow {
  id: string;
  created_at: string;
  updated_at: string;
  checksum: string;
  file_name: string;
  file_path: string;
  status: "processing" | "completed" | "failed";
  bank_name: string | null;
  period_start: string | null;
  period_end: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  statement_id: string;
  parse_run_id: string | null;
  posted_on: string;
  description: string;
  merchant: string | null;
  category_id: string | null;
  category_name: string | null;
  amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

interface ParseRunRow {
  id: string;
  statement_id: string;
  created_at: string;
  mode: ParseMode;
  status: "success" | "failed";
  parser_version: string;
  error_message: string | null;
  transaction_count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toStatementRecord(row: StatementRow): StatementRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checksum: row.checksum,
    fileName: row.file_name,
    filePath: row.file_path,
    status: row.status,
    bankName: row.bank_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

function toCategoryRecord(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransactionRecord(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    statementId: row.statement_id,
    parseRunId: row.parse_run_id,
    postedOn: row.posted_on,
    description: row.description,
    merchant: row.merchant,
    categoryId: row.category_id,
    categoryName: row.category_name,
    amount: row.amount,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toParseRunRecord(row: ParseRunRow): ParseRunRecord {
  return {
    id: row.id,
    statementId: row.statement_id,
    createdAt: row.created_at,
    mode: row.mode,
    status: row.status,
    parserVersion: row.parser_version,
    errorMessage: row.error_message,
    transactionCount: row.transaction_count,
  };
}

function withDatabase<T>(callback: (db: Database) => T): T {
  const paths = resolveLocalPaths();
  ensureLocalDirectories(paths);

  const db = new Database(paths.databasePath);

  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(LOCAL_SCHEMA_SQL);
    seedDefaultCategories(db);

    return callback(db);
  } finally {
    db.close();
  }
}

function seedDefaultCategories(db: Database): void {
  const countQuery = db.query("SELECT COUNT(*) as count FROM categories");
  const countRow = countQuery.get() as { count: number } | null;
  if (!countRow || countRow.count > 0) {
    return;
  }

  const createdAt = nowIso();
  const insert = db.query(
    `INSERT INTO categories (
      id,
      name,
      description,
      is_default,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  );

  for (const category of DEFAULT_LOCAL_CATEGORIES) {
    insert.run(
      randomUUID(),
      category.name,
      category.description,
      1,
      createdAt,
      createdAt
    );
  }
}

function ensureStatementExists(db: Database, statementId: string): void {
  const row = db
    .query("SELECT id FROM statements WHERE id = ?1 LIMIT 1")
    .get(statementId) as { id: string } | null;

  if (!row) {
    throw new Error(`Statement "${statementId}" not found.`);
  }
}

function getLatestStatementText(
  db: Database,
  statementId: string
): string | null {
  const latestText = db
    .query(
      `SELECT raw_text FROM statement_texts
      WHERE statement_id = ?1
      ORDER BY created_at DESC
      LIMIT 1`
    )
    .get(statementId) as { raw_text: string } | null;

  return latestText?.raw_text ?? null;
}

function listCategoryNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM categories ORDER BY name ASC")
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function fileChecksum(filePath: string): string {
  const buffer = readFileSync(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function getCategoryMap(db: Database): Map<string, string> {
  const categoryRows = db
    .query("SELECT id, name FROM categories")
    .all() as Array<{ id: string; name: string }>;

  const categoryMap = new Map<string, string>();
  for (const row of categoryRows) {
    categoryMap.set(row.name.toLowerCase(), row.id);
  }

  return categoryMap;
}

function findOtherCategoryId(db: Database): string | null {
  const row = db
    .query(
      "SELECT id FROM categories WHERE lower(name) = 'other' ORDER BY created_at ASC LIMIT 1"
    )
    .get() as { id: string } | null;

  return row?.id ?? null;
}

export function initializeLocalStore(): {
  homeDir: string;
  databasePath: string;
  statementsDir: string;
  backupsDir: string;
} {
  const paths = resolveLocalPaths();

  withDatabase(() => {
    return null;
  });

  return {
    homeDir: paths.homeDir,
    databasePath: paths.databasePath,
    statementsDir: paths.statementsDir,
    backupsDir: paths.backupsDir,
  };
}

export function storeStatement(input: StoreStatementInput): StatementRecord {
  const absolutePath = resolve(input.filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Statement file not found: ${absolutePath}`);
  }

  return withDatabase((db) => {
    const checksum = fileChecksum(absolutePath);

    const duplicate = db
      .query("SELECT id FROM statements WHERE checksum = ?1 LIMIT 1")
      .get(checksum) as { id: string } | null;

    if (duplicate) {
      throw new Error(
        `Statement already exists (id: ${duplicate.id}) with the same checksum.`
      );
    }

    const statementId = randomUUID();
    const paths = resolveLocalPaths();
    const fileName = basename(absolutePath);
    const storedFileName = `${statementId}-${fileName}`;
    const storedFilePath = resolve(paths.statementsDir, storedFileName);
    copyFileSync(absolutePath, storedFilePath);

    const timestamp = nowIso();

    db.query(
      `INSERT INTO statements (
        id,
        created_at,
        updated_at,
        checksum,
        file_name,
        file_path,
        status,
        bank_name,
        period_start,
        period_end
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).run(
      statementId,
      timestamp,
      timestamp,
      checksum,
      fileName,
      storedFilePath,
      "processing",
      input.bankName ?? null,
      input.periodStart ?? null,
      input.periodEnd ?? null
    );

    const row = db
      .query(
        `SELECT
          id,
          created_at,
          updated_at,
          checksum,
          file_name,
          file_path,
          status,
          bank_name,
          period_start,
          period_end
        FROM statements
        WHERE id = ?1`
      )
      .get(statementId) as StatementRow;

    return toStatementRecord(row);
  });
}

export function listStatements(): StatementRecord[] {
  return withDatabase((db) => {
    const rows = db
      .query(
        `SELECT
          id,
          created_at,
          updated_at,
          checksum,
          file_name,
          file_path,
          status,
          bank_name,
          period_start,
          period_end
        FROM statements
        ORDER BY created_at DESC`
      )
      .all() as StatementRow[];

    return rows.map(toStatementRecord);
  });
}

export function addStatementText(input: AddStatementTextInput): {
  statementId: string;
  statementTextId: string;
  createdAt: string;
} {
  const absolutePath = resolve(input.filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Extracted text file not found: ${absolutePath}`);
  }

  const rawText = readFileSync(absolutePath, "utf8");
  const source = input.source ?? "manual";

  return withDatabase((db) => {
    ensureStatementExists(db, input.statementId);

    const statementTextId = randomUUID();
    const createdAt = nowIso();

    db.query(
      `INSERT INTO statement_texts (
        id,
        statement_id,
        created_at,
        source,
        raw_text
      ) VALUES (?1, ?2, ?3, ?4, ?5)`
    ).run(statementTextId, input.statementId, createdAt, source, rawText);

    db.query("UPDATE statements SET updated_at = ?1 WHERE id = ?2").run(
      createdAt,
      input.statementId
    );

    return {
      statementId: input.statementId,
      statementTextId,
      createdAt,
    };
  });
}

export function listCategories(): CategoryRecord[] {
  return withDatabase((db) => {
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
      .all() as CategoryRow[];

    return rows.map(toCategoryRecord);
  });
}

export function addCategory(input: AddCategoryInput): CategoryRecord {
  return withDatabase((db) => {
    const now = nowIso();
    const categoryId = randomUUID();

    db.query(
      `INSERT INTO categories (
        id,
        name,
        description,
        is_default,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).run(categoryId, input.name, input.description ?? null, 0, now, now);

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
      .get(categoryId) as CategoryRow;

    return toCategoryRecord(row);
  });
}

function persistParseResult(
  db: Database,
  statementId: string,
  mode: ParseMode,
  parserVersion: string,
  transactions: ParsedTransactionInput[]
): ParseResult {
  const createdAt = nowIso();
  const parseRunId = randomUUID();
  const categoryMap = getCategoryMap(db);
  const otherCategoryId = findOtherCategoryId(db);

  db.query(
    `INSERT INTO parse_runs (
      id,
      statement_id,
      created_at,
      mode,
      status,
      parser_version,
      error_message,
      transaction_count
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).run(
    parseRunId,
    statementId,
    createdAt,
    mode,
    "success",
    parserVersion,
    null,
    transactions.length
  );

  db.query("DELETE FROM transactions WHERE statement_id = ?1").run(statementId);

  const insertTransaction = db.query(
    `INSERT INTO transactions (
      id,
      statement_id,
      parse_run_id,
      posted_on,
      description,
      merchant,
      category_id,
      amount,
      currency,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  );

  for (const transaction of transactions) {
    const categoryId = transaction.category
      ? (categoryMap.get(transaction.category.toLowerCase()) ?? otherCategoryId)
      : otherCategoryId;

    insertTransaction.run(
      randomUUID(),
      statementId,
      parseRunId,
      transaction.postedOn,
      transaction.description,
      transaction.merchant ?? null,
      categoryId ?? null,
      transaction.amount,
      transaction.currency ?? "SGD",
      createdAt,
      createdAt
    );
  }

  db.query(
    "UPDATE statements SET status = ?1, updated_at = ?2 WHERE id = ?3"
  ).run("completed", createdAt, statementId);

  const parseRunRow = db
    .query(
      `SELECT
        id,
        statement_id,
        created_at,
        mode,
        status,
        parser_version,
        error_message,
        transaction_count
      FROM parse_runs
      WHERE id = ?1`
    )
    .get(parseRunId) as ParseRunRow;

  return {
    parseRun: toParseRunRecord(parseRunRow),
    insertedTransactions: transactions.length,
  };
}

function persistParseFailure(
  db: Database,
  statementId: string,
  mode: ParseMode,
  parserVersion: string,
  errorMessage: string
): ParseResult {
  const createdAt = nowIso();
  const parseRunId = randomUUID();

  db.query(
    `INSERT INTO parse_runs (
      id,
      statement_id,
      created_at,
      mode,
      status,
      parser_version,
      error_message,
      transaction_count
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).run(
    parseRunId,
    statementId,
    createdAt,
    mode,
    "failed",
    parserVersion,
    errorMessage,
    0
  );

  db.query(
    "UPDATE statements SET status = ?1, updated_at = ?2 WHERE id = ?3"
  ).run("failed", createdAt, statementId);

  const parseRunRow = db
    .query(
      `SELECT
        id,
        statement_id,
        created_at,
        mode,
        status,
        parser_version,
        error_message,
        transaction_count
      FROM parse_runs
      WHERE id = ?1`
    )
    .get(parseRunId) as ParseRunRow;

  return {
    parseRun: toParseRunRecord(parseRunRow),
    insertedTransactions: 0,
  };
}

export function runEmbeddedParse(statementId: string): ParseResult {
  const parserVersion = "embedded-v1";

  return withDatabase((db) => {
    ensureStatementExists(db, statementId);

    const latestText = getLatestStatementText(db, statementId);

    if (!latestText) {
      return persistParseFailure(
        db,
        statementId,
        "embedded",
        parserVersion,
        "No extracted text found for this statement."
      );
    }

    try {
      const parsedTransactions = parseEmbeddedTransactions(latestText);
      return persistParseResult(
        db,
        statementId,
        "embedded",
        parserVersion,
        parsedTransactions
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Embedded parse failed.";

      return persistParseFailure(
        db,
        statementId,
        "embedded",
        parserVersion,
        message
      );
    }
  });
}

export async function runEmbeddedLlmParse(
  statementId: string
): Promise<ParseResult> {
  const parserVersion = "embedded-llm-v1";

  const context = withDatabase((db) => {
    ensureStatementExists(db, statementId);

    return {
      latestText: getLatestStatementText(db, statementId),
      categoryNames: listCategoryNames(db),
    };
  });

  if (!context.latestText) {
    return withDatabase((db) => {
      ensureStatementExists(db, statementId);

      return persistParseFailure(
        db,
        statementId,
        "embedded",
        parserVersion,
        "No extracted text found for this statement."
      );
    });
  }

  try {
    const parsedTransactions = await parseTransactionsWithEmbeddedLlm(
      context.latestText,
      context.categoryNames
    );

    return withDatabase((db) => {
      ensureStatementExists(db, statementId);

      return persistParseResult(
        db,
        statementId,
        "embedded",
        parserVersion,
        parsedTransactions
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Embedded LLM parse failed.";

    return withDatabase((db) => {
      ensureStatementExists(db, statementId);

      return persistParseFailure(
        db,
        statementId,
        "embedded",
        parserVersion,
        message
      );
    });
  }
}

export function runAgentParse(
  statementId: string,
  agentJsonPayloadPath: string
): ParseResult {
  const parserVersion = "agent-v1";
  const absoluteInputPath = resolve(agentJsonPayloadPath);

  if (!existsSync(absoluteInputPath)) {
    throw new Error(`Agent payload file not found: ${absoluteInputPath}`);
  }

  const payloadText = readFileSync(absoluteInputPath, "utf8");

  return withDatabase((db) => {
    ensureStatementExists(db, statementId);

    try {
      const parsedTransactions = parseAgentTransactionsJson(payloadText);
      return persistParseResult(
        db,
        statementId,
        "agent",
        parserVersion,
        parsedTransactions
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent parse failed.";

      return persistParseFailure(
        db,
        statementId,
        "agent",
        parserVersion,
        message
      );
    }
  });
}

export function listTransactions(statementId?: string): TransactionRecord[] {
  return withDatabase((db) => {
    const query = statementId
      ? db.query(
          `SELECT
            t.id,
            t.statement_id,
            t.parse_run_id,
            t.posted_on,
            t.description,
            t.merchant,
            t.category_id,
            c.name as category_name,
            t.amount,
            t.currency,
            t.created_at,
            t.updated_at
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.statement_id = ?1
          ORDER BY t.posted_on DESC, t.created_at DESC`
        )
      : db.query(
          `SELECT
            t.id,
            t.statement_id,
            t.parse_run_id,
            t.posted_on,
            t.description,
            t.merchant,
            t.category_id,
            c.name as category_name,
            t.amount,
            t.currency,
            t.created_at,
            t.updated_at
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          ORDER BY t.posted_on DESC, t.created_at DESC`
        );

    const rows = statementId
      ? (query.all(statementId) as TransactionRow[])
      : (query.all() as TransactionRow[]);

    return rows.map(toTransactionRecord);
  });
}
