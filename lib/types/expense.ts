import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "Dining",
  "Groceries",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Bills & Utilities",
  "Healthcare",
  "Education",
  "Travel",
  "Other",
] as const;

export const CURRENCIES = [
  "SGD",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "JPY",
  "CNY",
  "HKD",
  "MYR",
  "THB",
  "IDR",
  "PHP",
  "VND",
  "KRW",
  "TWD",
  "INR",
] as const;

export type Currency = (typeof CURRENCIES)[number];

// Zod schemas for validation
export const databaseExpenseRowSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  statement_id: z.string().min(1),
  created_at: z.string(),
  date: z.string(),
  description: z.string(),
  amount_sgd: z.number(),
  currency: z.string().default("SGD"),
  foreign_amount: z.number().nullable(),
  foreign_currency: z.string().nullable(),
  original_amount: z.number().nullable(),
  original_currency: z.string().nullable(),
  merchant: z.string().nullable(),
  category: z.string(),
  line_hash: z.string(),
});

export const displayExpenseSchema = z.object({
  id: z.string().min(1),
  date: z.string(),
  description: z.string(),
  merchant: z.string(),
  category: z.string(),
  amount: z.number(),
  originalAmount: z.number(),
  originalCurrency: z.string(),
  currency: z.string(),
  createdAt: z.string(),
});

export const aiExpenseSchema = z.object({
  date: z.string(),
  description: z.string(),
  merchant: z.string(),
  category: z.string(),
  original_amount: z.number(),
  original_currency: z.string(),
  amount_sgd: z.number().optional(),
});

/**
 * Create dynamic AI expense schema with category validation
 */
export function createAiExpenseSchema(validCategories: string[]) {
  return z.object({
    date: z.string(),
    description: z.string(),
    merchant: z.string(),
    category: z
      .string()
      .refine((cat) => validCategories.includes(cat) || cat === "Other", {
        message: "Invalid category, defaulting to Other",
      })
      .transform((cat) => (validCategories.includes(cat) ? cat : "Other")),
    original_amount: z.number(),
    original_currency: z.string(),
  });
}

export const expenseInsertDataSchema = z.object({
  statement_id: z.string().min(1),
  user_id: z.string().min(1),
  date: z.string(),
  description: z.string(),
  merchant: z.string().optional(),
  amount_sgd: z.number(),
  original_amount: z.number(),
  original_currency: z.string(),
  currency: z.string(),
  category: z.string(), // Still accept category name during transition
  category_id: z.string().min(1).optional(), // New category ID field
  line_hash: z.string(),
});

// Display format (camelCase for frontend)
export interface DisplayExpense {
  id: string;
  date: string;
  description: string;
  merchant: string;
  category: string;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  currency: string;
  createdAt: string;
}

// Display expense with duplicate flag for table
export interface DisplayExpenseWithDuplicate extends DisplayExpense {
  isDuplicate: boolean;
}

// AI input type
export interface AIExpenseInput {
  date: string;
  description: string;
  merchant: string;
  category: string;
  original_amount: number;
  original_currency: string;
}

// Database insert type
export interface ExpenseInsertData {
  statement_id: string;
  user_id: string;
  date: string;
  description: string;
  merchant?: string;
  amount_sgd: number;
  original_amount: number;
  original_currency: string;
  currency: string;
  category: string; // Still needed during transition
  category_id?: string; // New category ID field
  line_hash: string;
}

// Statement status for upload functionality
export type StatementStatus = "processing" | "completed" | "failed";

// Upload result type
export interface UploadResult {
  success: boolean;
  error?: string;
  message?: string;
  statementId?: string;
}

// Form data types
export interface ExpenseFormData {
  description: string;
  merchant: string;
  category: string;
  amount: string;
  originalAmount: string;
  originalCurrency: string;
  date: string;
}

export interface ExpenseUpdateData {
  description: string;
  merchant: string;
  category: string;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  date: string;
}

// Realtime payload schemas for Supabase events
export const realtimeInsertPayloadSchema = databaseExpenseRowSchema;
export const realtimeUpdatePayloadSchema = databaseExpenseRowSchema
  .partial()
  .extend({
    id: z.string().min(1), // ID is always present in updates
  });
export const realtimeDeletePayloadSchema = z.object({
  id: z.string().min(1),
  // May include other fields that Supabase sends in DELETE events
});

// Merchant mapping schemas
export const merchantMappingSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  merchant_name: z.string(),
  category: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const merchantMappingInsertSchema = z.object({
  user_id: z.string().min(1),
  merchant_name: z.string(),
  category: z.string(),
});

export const merchantMappingUpdateSchema = z.object({
  category: z.string(),
});

// Merchant mapping interfaces
export interface MerchantMapping {
  id: string;
  user_id: string;
  merchant_name: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface MerchantMappingInsert {
  user_id: string;
  merchant_name: string;
  category: string;
}

export interface MerchantMappingUpdate {
  category: string;
}

// Type guards and helpers
export type DatabaseExpenseRow = z.infer<typeof databaseExpenseRowSchema>;
export type RealtimeInsertPayload = z.infer<typeof realtimeInsertPayloadSchema>;
export type RealtimeUpdatePayload = z.infer<typeof realtimeUpdatePayloadSchema>;
export type RealtimeDeletePayload = z.infer<typeof realtimeDeletePayloadSchema>;
