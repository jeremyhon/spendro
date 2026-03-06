import { execFileSync } from "node:child_process";
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
import { Database } from "@/lib/local/sqlite";
import type {
  AccountProductType,
  AccountRecord,
  AddCategoryInput,
  AddStatementTextInput,
  CategoryRecord,
  MissingStatementGapRecord,
  ParsedTransactionInput,
  ParseMode,
  ParseResult,
  ParseRunRecord,
  StatementCoverageOverrideRecord,
  StatementCoverageRecord,
  StatementRecord,
  StoreStatementInput,
  TransactionRecord,
  UpsertStatementCoverageOverrideInput,
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

interface AccountRow {
  id: string;
  institution: string;
  product_type: AccountProductType;
  account_label: string;
  last4: string | null;
  dedupe_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface StatementCoverageRow {
  statement_id: string;
  account_id: string;
  statement_month: string;
  inferred_by: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

interface StatementCoverageOverrideRow {
  statement_id: string;
  institution: string;
  product_type: AccountProductType;
  account_label: string;
  last4: string | null;
  statement_month: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface StatementMetadataRow {
  id: string;
  file_name: string;
  file_path: string;
  created_at: string;
}

interface StatementAccountInference {
  institution: string;
  productType: AccountProductType;
  accountLabel: string;
  last4: string | null;
  statementMonth: string;
  inferredBy: string;
  confidence: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

const MONTH_BY_SHORT_NAME: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_BY_LONG_NAME: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function toMonthNumber(monthToken: string): number | null {
  const normalized = monthToken.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized in MONTH_BY_LONG_NAME) {
    return MONTH_BY_LONG_NAME[normalized];
  }

  const short = normalized.slice(0, 3);
  return MONTH_BY_SHORT_NAME[short] ?? null;
}

function formatStatementMonth(year: number, month: number): string {
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error("Invalid year or month for statement month formatting.");
  }

  const normalizedMonth = String(month).padStart(2, "0");
  return `${year}-${normalizedMonth}`;
}

function parseStatementMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid statement month "${value}". Expected YYYY-MM.`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid statement month "${value}". Month out of range.`);
  }

  return { year, month };
}

function monthToIndex(value: string): number {
  const parsed = parseStatementMonth(value);
  return parsed.year * 12 + (parsed.month - 1);
}

function indexToMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return formatStatementMonth(year, month);
}

