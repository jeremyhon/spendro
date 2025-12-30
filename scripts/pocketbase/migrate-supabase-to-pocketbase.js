import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnvFile(path.join(ROOT, ".env.local"));
const env = { ...fileEnv, ...process.env };

const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const pocketbaseUrl = env.NEXT_PUBLIC_POCKETBASE_URL || "http://localhost:8090";

const pbAdminEmail =
  env.PB_SUPERUSER_EMAIL ||
  (fs.existsSync(path.join(ROOT, ".pocketbase/temp_admin_email.txt"))
    ? fs
        .readFileSync(
          path.join(ROOT, ".pocketbase/temp_admin_email.txt"),
          "utf8"
        )
        .trim()
    : null);

const pbAdminPassword =
  env.PB_SUPERUSER_PASSWORD ||
  (fs.existsSync(path.join(ROOT, ".pocketbase/temp_admin_pass.txt"))
    ? fs
        .readFileSync(
          path.join(ROOT, ".pocketbase/temp_admin_pass.txt"),
          "utf8"
        )
        .trim()
    : null);

if (!pbAdminEmail || !pbAdminPassword) {
  throw new Error("Missing PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD");
}

const PB_USER_EMAIL = env.PB_USER_EMAIL;
const SUPABASE_USER_ID = env.SUPABASE_USER_ID;
const WIPE = env.PB_WIPE === "1";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    console.warn("Non-JSON response:", text);
    return null;
  }
}

