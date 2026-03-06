#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { Command, CommanderError } from "commander";
import { resolveLocalPaths } from "@/lib/local/paths";
import { initializeLocalStore } from "@/lib/local/repository";
import { DEFAULT_LOCAL_CATEGORIES, LOCAL_SCHEMA_SQL } from "@/lib/local/schema";
import { Database } from "@/lib/local/sqlite";

interface ImportOptions {
  url: string;
  email?: string;
  password?: string;
  home?: string;
  resetLocal?: boolean;
  downloadStatements?: boolean;
  admin?: boolean;
  targetUserId?: string;
  targetUserEmail?: string;
  json?: boolean;
}

interface CloudCategory {
  id: string;
  name: string;
  description?: string | null;
  is_default?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  created?: string;
  updated?: string;
}

interface CloudStatement {
  id: string;
  checksum?: string | null;
  file_name?: string | null;
  status?: string | null;
  blob_url?: string | null;
  bank_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created?: string;
  updated?: string;
}

interface CloudExpense {
  id: string;
  statement_id?: string | null;
  category_id?: string | null;
  category_text?: string | null;
  category?: string | null;
  date?: string | null;
  description?: string | null;
  merchant?: string | null;
  amount_sgd?: number | null;
  original_amount?: number | null;
  original_currency?: string | null;
  currency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created?: string;
  updated?: string;
}

interface CloudIngestionSetting {
  id: string;
  prompt?: string | null;
}

interface CloudMerchantMapping {
  id: string;
  merchant_name?: string | null;
  category_id?: string | null;
  category_text?: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created?: string;
  updated?: string;
}

interface CloudUser {
  id: string;
  email?: string | null;
}

interface PocketBaseListResult<T> {
  page: number;
  perPage: number;
  totalPages: number;
  totalItems: number;
  items: T[];
}

interface ImportSummary {
  authMode: "user" | "admin";
  userId: string;
  userEmail?: string;
  pocketbaseUrl: string;
  localHome: string;
  localDatabasePath: string;
  categoriesImported: number;
  categoriesUpdated: number;
  categoriesSkipped: number;
  statementsImported: number;
  statementsUpdated: number;
  statementsSkipped: number;
  transactionsImported: number;
  transactionsSkipped: number;
  categorizationRulesImported: number;
  categorizationRulesSkipped: number;
  statementFilesDownloaded: number;
  statementFilesStubbed: number;
  ingestionPromptImported: boolean;
}

class PocketBaseApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`PocketBase request failed (${status}): ${body}`);
    this.name = "PocketBaseApiError";
    this.status = status;
    this.body = body;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeDate(dateValue: string | null | undefined): string {
  if (!dateValue) {
    return nowIso().slice(0, 10);
  }

  const trimmed = dateValue.trim();
  if (!trimmed) {
    return nowIso().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const isoDate = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return isoDate;
  }

  return nowIso().slice(0, 10);
}

function normalizeTimestamp(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    if (value?.trim()) {
      return value;
    }
  }

  return nowIso();
}

function normalizeCurrency(value: string | null | undefined): string {
  if (!value) {
    return "SGD";
  }

  const upper = value.trim().toUpperCase();
  if (!upper) {
    return "SGD";
  }

  return upper.slice(0, 3);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function escapeFilter(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (safe.length > 0) {
    return safe;
  }

  return `statement-${Date.now()}.pdf`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new PocketBaseApiError(response.status, body);
  }

  if (!body) {
    return null as T;
  }

  return JSON.parse(body) as T;
}

