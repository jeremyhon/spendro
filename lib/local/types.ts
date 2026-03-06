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