async function authPocketBase() {
  const body = JSON.stringify({
    identity: pbAdminEmail,
    password: pbAdminPassword,
  });
  const data = await fetchJson(
    `${pocketbaseUrl}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  return data.token;
}

async function getCollection(token, name) {
  try {
    return await fetchJson(`${pocketbaseUrl}/api/collections/${name}`, {
      headers: { Authorization: token },
    });
  } catch (error) {
    if (String(error).includes("404")) return null;
    throw error;
  }
}

async function upsertCollection(token, payload) {
  const existing = await getCollection(token, payload.name);
  if (!existing) {
    return fetchJson(`${pocketbaseUrl}/api/collections`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  const existingFields = existing.fields || [];
  const desiredFields = payload.fields || [];
  const mergedFields = existingFields.map((field) => {
    const desired = desiredFields.find(
      (candidate) => candidate.name === field.name
    );
    if (!desired) return field;
    return { ...field, ...desired, id: field.id, type: field.type };
  });

  for (const field of desiredFields) {
    if (
      !existingFields.some((existingField) => existingField.name === field.name)
    ) {
      mergedFields.push(field);
    }
  }

  const existingIndexes = existing.indexes || [];
  const desiredIndexes = payload.indexes || [];
  const mergedIndexes = Array.from(
    new Set([...existingIndexes, ...desiredIndexes])
  );

  const updatePayload = {
    ...existing,
    listRule: payload.listRule ?? existing.listRule,
    viewRule: payload.viewRule ?? existing.viewRule,
    createRule: payload.createRule ?? existing.createRule,
    updateRule: payload.updateRule ?? existing.updateRule,
    deleteRule: payload.deleteRule ?? existing.deleteRule,
    fields: mergedFields,
    indexes: mergedIndexes,
  };

  return fetchJson(`${pocketbaseUrl}/api/collections/${existing.id}`, {
    method: "PATCH",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });
}

async function updateCollection(token, payload) {
  return fetchJson(`${pocketbaseUrl}/api/collections/${payload.id}`, {
    method: "PATCH",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function textField(name, { required = false } = {}) {
  return {
    name,
    type: "text",
    required,
    presentable: false,
    min: 0,
    max: 0,
    pattern: "",
    autogeneratePattern: "",
    hidden: false,
    system: false,
  };
}

function numberField(name, { required = false } = {}) {
  return {
    name,
    type: "number",
    required,
    presentable: false,
    min: null,
    max: null,
    onlyInt: false,
    hidden: false,
    system: false,
  };
}

function dateField(name, { required = false } = {}) {
  return {
    name,
    type: "date",
    required,
    presentable: false,
    min: "",
    max: "",
    hidden: false,
    system: false,
  };
}

function boolField(name, { required = false } = {}) {
  return {
    name,
    type: "bool",
    required,
    presentable: false,
    hidden: false,
    system: false,
  };
}

function relationField(name, collectionId, { required = false } = {}) {
  return {
    name,
    type: "relation",
    required,
    presentable: false,
    collectionId,
    cascadeDelete: false,
    minSelect: required ? 1 : 0,
    maxSelect: 1,
    hidden: false,
    system: false,
  };
}

async function ensureSchema(token) {
  const userRule = '@request.auth.id != "" && user_id = @request.auth.id';

  await upsertCollection(token, {
    name: "statements",
    type: "base",
    system: false,
    listRule: userRule,
    viewRule: userRule,
    createRule: userRule,
    updateRule: userRule,
    deleteRule: userRule,
    fields: [
      relationField("user_id", "_pb_users_auth_", { required: true }),
      textField("checksum", { required: true }),
      textField("file_name", { required: true }),
      textField("status", { required: true }),
      textField("blob_url", { required: true }),
      textField("bank_name"),
      dateField("period_start"),
      dateField("period_end"),
      dateField("created_at"),
      dateField("updated_at"),
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_statements_user_id ON statements (user_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_statements_user_checksum ON statements (user_id, checksum)",
    ],
  });

  await upsertCollection(token, {
    name: "categories",
    type: "base",
    system: false,
    listRule: userRule,
    viewRule: userRule,
    createRule: userRule,
    updateRule: userRule,
    deleteRule: userRule,
    fields: [
      relationField("user_id", "_pb_users_auth_", { required: true }),
      textField("name", { required: true }),
      textField("description"),
      boolField("is_default", { required: false }),
      dateField("created_at"),
      dateField("updated_at"),
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories (user_id)",
      "CREATE INDEX IF NOT EXISTS idx_categories_name ON categories (lower(name))",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_user_category_name ON categories (user_id, lower(name))",
    ],
  });

  await upsertCollection(token, {
    name: "default_categories",
    type: "base",
    system: false,
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [textField("name", { required: true }), textField("description")],
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_default_categories_name ON default_categories (lower(name))",
    ],
  });

  await upsertCollection(token, {
    name: "merchant_mappings",
    type: "base",
    system: false,
    listRule: userRule,
    viewRule: userRule,
    createRule: userRule,
    updateRule: userRule,
    deleteRule: userRule,
    fields: [
      relationField("user_id", "_pb_users_auth_", { required: true }),
      textField("merchant_name", { required: true }),
      textField("category", { required: true }),
      dateField("created_at"),
      dateField("updated_at"),
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_merchant_mappings_user_id ON merchant_mappings (user_id)",
      "CREATE INDEX IF NOT EXISTS idx_merchant_mappings_merchant_name ON merchant_mappings (merchant_name)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_mappings_unique ON merchant_mappings (user_id, merchant_name)",
    ],
  });

  await upsertCollection(token, {
    name: "expenses",
    type: "base",
    system: false,
    fields: [
      textField("category_id"),
      textField("category_text"),
      dateField("created_at"),
      numberField("original_amount"),
      textField("original_currency"),
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses (user_id)",
      "CREATE INDEX IF NOT EXISTS idx_expenses_statement_id ON expenses (statement_id)",
      "CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses (category_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_user_line_hash ON expenses (user_id, line_hash)",
    ],
  });

  const categories = await getCollection(token, "categories");
  const statements = await getCollection(token, "statements");
  const expenses = await getCollection(token, "expenses");

  if (!categories || !statements || !expenses) {
    throw new Error("Missing collections for relation setup.");
  }

  let updated = false;
  const fields = [...(expenses.fields || [])];

  const ensureRelation = (name, collectionId) => {
    const index = fields.findIndex((field) => field.name === name);
    if (index !== -1 && fields[index].type === "relation") {
      const desired = relationField(name, collectionId, { required: false });
      fields[index] = {
        ...fields[index],
        ...desired,
        id: fields[index].id,
        type: fields[index].type,
      };
      if (fields[index].collectionId !== collectionId) {
        fields[index].collectionId = collectionId;
        updated = true;
      }
      return;
    }

    if (index !== -1) {
      fields.splice(index, 1);
      updated = true;
    }

    fields.push(relationField(name, collectionId, { required: false }));
    updated = true;
  };

  ensureRelation("category_id", categories.id);
  ensureRelation("statement_id", statements.id);

  if (updated) {
    await updateCollection(token, {
      ...expenses,
      fields,
    });
  }
}

async function listPocketbaseRecords(token, collection, filter) {
  const params = new URLSearchParams();
  params.set("perPage", "200");
  if (filter) params.set("filter", filter);
  const url = `${pocketbaseUrl}/api/collections/${collection}/records?${params}`;
  return fetchJson(url, { headers: { Authorization: token } });
}

async function createPocketbaseRecord(token, collection, data) {
  const url = `${pocketbaseUrl}/api/collections/${collection}/records`;
  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

async function deletePocketbaseRecord(token, collection, id) {
  const url = `${pocketbaseUrl}/api/collections/${collection}/records/${id}`;
  await fetchJson(url, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

function escapeFilter(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function createPocketbaseRecordWithFallback(
  token,
  collection,
  data,
  filter
) {
  let created;
  let createError;
  try {
    created = await createPocketbaseRecord(token, collection, data);
  } catch (error) {
    createError = error;
  }
  if (created?.id) return created.id;

  const existing = await listPocketbaseRecords(token, collection, filter);
  const record = existing.items?.[0];
  if (!record) {
    const errorMessage =
      createError instanceof Error ? createError.message : "unknown error";
    throw new Error(`Failed to create ${collection} record: ${errorMessage}`);
  }
  return record.id;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function wipeCollection(token, collection) {
  const list = await listPocketbaseRecords(token, collection);
  for (const record of list.items || []) {
    await deletePocketbaseRecord(token, collection, record.id);
  }
}

async function fetchAllSupabase(table, filterUserId) {
  const pageSize = 1000;
  let offset = 0;
  const results = [];

  while (true) {
    let query = supabase
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1);
    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;

    results.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

async function getPocketbaseUserId(token) {
  if (PB_USER_EMAIL) {
    const list = await listPocketbaseRecords(
      token,
      "users",
      `email = "${escapeFilter(PB_USER_EMAIL)}"`
    );
    const record = list.items?.[0];
    if (!record) {
      throw new Error(`No PocketBase user for ${PB_USER_EMAIL}`);
    }
    return record.id;
  }

  const list = await listPocketbaseRecords(token, "users");
  if ((list.items || []).length !== 1) {
    throw new Error(
      "Multiple PocketBase users found. Set PB_USER_EMAIL to choose one."
    );
  }
  return list.items[0].id;
}

async function getSupabaseUserId(targetEmail) {
  if (SUPABASE_USER_ID) return SUPABASE_USER_ID;
  if (!targetEmail) {
    throw new Error("Provide PB_USER_EMAIL or SUPABASE_USER_ID");
  }

  try {
    const { data, error } = await supabase.auth.admin.listUsers({
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find((user) => user.email === targetEmail);
    if (match) return match.id;
  } catch (_error) {
    console.warn("Supabase admin listUsers failed, falling back to inference.");
  }

  const tablesToCheck = [
    "expenses",
    "statements",
    "categories",
    "merchant_mappings",
  ];
  for (const table of tablesToCheck) {
    const { data, error } = await supabase
      .from(table)
      .select("user_id")
      .limit(1);
    if (error || !data?.length) continue;
    if (data[0]?.user_id) return data[0].user_id;
  }

  throw new Error(
    "Unable to resolve Supabase user id. Set SUPABASE_USER_ID explicitly."
  );
}

async function main() {
  const token = await authPocketBase();
  await ensureSchema(token);

  const pbUserId = await getPocketbaseUserId(token);
  const pbUser = await listPocketbaseRecords(
    token,
    "users",
    `id = "${pbUserId}"`
  );
  const pbUserEmail = pbUser.items?.[0]?.email || PB_USER_EMAIL || "";
  const supabaseUserId = await getSupabaseUserId(pbUserEmail);

  console.log("PocketBase URL:", pocketbaseUrl);
  console.log("Supabase URL:", supabaseUrl);
  console.log("PB user id:", pbUserId);
  console.log("Supabase user id:", supabaseUserId);

  if (WIPE) {
    console.log("Wiping PocketBase collections...");
    await wipeCollection(token, "expenses");
    await wipeCollection(token, "statements");
    await wipeCollection(token, "merchant_mappings");
    await wipeCollection(token, "categories");
    await wipeCollection(token, "default_categories");
  }

  const defaultCategories = await fetchAllSupabase("default_categories");

  const defaultCategoryByName = new Map();
  for (const category of defaultCategories || []) {
    const existing = await listPocketbaseRecords(
      token,
      "default_categories",
      `name = "${escapeFilter(category.name)}"`
    );
    const record = existing.items?.[0];
    if (record) {
      defaultCategoryByName.set(category.name, record.id);
      continue;
    }
    const createdId = await createPocketbaseRecordWithFallback(
      token,
      "default_categories",
      {
        name: category.name,
        description: category.description ?? null,
      },
      `name = "${escapeFilter(category.name)}"`
    );
    defaultCategoryByName.set(category.name, createdId);
  }

  const categories = await fetchAllSupabase("categories", supabaseUserId);

  const categoryMap = new Map();
  for (const category of categories || []) {
    const categoryFilter = `user_id = "${pbUserId}" && name = "${escapeFilter(
      category.name
    )}"`;
    const existing = await listPocketbaseRecords(
      token,
      "categories",
      categoryFilter
    );
    const record = existing.items?.[0];
    if (record) {
      categoryMap.set(category.id, record.id);
      continue;
    }
    const createdId = await createPocketbaseRecordWithFallback(
      token,
      "categories",
      {
        user_id: pbUserId,
        name: category.name,
        description: category.description ?? null,
        is_default: category.is_default ?? false,
        created_at: category.created_at,
        updated_at: category.updated_at,
      },
      categoryFilter
    );
    categoryMap.set(category.id, createdId);
  }

  const statements = await fetchAllSupabase("statements", supabaseUserId);

  const statementMap = new Map();
  for (const statement of statements || []) {
    const statementFilter = `user_id = "${pbUserId}" && checksum = "${escapeFilter(
      statement.checksum
    )}"`;
    const existing = await listPocketbaseRecords(
      token,
      "statements",
      statementFilter
    );
    const record = existing.items?.[0];
    if (record) {
      statementMap.set(statement.id, record.id);
      continue;
    }

    const createdId = await createPocketbaseRecordWithFallback(
      token,
      "statements",
      {
        user_id: pbUserId,
        checksum: statement.checksum,
        file_name: statement.file_name,
        status: statement.status ?? "processing",
        blob_url: statement.blob_url,
        bank_name: statement.bank_name ?? null,
        period_start: statement.period_start ?? null,
        period_end: statement.period_end ?? null,
        created_at: statement.created_at,
        updated_at: statement.updated_at,
      },
      statementFilter
    );
    statementMap.set(statement.id, createdId);
  }

  const merchantMappings = await fetchAllSupabase(
    "merchant_mappings",
    supabaseUserId
  );

  for (const mapping of merchantMappings || []) {
    const existing = await listPocketbaseRecords(
      token,
      "merchant_mappings",
      `user_id = "${pbUserId}" && merchant_name = "${escapeFilter(mapping.merchant_name)}"`
    );
    if (existing.items?.[0]) continue;
    await createPocketbaseRecord(token, "merchant_mappings", {
      user_id: pbUserId,
      merchant_name: mapping.merchant_name,
      category: mapping.category,
      created_at: mapping.created_at,
      updated_at: mapping.updated_at,
    });
  }

  const expenses = await fetchAllSupabase("expenses", supabaseUserId);

  for (const expense of expenses || []) {
    const existing = await listPocketbaseRecords(
      token,
      "expenses",
      `user_id = "${pbUserId}" && line_hash = "${escapeFilter(expense.line_hash)}"`
    );
    if (existing.items?.[0]) continue;

    const pbStatementId = expense.statement_id
      ? statementMap.get(expense.statement_id) || expense.statement_id
      : null;
    const pbCategoryId = expense.category_id
      ? categoryMap.get(expense.category_id) || expense.category_id
      : null;

    await createPocketbaseRecord(token, "expenses", {
      user_id: pbUserId,
      statement_id: pbStatementId,
      category_id: pbCategoryId,
      category_text: expense.category_text ?? expense.category ?? null,
      created_at: expense.created_at,
      date: expense.date,
      description: expense.description,
      amount_sgd: toNumber(expense.amount_sgd),
      currency: expense.currency ?? "SGD",
      foreign_amount: toNumber(expense.foreign_amount),
      foreign_currency: expense.foreign_currency ?? null,
      original_amount: toNumber(expense.original_amount),
      original_currency: expense.original_currency ?? null,
      merchant: expense.merchant ?? null,
      category: expense.category,
      line_hash: expense.line_hash,
    });
  }

  console.log("Migration complete.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