async function authenticateUser(
  pocketbaseUrl: string,
  email: string,
  password: string
): Promise<{ token: string; userId: string }> {
  const authResponse = await fetchJson<{
    token: string;
    record: { id: string };
  }>(`${pocketbaseUrl}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity: email,
      password,
    }),
  });

  return {
    token: authResponse.token,
    userId: authResponse.record.id,
  };
}

async function authenticateSuperuser(
  pocketbaseUrl: string,
  email: string,
  password: string
): Promise<{ token: string }> {
  const authResponse = await fetchJson<{ token: string }>(
    pocketbaseUrl + "/api/collections/_superusers/auth-with-password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identity: email,
        password,
      }),
    }
  );

  return {
    token: authResponse.token,
  };
}

async function resolveTargetUser(
  pocketbaseUrl: string,
  token: string,
  options: ImportOptions
): Promise<{ userId: string; userEmail?: string }> {
  if (options.targetUserId?.trim()) {
    return { userId: options.targetUserId.trim() };
  }

  if (options.targetUserEmail?.trim()) {
    const targetEmail = options.targetUserEmail.trim();
    const safeEmail = escapeFilter(targetEmail);
    const usersByEmail = await listAllRecords<CloudUser>(
      pocketbaseUrl,
      token,
      "users",
      'email = "' + safeEmail + '"'
    );

    if (usersByEmail.length === 0) {
      throw new Error("No cloud user found for email " + targetEmail + ".");
    }

    if (usersByEmail.length > 1) {
      throw new Error(
        "Multiple cloud users found for email " +
          targetEmail +
          ". Use --target-user-id."
      );
    }

    return {
      userId: usersByEmail[0].id,
      userEmail: usersByEmail[0].email ?? undefined,
    };
  }

  const users = await listAllRecords<CloudUser>(pocketbaseUrl, token, "users");
  if (users.length === 0) {
    throw new Error("No cloud users found in PocketBase.");
  }

  if (users.length > 1) {
    throw new Error(
      "Multiple cloud users found. Pass --target-user-id or --target-user-email."
    );
  }

  return {
    userId: users[0].id,
    userEmail: users[0].email ?? undefined,
  };
}

async function listAllRecords<T>(
  pocketbaseUrl: string,
  token: string,
  collection: string,
  filter?: string
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("perPage", "200");
    if (filter) {
      params.set("filter", filter);
    }

    const url =
      `${pocketbaseUrl}/api/collections/${collection}/records?` +
      `${params.toString()}`;

    let payload: PocketBaseListResult<T>;

    try {
      payload = await fetchJson<PocketBaseListResult<T>>(url, {
        headers: {
          Authorization: token,
        },
      });
    } catch (error) {
      if (error instanceof PocketBaseApiError && error.status === 404) {
        return [];
      }
      throw error;
    }

    items.push(...payload.items);

    if (page >= payload.totalPages) {
      break;
    }

    page += 1;
  }

  return items;
}

function seedDefaultCategories(db: Database): void {
  const count = db.query("SELECT COUNT(*) as count FROM categories").get() as {
    count: number;
  } | null;

  if (!count || count.count > 0) {
    return;
  }

  const timestamp = nowIso();
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
      timestamp,
      timestamp
    );
  }
}

function resetLocalData(db: Database): void {
  db.exec("DELETE FROM transactions;");
  db.exec("DELETE FROM parse_runs;");
  db.exec("DELETE FROM categorization_rules;");
  db.exec("DELETE FROM statement_account_months;");
  db.exec("DELETE FROM statement_account_overrides;");
  db.exec("DELETE FROM accounts;");
  db.exec("DELETE FROM statement_texts;");
  db.exec("DELETE FROM statements;");
  db.exec("DELETE FROM categories;");
  seedDefaultCategories(db);
}

function getCategoryMaps(db: Database): {
  byId: Map<string, string>;
  byLowerName: Map<string, string>;
} {
  const rows = db.query("SELECT id, name FROM categories").all() as Array<{
    id: string;
    name: string;
  }>;

  const byId = new Map<string, string>();
  const byLowerName = new Map<string, string>();

  for (const row of rows) {
    byId.set(row.id, row.id);
    byLowerName.set(row.name.toLowerCase(), row.id);
  }

  return { byId, byLowerName };
}

function ensureCategoryByName(
  db: Database,
  name: string,
  byLowerName: Map<string, string>
): string {
  const normalized = name.trim();
  const fallbackName = normalized.length > 0 ? normalized : "Other";
  const lower = fallbackName.toLowerCase();

  const existing = byLowerName.get(lower);
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  const timestamp = nowIso();

  db.query(
    `INSERT INTO categories (
      id,
      name,
      description,
      is_default,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).run(id, fallbackName, null, 0, timestamp, timestamp);

  byLowerName.set(lower, id);
  return id;
}

function resolveStatementFilePath(
  statementsDir: string,
  statementId: string,
  fileName: string
): string {
  const safeName = sanitizeFileName(fileName);
  return join(statementsDir, `${statementId}-${safeName}`);
}

async function materializeStatementFile(
  statement: CloudStatement,
  filePath: string,
  downloadStatements: boolean
): Promise<{ downloaded: boolean; stubbed: boolean }> {
  mkdirSync(dirname(filePath), { recursive: true });

  if (downloadStatements && statement.blob_url) {
    try {
      const response = await fetch(statement.blob_url);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        writeFileSync(filePath, Buffer.from(arrayBuffer));
        return { downloaded: true, stubbed: false };
      }
    } catch {
      // Fall through to stub file creation below.
    }
  }

  if (!existsSync(filePath)) {
    const sourceUrl = statement.blob_url ?? "";
    const content = [
      "Imported statement metadata",
      `source_url=${sourceUrl}`,
      `statement_id=${statement.id}`,
      `file_name=${statement.file_name ?? "unknown"}`,
    ].join("\n");
    writeFileSync(filePath, `${content}\n`, "utf8");
  }

  return { downloaded: false, stubbed: true };
}

