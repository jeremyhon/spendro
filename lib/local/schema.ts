const DEFAULT_CATEGORY_ROWS = [
  {
    name: "Dining",
    description: "Restaurants, cafes, food delivery",
  },
  {
    name: "Groceries",
    description: "Supermarkets, grocery stores, food shopping",
  },
  {
    name: "Transportation",
    description: "Public transport, taxis, fuel, parking",
  },
  {
    name: "Shopping",
    description: "Retail, clothing, electronics, general merchandise",
  },
  {
    name: "Entertainment",
    description: "Movies, games, streaming, events, hobbies",
  },
  {
    name: "Bills & Utilities",
    description: "Utilities, phone, internet, insurance, subscriptions",
  },
  {
    name: "Healthcare",
    description: "Medical, dental, pharmacy, fitness, wellness",
  },
  {
    name: "Education",
    description: "Schools, courses, books, educational materials",
  },
  {
    name: "Travel",
    description: "Hotels, flights, foreign transactions, travel expenses",
  },
  {
    name: "Other",
    description: "Miscellaneous expenses",
  },
] as const;

export const LOCAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  checksum TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  bank_name TEXT,
  period_start TEXT,
  period_end TEXT
);

CREATE TABLE IF NOT EXISTS statement_texts (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_statement_texts_statement_created
  ON statement_texts(statement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS parse_runs (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('agent', 'embedded')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  parser_version TEXT NOT NULL,
  error_message TEXT,
  transaction_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_parse_runs_statement_created
  ON parse_runs(statement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  institution TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('card', 'account', 'other')),
  account_label TEXT NOT NULL,
  last4 TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_institution
  ON accounts(institution);

CREATE TABLE IF NOT EXISTS statement_account_months (
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_month TEXT NOT NULL,
  inferred_by TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (statement_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_statement_account_months_account_month
  ON statement_account_months(account_id, statement_month);

CREATE TABLE IF NOT EXISTS statement_account_overrides (
  statement_id TEXT PRIMARY KEY REFERENCES statements(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('card', 'account', 'other')),
  account_label TEXT NOT NULL,
  last4 TEXT,
  statement_month TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_statement_account_overrides_statement_month
  ON statement_account_overrides(statement_month);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  parse_run_id TEXT REFERENCES parse_runs(id) ON DELETE SET NULL,
  posted_on TEXT NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SGD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_statement
  ON transactions(statement_id);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions(category_id);
`;

export type DefaultCategoryRow = (typeof DEFAULT_CATEGORY_ROWS)[number];

export const DEFAULT_LOCAL_CATEGORIES: readonly DefaultCategoryRow[] =
  DEFAULT_CATEGORY_ROWS;
