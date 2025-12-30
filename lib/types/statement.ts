// Statement status enum
export type StatementStatus = "processing" | "completed" | "failed";

// Database statement structure (snake_case)
export interface DatabaseStatement {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  checksum: string;
  file_name: string;
  status: StatementStatus;
  blob_url: string;
  bank_name: string | null;
  period_start: string | null;
  period_end: string | null;
}

// Display statement structure (camelCase)
export interface Statement {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  fileName: string;
  status: StatementStatus;
  blobUrl: string;
  bankName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

// Transform database format to display format
export function transformDatabaseToDisplay(
  statement: DatabaseStatement
): Statement {
  return {
    id: statement.id,
    userId: statement.user_id,
    createdAt: statement.created_at,
    updatedAt: statement.updated_at,
    checksum: statement.checksum,
    fileName: statement.file_name,
    status: statement.status,
    blobUrl: statement.blob_url,
    bankName: statement.bank_name,
    periodStart: statement.period_start,
    periodEnd: statement.period_end,
  };
}

// Minimal statement for status tracking (reduces bandwidth)
export interface StatementStatusData {
  id: string;
  fileName: string;
  status: StatementStatus;
  updatedAt: string;
}

export function transformDatabaseToStatusDisplay(statement: {
  id: string;
  file_name: string;
  status: StatementStatus;
  updated_at: string;
}): StatementStatusData {
  return {
    id: statement.id,
    fileName: statement.file_name,
    status: statement.status,
    updatedAt: statement.updated_at,
  };
}