async function importCloudData(options: ImportOptions): Promise<ImportSummary> {
  if (!options.email || !options.password) {
    throw new Error(
      "Missing credentials. Provide --email and --password, or set " +
        "PB_USER_EMAIL/PB_USER_PASSWORD or PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD."
    );
  }

  if (options.home) {
    process.env.SPENDRO_HOME = resolve(options.home);
  }

  const pocketbaseUrl = options.url.replace(/\/$/, "");
  initializeLocalStore();
  const localPaths = resolveLocalPaths();

  let token: string;
  let userId: string;
  let userEmail: string | undefined;

  const authMode: "user" | "admin" = options.admin ? "admin" : "user";

  if (authMode === "admin") {
    const superuserAuth = await authenticateSuperuser(
      pocketbaseUrl,
      options.email,
      options.password
    );
    token = superuserAuth.token;

    const targetUser = await resolveTargetUser(pocketbaseUrl, token, options);
    userId = targetUser.userId;
    userEmail = targetUser.userEmail;
  } else {
    const userAuth = await authenticateUser(
      pocketbaseUrl,
      options.email,
      options.password
    );
    token = userAuth.token;
    userId = userAuth.userId;
    userEmail = options.email;
  }

  const safeUserId = escapeFilter(userId);
  const filter = 'user_id = "' + safeUserId + '"';

  const [
    cloudCategories,
    cloudStatements,
    cloudExpenses,
    ingestionSettings,
    cloudMerchantMappings,
  ] = await Promise.all([
    listAllRecords<CloudCategory>(pocketbaseUrl, token, "categories", filter),
    listAllRecords<CloudStatement>(pocketbaseUrl, token, "statements", filter),
    listAllRecords<CloudExpense>(pocketbaseUrl, token, "expenses", filter),
    listAllRecords<CloudIngestionSetting>(
      pocketbaseUrl,
      token,
      "ingestion_settings",
      filter
    ),
    listAllRecords<CloudMerchantMapping>(
      pocketbaseUrl,
      token,
      "merchant_mappings",
      filter
    ),
  ]);

  const db = new Database(localPaths.databasePath);

  const summary: ImportSummary = {
    authMode,
    userId,
    userEmail,
    pocketbaseUrl,
    localHome: localPaths.homeDir,
    localDatabasePath: localPaths.databasePath,
    categoriesImported: 0,
    categoriesUpdated: 0,
    categoriesSkipped: 0,
    statementsImported: 0,
    statementsUpdated: 0,
    statementsSkipped: 0,
    transactionsImported: 0,
    transactionsSkipped: 0,
    categorizationRulesImported: 0,
    categorizationRulesSkipped: 0,
    statementFilesDownloaded: 0,
    statementFilesStubbed: 0,
    ingestionPromptImported: false,
  };

  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(LOCAL_SCHEMA_SQL);

    if (options.resetLocal) {
      resetLocalData(db);
    }

    const { byId: categoryById, byLowerName: categoryByLowerName } =
      getCategoryMaps(db);
    const cloudToLocalCategoryId = new Map<string, string>();

    for (const category of cloudCategories) {
      const name = (category.name ?? "").trim();
      if (!name) {
        summary.categoriesSkipped += 1;
        continue;
      }

      const existingIdByName = categoryByLowerName.get(name.toLowerCase());
      if (existingIdByName) {
        db.query(
          `UPDATE categories
           SET description = COALESCE(?1, description),
               updated_at = ?2
           WHERE id = ?3`
        ).run(category.description ?? null, nowIso(), existingIdByName);

        summary.categoriesUpdated += 1;
        cloudToLocalCategoryId.set(category.id, existingIdByName);
        categoryById.set(existingIdByName, existingIdByName);
        continue;
      }

      const id = category.id?.trim() || randomUUID();
      const createdAt = normalizeTimestamp(
        category.created_at,
        category.created
      );
      const updatedAt = normalizeTimestamp(
        category.updated_at,
        category.updated
      );

      db.query(
        `INSERT OR REPLACE INTO categories (
          id,
          name,
          description,
          is_default,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).run(
        id,
        name,
        category.description ?? null,
        category.is_default ? 1 : 0,
        createdAt,
        updatedAt
      );

      categoryByLowerName.set(name.toLowerCase(), id);
      categoryById.set(id, id);
      cloudToLocalCategoryId.set(category.id, id);
      summary.categoriesImported += 1;
    }

    for (const mapping of cloudMerchantMappings) {
      const merchantName = mapping.merchant_name?.trim() || "";
      if (!merchantName) {
        summary.categorizationRulesSkipped += 1;
        continue;
      }

      let localCategoryId: string | null = null;
      const cloudCategoryId = mapping.category_id?.trim() || "";
      if (cloudCategoryId && cloudToLocalCategoryId.has(cloudCategoryId)) {
        localCategoryId = cloudToLocalCategoryId.get(cloudCategoryId) as string;
      } else {
        const categoryName =
          mapping.category_text?.trim() || mapping.category?.trim() || "";
        if (categoryName) {
          localCategoryId = ensureCategoryByName(
            db,
            categoryName,
            categoryByLowerName
          );
        }
      }

      if (!localCategoryId) {
        summary.categorizationRulesSkipped += 1;
        continue;
      }

      const existing = db
        .query(
          `SELECT id
           FROM categorization_rules
           WHERE action = 'categorize'
             AND match_field = 'merchant'
             AND match_type = 'contains'
             AND normalized_pattern = ?1
             AND COALESCE(category_id, '') = ?2
             AND account_id IS NULL
           LIMIT 1`
        )
        .get(
          merchantName.toLowerCase().replaceAll(/\s+/g, " ").trim(),
          localCategoryId
        ) as { id: string } | null;

      if (existing) {
        summary.categorizationRulesSkipped += 1;
        continue;
      }

      const timestamp = normalizeTimestamp(
        mapping.updated_at,
        mapping.updated,
        mapping.created_at,
        mapping.created
      );

      db.query(
        `INSERT INTO categorization_rules (
          id,
          action,
          match_field,
          match_type,
          pattern,
          normalized_pattern,
          category_id,
          account_id,
          priority,
          is_active,
          notes,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
      ).run(
        mapping.id?.trim() || randomUUID(),
        "categorize",
        "merchant",
        "contains",
        merchantName,
        merchantName.toLowerCase().replaceAll(/\s+/g, " ").trim(),
        localCategoryId,
        null,
        100,
        1,
        "Imported from cloud merchant_mappings",
        timestamp,
        timestamp
      );

      summary.categorizationRulesImported += 1;
    }

    const statementIdMap = new Map<string, string>();

    for (const statement of cloudStatements) {
      const cloudId = statement.id?.trim();
      if (!cloudId) {
        summary.statementsSkipped += 1;
        continue;
      }

      const fileName = sanitizeFileName(
        statement.file_name?.trim() || `${cloudId}${extname(cloudId) || ".pdf"}`
      );
      const desiredStatementId = cloudId;

      const existingById = db
        .query("SELECT id FROM statements WHERE id = ?1 LIMIT 1")
        .get(desiredStatementId) as { id: string } | null;

      const checksumCandidate =
        statement.checksum?.trim() || hashText(`cloud:${desiredStatementId}`);

      const existingByChecksum = db
        .query("SELECT id FROM statements WHERE checksum = ?1 LIMIT 1")
        .get(checksumCandidate) as { id: string } | null;

      const localStatementId =
        existingById?.id || existingByChecksum?.id || desiredStatementId;

      const statementFilePath = resolveStatementFilePath(
        localPaths.statementsDir,
        localStatementId,
        fileName
      );

      const fileResult = await materializeStatementFile(
        statement,
        statementFilePath,
        options.downloadStatements === true
      );

      if (fileResult.downloaded) {
        summary.statementFilesDownloaded += 1;
      }

      if (fileResult.stubbed) {
        summary.statementFilesStubbed += 1;
      }

      const createdAt = normalizeTimestamp(
        statement.created_at,
        statement.created
      );
      const updatedAt = normalizeTimestamp(
        statement.updated_at,
        statement.updated
      );
      const status = ["processing", "completed", "failed"].includes(
        statement.status ?? ""
      )
        ? (statement.status as "processing" | "completed" | "failed")
        : "completed";

      db.query(
        `INSERT OR REPLACE INTO statements (
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
        localStatementId,
        createdAt,
        updatedAt,
        checksumCandidate,
        fileName,
        statementFilePath,
        status,
        statement.bank_name ?? null,
        statement.period_start ?? null,
        statement.period_end ?? null
      );

      statementIdMap.set(cloudId, localStatementId);

      if (existingById || existingByChecksum) {
        summary.statementsUpdated += 1;
      } else {
        summary.statementsImported += 1;
      }
    }

    for (const expense of cloudExpenses) {
      const cloudExpenseId = expense.id?.trim() || randomUUID();
      const cloudStatementId = expense.statement_id?.trim();

      const localStatementId = cloudStatementId
        ? statementIdMap.get(cloudStatementId)
        : null;

      if (!localStatementId) {
        summary.transactionsSkipped += 1;
        continue;
      }

      let localCategoryId: string;
      const cloudCategoryId = expense.category_id?.trim() || "";
      if (cloudCategoryId && cloudToLocalCategoryId.has(cloudCategoryId)) {
        localCategoryId = cloudToLocalCategoryId.get(cloudCategoryId) as string;
      } else {
        const categoryName =
          expense.category_text?.trim() || expense.category?.trim() || "Other";
        localCategoryId = ensureCategoryByName(
          db,
          categoryName,
          categoryByLowerName
        );
      }

      const amount = toNumber(
        expense.amount_sgd ?? expense.original_amount ?? 0
      );
      const currency = normalizeCurrency(
        expense.original_currency ?? expense.currency
      );
      const postedOn = normalizeDate(expense.date);
      const description =
        expense.description?.trim() ||
        expense.merchant?.trim() ||
        "Imported expense";
      const merchant = expense.merchant?.trim() || description;
      const createdAt = normalizeTimestamp(expense.created_at, expense.created);
      const updatedAt = normalizeTimestamp(expense.updated_at, expense.updated);

      db.query(
        `INSERT OR REPLACE INTO transactions (
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
      ).run(
        cloudExpenseId,
        localStatementId,
        null,
        postedOn,
        description,
        merchant,
        localCategoryId,
        amount,
        currency,
        createdAt,
        updatedAt
      );

      summary.transactionsImported += 1;
    }

    const prompt = ingestionSettings[0]?.prompt?.trim();
    if (prompt) {
      const promptPath = join(localPaths.homeDir, "ingestion-prompt.txt");
      writeFileSync(promptPath, `${prompt}\n`, "utf8");
      summary.ingestionPromptImported = true;
    }

    return summary;
  } finally {
    db.close();
  }
}

function printResult(summary: ImportSummary, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("Auth mode: " + summary.authMode);
  if (summary.userEmail) {
    console.log("PocketBase user email: " + summary.userEmail);
  }
  console.log("PocketBase user id: " + summary.userId);
  console.log(`Source: ${summary.pocketbaseUrl}`);
  console.log(`Local home: ${summary.localHome}`);
  console.log(`Local db: ${summary.localDatabasePath}`);
  console.log("");
  console.log("Import Summary");
  console.log(`- Categories imported: ${summary.categoriesImported}`);
  console.log(`- Categories updated: ${summary.categoriesUpdated}`);
  console.log(`- Categories skipped: ${summary.categoriesSkipped}`);
  console.log(`- Statements imported: ${summary.statementsImported}`);
  console.log(`- Statements updated: ${summary.statementsUpdated}`);
  console.log(`- Statements skipped: ${summary.statementsSkipped}`);
  console.log(`- Transactions imported: ${summary.transactionsImported}`);
  console.log(`- Transactions skipped: ${summary.transactionsSkipped}`);
  console.log(
    `- Categorization rules imported: ${summary.categorizationRulesImported}`
  );
  console.log(
    `- Categorization rules skipped: ${summary.categorizationRulesSkipped}`
  );
  console.log(
    `- Statement files downloaded: ${summary.statementFilesDownloaded}`
  );
  console.log(`- Statement files stubbed: ${summary.statementFilesStubbed}`);
  console.log(
    `- Ingestion prompt imported: ${summary.ingestionPromptImported ? "yes" : "no"}`
  );
}

async function run(): Promise<void> {
  const program = new Command();

  program
    .name("import-cloud-to-local")
    .description("Import PocketBase cloud records into local Spendro SQLite")
    .showHelpAfterError()
    .requiredOption(
      "--email <email>",
      "PocketBase user email",
      process.env.PB_USER_EMAIL ?? process.env.PB_SUPERUSER_EMAIL
    )
    .requiredOption(
      "--password <password>",
      "PocketBase user password",
      process.env.PB_USER_PASSWORD ?? process.env.PB_SUPERUSER_PASSWORD
    )
    .option(
      "--url <url>",
      "PocketBase base URL",
      process.env.POCKETBASE_URL ??
        process.env.NEXT_PUBLIC_POCKETBASE_URL ??
        "http://localhost:8090"
    )
    .option("--home <path>", "Override SPENDRO_HOME for import destination")
    .option("--admin", "Authenticate as PocketBase superuser")
    .option("--target-user-id <id>", "Target user id when using --admin")
    .option(
      "--target-user-email <email>",
      "Target user email when using --admin"
    )
    .option("--reset-local", "Clear local data before import")
    .option(
      "--download-statements",
      "Attempt to download statement files from cloud blob URLs"
    )
    .option("--json", "Output summary as JSON");

  program.exitOverride();

  const rawArgs = process.argv.slice(2);
  const jsonRequested = rawArgs.includes("--json");

  try {
    await program.parseAsync(process.argv);
    const options = program.opts<ImportOptions>();
    const summary = await importCloudData(options);
    printResult(summary, options.json === true);
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.helpDisplayed"
    ) {
      process.exit(0);
    }

    const message =
      error instanceof Error ? error.message : "Cloud import failed.";

    if (jsonRequested) {
      console.error(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(`Error: ${message}`);
    }

    process.exit(1);
  }
}

void run();