function previousCalendarMonth(reference = new Date()): string {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;

  if (month === 1) {
    return formatStatementMonth(year - 1, 12);
  }

  return formatStatementMonth(year, month - 1);
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

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    institution: row.institution,
    productType: row.product_type,
    accountLabel: row.account_label,
    last4: row.last4,
    dedupeKey: row.dedupe_key,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStatementCoverageRecord(
  row: StatementCoverageRow
): StatementCoverageRecord {
  return {
    statementId: row.statement_id,
    accountId: row.account_id,
    statementMonth: row.statement_month,
    inferredBy: row.inferred_by,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStatementCoverageOverrideRecord(
  row: StatementCoverageOverrideRow
): StatementCoverageOverrideRecord {
  return {
    statementId: row.statement_id,
    institution: row.institution,
    productType: row.product_type,
    accountLabel: row.account_label,
    last4: row.last4,
    statementMonth: row.statement_month,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function makeAccountDedupeKey(
  institution: string,
  productType: AccountProductType,
  accountLabel: string,
  last4: string | null
): string {
  return [
    normalizeText(institution),
    productType,
    normalizeText(accountLabel),
    last4 ? last4.trim() : "",
  ].join("|");
}

function normalizeLast4(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replaceAll(/\D+/g, "");
  if (digits.length === 0) {
    return null;
  }

  if (digits.length !== 4) {
    throw new Error(`Invalid last4 "${value}". Expected exactly 4 digits.`);
  }

  return digits;
}

function extractPdfFirstPageText(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const text = execFileSync(
      "pdftotext",
      ["-f", "1", "-l", "1", filePath, "-"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

function inferProviderFromText(text: string): string | null {
  if (/\bcitibank\b|\bciti\b/i.test(text)) {
    return "Citibank";
  }

  if (/\bocbc\b|oversea-chinese/i.test(text)) {
    return "OCBC";
  }

  if (/\buob\b|united overseas/i.test(text)) {
    return "UOB";
  }

  if (/\bdbs\b|\bposb\b/i.test(text)) {
    return "DBS";
  }

  return null;
}

function inferLast4FromText(text: string): string | null {
  const maskedPattern = /(?:\*{2,}|x{2,})\s*(\d{4})/i;
  const maskedMatch = maskedPattern.exec(text);
  if (maskedMatch) {
    return maskedMatch[1];
  }

  const endingPattern = /(?:ending|last\s*4|last four)[^\d]{0,12}(\d{4})\b/i;
  const endingMatch = endingPattern.exec(text);
  if (endingMatch) {
    return endingMatch[1];
  }

  const cardNumberPattern =
    /(?:card|account)\s*(?:no\.?|number)?[^\d]{0,10}(?:x{2,}|\*{2,})\s*(\d{4})\b/i;
  const cardNumberMatch = cardNumberPattern.exec(text);
  if (cardNumberMatch) {
    return cardNumberMatch[1];
  }

  return null;
}

function inferStatementMonthFromText(text: string): string | null {
  const statementDateNameFirst =
    /Statement\s+Date\s+([A-Za-z]{3,9})\s+\d{1,2},\s*(20\d{2})/i;
  const statementDateNameFirstMatch = statementDateNameFirst.exec(text);
  if (statementDateNameFirstMatch) {
    const month = toMonthNumber(statementDateNameFirstMatch[1]);
    const year = Number.parseInt(statementDateNameFirstMatch[2], 10);
    if (month) {
      return formatStatementMonth(year, month);
    }
  }

  const statementDateDayFirst =
    /Statement\s+Date\s+\d{1,2}\s+([A-Za-z]{3,9})\s+(20\d{2})/i;
  const statementDateDayFirstMatch = statementDateDayFirst.exec(text);
  if (statementDateDayFirstMatch) {
    const month = toMonthNumber(statementDateDayFirstMatch[1]);
    const year = Number.parseInt(statementDateDayFirstMatch[2], 10);
    if (month) {
      return formatStatementMonth(year, month);
    }
  }

  const periodRangeNamePattern =
    /\d{1,2}\s+([A-Za-z]{3,9})\s+(20\d{2})\s+to\s+\d{1,2}\s+([A-Za-z]{3,9})\s+(20\d{2})/i;
  const periodRangeNameMatch = periodRangeNamePattern.exec(text);
  if (periodRangeNameMatch) {
    const month = toMonthNumber(periodRangeNameMatch[3]);
    const year = Number.parseInt(periodRangeNameMatch[4], 10);
    if (month) {
      return formatStatementMonth(year, month);
    }
  }

  const periodRangeNumericPattern =
    /\d{1,2}[/-](\d{1,2})[/-](20\d{2})\s*(?:to|-|–)\s*\d{1,2}[/-](\d{1,2})[/-](20\d{2})/i;
  const periodRangeNumericMatch = periodRangeNumericPattern.exec(text);
  if (periodRangeNumericMatch) {
    const month = Number.parseInt(periodRangeNumericMatch[3], 10);
    const year = Number.parseInt(periodRangeNumericMatch[4], 10);
    if (month >= 1 && month <= 12) {
      return formatStatementMonth(year, month);
    }
  }

  return null;
}

function inferFromFilename(
  statement: StatementMetadataRow
): StatementAccountInference | null {
  const fileNameLower = statement.file_name.toLowerCase();
  const createdYear = Number.parseInt(statement.created_at.slice(0, 4), 10);

  const citiStmtPattern =
    /citibank_creditcard_(\d{4})stmt_\d{2}(\d{2})(\d{4})/i;
  const citiStmtMatch = citiStmtPattern.exec(fileNameLower);
  if (citiStmtMatch) {
    const month = Number.parseInt(citiStmtMatch[2], 10);
    const year = Number.parseInt(citiStmtMatch[3], 10);
    return {
      institution: "Citibank",
      productType: "card",
      accountLabel: "Credit Card",
      last4: citiStmtMatch[1],
      statementMonth: formatStatementMonth(year, month),
      inferredBy: "filename",
      confidence: 0.99,
    };
  }

  const citiMonthPattern = /(?:cardstatement|estatement)_([a-z]{3})(\d{4})/i;
  const citiMonthMatch = citiMonthPattern.exec(fileNameLower);
  if (
    citiMonthMatch &&
    (fileNameLower.includes("cardstatement") ||
      fileNameLower.includes("estatement"))
  ) {
    const month = toMonthNumber(citiMonthMatch[1]);
    const year = Number.parseInt(citiMonthMatch[2], 10);
    if (month) {
      return {
        institution: "Citibank",
        productType: "card",
        accountLabel: "Credit Card",
        last4: null,
        statementMonth: formatStatementMonth(year, month),
        inferredBy: "filename",
        confidence: 0.82,
      };
    }
  }

  const ocbcPattern = /ocbc_90\.n_card-(\d{4})-([a-z]{3})-(\d{2})/i;
  const ocbcMatch = ocbcPattern.exec(fileNameLower);
  if (ocbcMatch) {
    const month = toMonthNumber(ocbcMatch[2]);
    const year = 2000 + Number.parseInt(ocbcMatch[3], 10);
    if (month) {
      return {
        institution: "OCBC",
        productType: "card",
        accountLabel: "90N Card",
        last4: ocbcMatch[1],
        statementMonth: formatStatementMonth(year, month),
        inferredBy: "filename",
        confidence: 0.99,
      };
    }
  }

  const dbsConsolidatedPattern =
    /credit_cards_consolidated_statement_([a-z]{3})(\d{4})/i;
  const dbsConsolidatedMatch = dbsConsolidatedPattern.exec(fileNameLower);
  if (dbsConsolidatedMatch) {
    const month = toMonthNumber(dbsConsolidatedMatch[1]);
    const year = Number.parseInt(dbsConsolidatedMatch[2], 10);
    if (month) {
      return {
        institution: "DBS",
        productType: "card",
        accountLabel: "Credit Cards Consolidated",
        last4: null,
        statementMonth: formatStatementMonth(year, month),
        inferredBy: "filename",
        confidence: 0.97,
      };
    }
  }

  const dbsDepositPattern = /deposit_account_statement_([a-z]{3})(\d{4})/i;
  const dbsDepositMatch = dbsDepositPattern.exec(fileNameLower);
  if (dbsDepositMatch) {
    const month = toMonthNumber(dbsDepositMatch[1]);
    const year = Number.parseInt(dbsDepositMatch[2], 10);
    if (month) {
      return {
        institution: "DBS",
        productType: "account",
        accountLabel: "Deposit Account",
        last4: null,
        statementMonth: formatStatementMonth(year, month),
        inferredBy: "filename",
        confidence: 0.98,
      };
    }
  }

  const dbsAccountPattern = /dbs_account_([a-z]{3})/i;
  const dbsAccountMatch = dbsAccountPattern.exec(fileNameLower);
  if (dbsAccountMatch) {
    const month = toMonthNumber(dbsAccountMatch[1]);
    if (month) {
      return {
        institution: "DBS",
        productType: "account",
        accountLabel: "Deposit Account",
        last4: null,
        statementMonth: formatStatementMonth(createdYear, month),
        inferredBy: "filename",
        confidence: 0.94,
      };
    }
  }

  const dbsCardPattern = /dbs_cc_([a-z]{3})/i;
  const dbsCardMatch = dbsCardPattern.exec(fileNameLower);
  if (dbsCardMatch) {
    const month = toMonthNumber(dbsCardMatch[1]);
    if (month) {
      return {
        institution: "DBS",
        productType: "card",
        accountLabel: "Credit Card",
        last4: null,
        statementMonth: formatStatementMonth(createdYear, month),
        inferredBy: "filename",
        confidence: 0.94,
      };
    }
  }

  const dbsLiveFreshPattern = /dbs_live_fresh_([a-z]{3})/i;
  const dbsLiveFreshMatch = dbsLiveFreshPattern.exec(fileNameLower);
  if (dbsLiveFreshMatch) {
    const month = toMonthNumber(dbsLiveFreshMatch[1]);
    if (month) {
      return {
        institution: "DBS",
        productType: "card",
        accountLabel: "Live Fresh",
        last4: null,
        statementMonth: formatStatementMonth(createdYear, month),
        inferredBy: "filename",
        confidence: 0.93,
      };
    }
  }

  const uobAccountPattern = /uob_([a-z]{3,4})/i;
  const uobAccountMatch = uobAccountPattern.exec(fileNameLower);
  if (uobAccountMatch) {
    const month = toMonthNumber(uobAccountMatch[1].slice(0, 3));
    if (month) {
      return {
        institution: "UOB",
        productType: "account",
        accountLabel: "Account",
        last4: null,
        statementMonth: formatStatementMonth(createdYear, month),
        inferredBy: "filename",
        confidence: 0.9,
      };
    }
  }

  return null;
}

function inferFromText(
  statement: StatementMetadataRow,
  text: string
): StatementAccountInference | null {
  const provider = inferProviderFromText(text);
  const statementMonth = inferStatementMonthFromText(text);
  if (!provider || !statementMonth) {
    return null;
  }

  const fileNameLower = statement.file_name.toLowerCase();
  const last4 = inferLast4FromText(text);

  let productType: AccountProductType = "other";
  let accountLabel = "Statement";

  if (/card|credit limit|payment due date|card\.centre/i.test(text)) {
    productType = "card";
    accountLabel = "Card";
  } else if (
    /statement of account|deposit account|account summary/i.test(text)
  ) {
    productType = "account";
    accountLabel = "Account";
  }

  if (provider === "DBS" && /live fresh/i.test(`${text} ${fileNameLower}`)) {
    productType = "card";
    accountLabel = "Live Fresh";
  }

  if (provider === "OCBC" && /90n/i.test(`${text} ${fileNameLower}`)) {
    productType = "card";
    accountLabel = "90N Card";
  }

  if (provider === "DBS" && /consolidated/i.test(fileNameLower)) {
    productType = "card";
    accountLabel = "Credit Cards Consolidated";
  }

  if (provider === "DBS" && /deposit_account_statement/i.test(fileNameLower)) {
    productType = "account";
    accountLabel = "Deposit Account";
  }

  if (provider === "Citibank" && productType !== "account") {
    productType = "card";
    accountLabel = "Credit Card";
  }

  return {
    institution: provider,
    productType,
    accountLabel,
    last4,
    statementMonth,
    inferredBy: "text",
    confidence: 0.76,
  };
}

function mergeInferences(
  filenameInference: StatementAccountInference | null,
  textInference: StatementAccountInference | null
): StatementAccountInference | null {
  if (!filenameInference && !textInference) {
    return null;
  }

  if (!filenameInference) {
    return textInference;
  }

  if (!textInference) {
    return filenameInference;
  }

  return {
    institution: filenameInference.institution || textInference.institution,
    productType: filenameInference.productType || textInference.productType,
    accountLabel: filenameInference.accountLabel || textInference.accountLabel,
    last4: filenameInference.last4 ?? textInference.last4,
    statementMonth:
      filenameInference.statementMonth || textInference.statementMonth,
    inferredBy: `${filenameInference.inferredBy}+${textInference.inferredBy}`,
    confidence: Math.max(
      filenameInference.confidence,
      textInference.confidence
    ),
  };
}

function inferStatementAccount(
  statement: StatementMetadataRow
): StatementAccountInference | null {
  const byFilename = inferFromFilename(statement);
  const firstPageText = extractPdfFirstPageText(statement.file_path);
  const byText = firstPageText ? inferFromText(statement, firstPageText) : null;
  return mergeInferences(byFilename, byText);
}

function statementOverrideToInference(
  row: StatementCoverageOverrideRow
): StatementAccountInference {
  return {
    institution: row.institution,
    productType: row.product_type,
    accountLabel: row.account_label,
    last4: row.last4,
    statementMonth: row.statement_month,
    inferredBy: "manual",
    confidence: 1.0,
  };
}

function getOrCreateAccountId(
  db: Database,
  inference: StatementAccountInference
): string {
  const dedupeKey = makeAccountDedupeKey(
    inference.institution,
    inference.productType,
    inference.accountLabel,
    inference.last4
  );

  if (inference.last4) {
    const exact = db
      .query("SELECT id FROM accounts WHERE dedupe_key = ?1 LIMIT 1")
      .get(dedupeKey) as { id: string } | null;

    if (exact) {
      return exact.id;
    }

    const nullLast4Rows = db
      .query(
        `SELECT id
         FROM accounts
         WHERE institution = ?1
           AND product_type = ?2
           AND account_label = ?3
           AND last4 IS NULL
         LIMIT 2`
      )
      .all(
        inference.institution,
        inference.productType,
        inference.accountLabel
      ) as Array<{ id: string }>;

    if (nullLast4Rows.length === 1) {
      const timestamp = nowIso();
      db.query(
        `UPDATE accounts
         SET last4 = ?1,
             dedupe_key = ?2,
             updated_at = ?3
         WHERE id = ?4`
      ).run(inference.last4, dedupeKey, timestamp, nullLast4Rows[0].id);

      return nullLast4Rows[0].id;
    }
  }

  if (!inference.last4) {
    const sameProductRows = db
      .query(
        `SELECT id
         FROM accounts
         WHERE institution = ?1
           AND product_type = ?2
           AND account_label = ?3
           AND last4 IS NOT NULL
           AND is_active = 1
         LIMIT 2`
      )
      .all(
        inference.institution,
        inference.productType,
        inference.accountLabel
      ) as Array<{ id: string }>;

    if (sameProductRows.length === 1) {
      return sameProductRows[0].id;
    }
  }

  const existing = db
    .query("SELECT id FROM accounts WHERE dedupe_key = ?1 LIMIT 1")
    .get(dedupeKey) as { id: string } | null;

  const timestamp = nowIso();

  if (existing) {
    db.query(
      `UPDATE accounts
       SET updated_at = ?1,
           institution = ?2,
           product_type = ?3,
           account_label = ?4,
           last4 = ?5
       WHERE id = ?6`
    ).run(
      timestamp,
      inference.institution,
      inference.productType,
      inference.accountLabel,
      inference.last4,
      existing.id
    );
    return existing.id;
  }

  const accountId = randomUUID();
  db.query(
    `INSERT INTO accounts (
      id,
      institution,
      product_type,
      account_label,
      last4,
      dedupe_key,
      is_active,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).run(
    accountId,
    inference.institution,
    inference.productType,
    inference.accountLabel,
    inference.last4,
    dedupeKey,
    1,
    timestamp,
    timestamp
  );

  return accountId;
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

export function refreshStatementCoverage(): {
  processedStatements: number;
  taggedStatements: number;
  unclassifiedStatements: number;
  manualOverrideStatements: number;
  accountsCount: number;
  coverageRowsCount: number;
} {
  return withDatabase((db) => {
    db.exec("DELETE FROM statement_account_months;");

    const statements = db
      .query(
        `SELECT id, file_name, file_path, created_at
         FROM statements
         ORDER BY created_at ASC`
      )
      .all() as StatementMetadataRow[];

    const overrideRows = db
      .query(
        `SELECT
          statement_id,
          institution,
          product_type,
          account_label,
          last4,
          statement_month,
          reason,
          created_at,
          updated_at
        FROM statement_account_overrides`
      )
      .all() as StatementCoverageOverrideRow[];
    const overridesByStatementId = new Map<
      string,
      StatementCoverageOverrideRow
    >(overrideRows.map((row) => [row.statement_id, row]));

    let taggedStatements = 0;
    let unclassifiedStatements = 0;
    let manualOverrideStatements = 0;

    for (const statement of statements) {
      const override = overridesByStatementId.get(statement.id);
      const inference = override
        ? statementOverrideToInference(override)
        : inferStatementAccount(statement);
      if (!inference) {
        unclassifiedStatements += 1;
        continue;
      }

      try {
        parseStatementMonth(inference.statementMonth);
      } catch {
        unclassifiedStatements += 1;
        continue;
      }

      const accountId = getOrCreateAccountId(db, inference);
      const timestamp = nowIso();

      db.query(
        `INSERT OR REPLACE INTO statement_account_months (
          statement_id,
          account_id,
          statement_month,
          inferred_by,
          confidence,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).run(
        statement.id,
        accountId,
        inference.statementMonth,
        inference.inferredBy,
        inference.confidence,
        timestamp,
        timestamp
      );

      if (override) {
        manualOverrideStatements += 1;
      }
      taggedStatements += 1;
    }

    db.exec(
      `DELETE FROM accounts
       WHERE id NOT IN (SELECT DISTINCT account_id FROM statement_account_months)`
    );

    const accountsCount = (
      db.query("SELECT COUNT(*) as count FROM accounts").get() as {
        count: number;
      }
    ).count;
    const coverageRowsCount = (
      db
        .query("SELECT COUNT(*) as count FROM statement_account_months")
        .get() as {
        count: number;
      }
    ).count;

    return {
      processedStatements: statements.length,
      taggedStatements,
      unclassifiedStatements,
      manualOverrideStatements,
      accountsCount,
      coverageRowsCount,
    };
  });
}

export function listAccounts(): AccountRecord[] {
  return withDatabase((db) => {
    const rows = db
      .query(
        `SELECT
          id,
          institution,
          product_type,
          account_label,
          last4,
          dedupe_key,
          is_active,
          created_at,
          updated_at
        FROM accounts
        ORDER BY institution ASC, account_label ASC, last4 ASC`
      )
      .all() as AccountRow[];

    return rows.map(toAccountRecord);
  });
}

export function listStatementCoverage(): StatementCoverageRecord[] {
  return withDatabase((db) => {
    const rows = db
      .query(
        `SELECT
          statement_id,
          account_id,
          statement_month,
          inferred_by,
          confidence,
          created_at,
          updated_at
        FROM statement_account_months
        ORDER BY statement_month ASC, statement_id ASC`
      )
      .all() as StatementCoverageRow[];

    return rows.map(toStatementCoverageRecord);
  });
}

export function listStatementCoverageOverrides(): StatementCoverageOverrideRecord[] {
  return withDatabase((db) => {
    const rows = db
      .query(
        `SELECT
          statement_id,
          institution,
          product_type,
          account_label,
          last4,
          statement_month,
          reason,
          created_at,
          updated_at
        FROM statement_account_overrides
        ORDER BY updated_at DESC`
      )
      .all() as StatementCoverageOverrideRow[];

    return rows.map(toStatementCoverageOverrideRecord);
  });
}

export function upsertStatementCoverageOverride(
  input: UpsertStatementCoverageOverrideInput
): StatementCoverageOverrideRecord {
  const normalizedLast4 = normalizeLast4(input.last4);

  return withDatabase((db) => {
    ensureStatementExists(db, input.statementId);
    parseStatementMonth(input.statementMonth);

    const timestamp = nowIso();
    const normalizedReason = input.reason?.trim() || null;

    db.query(
      `INSERT INTO statement_account_overrides (
        statement_id,
        institution,
        product_type,
        account_label,
        last4,
        statement_month,
        reason,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(statement_id) DO UPDATE SET
        institution = excluded.institution,
        product_type = excluded.product_type,
        account_label = excluded.account_label,
        last4 = excluded.last4,
        statement_month = excluded.statement_month,
        reason = excluded.reason,
        updated_at = excluded.updated_at`
    ).run(
      input.statementId,
      input.institution.trim(),
      input.productType,
      input.accountLabel.trim(),
      normalizedLast4,
      input.statementMonth,
      normalizedReason,
      timestamp,
      timestamp
    );

    const row = db
      .query(
        `SELECT
          statement_id,
          institution,
          product_type,
          account_label,
          last4,
          statement_month,
          reason,
          created_at,
          updated_at
        FROM statement_account_overrides
        WHERE statement_id = ?1`
      )
      .get(input.statementId) as StatementCoverageOverrideRow;

    return toStatementCoverageOverrideRecord(row);
  });
}

export function removeStatementCoverageOverride(statementId: string): {
  statementId: string;
  removed: boolean;
} {
  return withDatabase((db) => {
    ensureStatementExists(db, statementId);
    const result = db
      .query("DELETE FROM statement_account_overrides WHERE statement_id = ?1")
      .run(statementId);

    return {
      statementId,
      removed: result.changes > 0,
    };
  });
}

export function listMissingStatementGaps(options?: {
  asOfMonth?: string;
  includeComplete?: boolean;
}): MissingStatementGapRecord[] {
  return withDatabase((db) => {
    const asOfMonth = options?.asOfMonth ?? previousCalendarMonth();
    parseStatementMonth(asOfMonth);

    const includeComplete = options?.includeComplete === true;
    const asOfIndex = monthToIndex(asOfMonth);

    const accountRows = db
      .query(
        `SELECT
          id,
          institution,
          product_type,
          account_label,
          last4,
          dedupe_key,
          is_active,
          created_at,
          updated_at
        FROM accounts
        WHERE is_active = 1
        ORDER BY institution ASC, account_label ASC, last4 ASC`
      )
      .all() as AccountRow[];

    const results: MissingStatementGapRecord[] = [];

    for (const accountRow of accountRows) {
      const monthRows = db
        .query(
          `SELECT DISTINCT statement_month
           FROM statement_account_months
           WHERE account_id = ?1
           ORDER BY statement_month ASC`
        )
        .all(accountRow.id) as Array<{ statement_month: string }>;

      const observedMonths = monthRows
        .map((row) => row.statement_month)
        .filter((value) => /^\d{4}-\d{2}$/.test(value))
        .filter((value) => monthToIndex(value) <= asOfIndex);

      if (observedMonths.length === 0) {
        continue;
      }

      const observedSet = new Set(observedMonths);
      const firstObserved = observedMonths[0];
      const firstIndex = monthToIndex(firstObserved);

      if (firstIndex > asOfIndex) {
        continue;
      }

      const missingMonths: string[] = [];
      for (let cursor = firstIndex; cursor <= asOfIndex; cursor += 1) {
        const month = indexToMonth(cursor);
        if (!observedSet.has(month)) {
          missingMonths.push(month);
        }
      }

      if (!includeComplete && missingMonths.length === 0) {
        continue;
      }

      results.push({
        account: toAccountRecord(accountRow),
        asOfMonth,
        firstObservedMonth: firstObserved,
        observedMonths,
        missingMonths,
      });
    }

    return results;
  });
}
