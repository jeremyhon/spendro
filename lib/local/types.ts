export type StatementStatus = "processing" | "completed" | "failed";

export type ParseMode = "agent" | "embedded";

export type ParseStatus = "success" | "failed";

export interface StatementRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  fileName: string;
  filePath: string;
  status: StatementStatus;
  bankName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface StatementTextRecord {
  id: string;
  statementId: string;
  createdAt: string;
  source: string;
  rawText: string;
}

export interface ParseRunRecord {
  id: string;
  statementId: string;
  createdAt: string;
  mode: ParseMode;
  status: ParseStatus;
  parserVersion: string;
  errorMessage: string | null;
  transactionCount: number;
}

export interface CategoryRecord {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionRecord {
  id: string;
  statementId: string;
  parseRunId: string | null;
  postedOn: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isHidden: boolean;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedTransactionInput {
  postedOn: string;
  description: string;
  merchant?: string | null;
  category?: string | null;
  amount: number;
  currency?: string;
}

export interface StoreStatementInput {
  filePath: string;
  bankName?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface AddStatementTextInput {
  statementId: string;
  filePath: string;
  source?: string;
}

export interface AddCategoryInput {
  name: string;
  description?: string;
}

export interface ParseResult {
  parseRun: ParseRunRecord;
  insertedTransactions: number;
}

export type AccountProductType = "card" | "account" | "other";

export interface AccountRecord {
  id: string;
  institution: string;
  productType: AccountProductType;
  accountLabel: string;
  last4: string | null;
  dedupeKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StatementCoverageRecord {
  statementId: string;
  accountId: string;
  statementMonth: string;
  inferredBy: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface StatementCoverageOverrideRecord {
  statementId: string;
  institution: string;
  productType: AccountProductType;
  accountLabel: string;
  last4: string | null;
  statementMonth: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertStatementCoverageOverrideInput {
  statementId: string;
  institution: string;
  productType: AccountProductType;
  accountLabel: string;
  last4?: string | null;
  statementMonth: string;
  reason?: string;
}

export interface MissingStatementGapRecord {
  account: AccountRecord;
  asOfMonth: string;
  firstObservedMonth: string;
  observedMonths: string[];
  missingMonths: string[];
}

export type CategorizationRuleAction = "categorize" | "hide" | "ignore";

export type CategorizationRuleMatchField = "merchant" | "description";

export type CategorizationRuleMatchType = "exact" | "contains" | "regex";

export interface CategorizationRuleRecord {
  id: string;
  action: CategorizationRuleAction;
  matchField: CategorizationRuleMatchField;
  matchType: CategorizationRuleMatchType;
  pattern: string;
  normalizedPattern: string;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  priority: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddCategorizationRuleInput {
  action: CategorizationRuleAction;
  matchField: CategorizationRuleMatchField;
  matchType: CategorizationRuleMatchType;
  pattern: string;
  categoryName?: string;
  accountId?: string | null;
  priority?: number;
  isActive?: boolean;
  notes?: string;
}

export interface RemoveCategorizationRuleResult {
  ruleId: string;
  removed: boolean;
}

export interface CategorizationRuleTestInput {
  description: string;
  merchant?: string | null;
  accountId?: string | null;
}

export interface CategorizationRuleTestResult {
  matched: boolean;
  rule: CategorizationRuleRecord | null;
}
