import { google } from "@ai-sdk/google";
import { generateObject, streamObject } from "ai";
import { z } from "zod";

import {
  type AIExpenseInput,
  createAiExpenseSchema,
} from "@/lib/types/expense";

const DEFAULT_MODEL = "gemini-2.5-flash";

function resolveModel(modelName?: string) {
  return google(modelName ?? DEFAULT_MODEL);
}

/**
 * Generate dynamic AI prompt for expense extraction from statements.
 */
function generateExpenseExtractionPrompt(userCategories: string[]): string {
  const categoriesText = userCategories.join(", ");

  return `You are a financial data extraction expert. Analyze this bank statement and extract ALL transaction expenses (outgoing payments, purchases, debits).

WHAT TO INCLUDE:
- Purchases from merchants, stores, restaurants
- Bill payments (utilities, phone, insurance)
- ATM withdrawals and bank fees
- Subscription services
- Online purchases and payments
- Foreign currency transactions

WHAT TO EXCLUDE:
- Deposits, credits, salary payments (money coming in)
- Transfers between accounts (containing: "Transfer", "TRANSFER", "Tfr", "TFR", "To:", "From:", "Savings", "Investment", "Own Account")
- Interest earned or dividends
- Refunds or reversals (unless they represent a net expense)
- Duplicate transactions or pending transactions

EXTRACTION FORMAT:
1. date: Use YYYY-MM-DD format, extract the posted/cleared date (not pending)
2. description: Keep concise but informative (e.g., "Coffee purchase" not "VISA PURCHASE 123456")
3. merchant: Clean up names by removing unnecessary codes, reference numbers, and extra whitespace
4. category: Use one of these categories: ${categoriesText}; if uncertain, use "Other"
5. original_amount: The amount of the transaction before any currency conversion
6. original_currency: The original 3-letter currency code (e.g., SGD, USD). If not shown, use SGD.

QUALITY CHECKS:
- Verify each transaction is a genuine expense (money leaving the account)
- Ensure dates are valid and properly formatted
- Check that amounts are reasonable and positive
- Confirm currency codes are valid 3-letter codes (SGD, USD, EUR, etc.)
- Validate categories match the available options exactly`;
}

/**
 * Create a permissive union schema with three options:
 * 1. Original strict schema
 * 2. String schema that parses JSON and transforms to original schema
 * 3. Permissive schema that accepts any object shape
 */
function createPermissiveExpenseSchema(userCategories: string[]) {
  const originalSchema = createAiExpenseSchema(userCategories);

  const stringSchema = z.string().transform((data) => {
    try {
      const parsed = JSON.parse(data);

      const result = originalSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }

      return {
        date: String(parsed.date || ""),
        description: String(parsed.description || ""),
        merchant: String(parsed.merchant || ""),
        category: userCategories.includes(String(parsed.category))
          ? String(parsed.category)
          : "Other",
        original_amount: Number(parsed.original_amount) || 0,
        original_currency: String(parsed.original_currency || "SGD"),
      };
    } catch {
      return {
        date: "",
        description: "Invalid JSON",
        merchant: "",
        category: "Other",
        original_amount: 0,
        original_currency: "SGD",
      };
    }
  });

  const permissiveSchema = z.any().transform((data) => {
    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;

      return {
        date: String(record.date || ""),
        description: String(record.description || ""),
        merchant: String(record.merchant || ""),
        category: userCategories.includes(String(record.category))
          ? String(record.category)
          : "Other",
        original_amount: Number(record.original_amount) || 0,
        original_currency: String(record.original_currency || "SGD"),
      };
    }

    return {
      date: "",
      description: "Unknown data type",
      merchant: "",
      category: "Other",
      original_amount: 0,
      original_currency: "SGD",
    };
  });

  return z.union([originalSchema, stringSchema, permissiveSchema]);
}

async function collectExpenseStream(
  elementStream: AsyncIterable<unknown>
): Promise<AIExpenseInput[]> {
  const expenses: AIExpenseInput[] = [];

  for await (const element of elementStream) {
    if (element) {
      expenses.push(element as AIExpenseInput);
    }
  }

  return expenses;
}

export async function extractExpensesFromStatementText(
  statementText: string,
  userCategories: string[],
  modelName?: string
): Promise<AIExpenseInput[]> {
  const prompt = generateExpenseExtractionPrompt(userCategories);

  const { object } = await generateObject({
    model: resolveModel(modelName),
    schema: z.array(createPermissiveExpenseSchema(userCategories)),
    prompt: `${prompt}\n\nSTATEMENT TEXT:\n${statementText}`,
  });

  return object as AIExpenseInput[];
}

export async function* extractExpensesFromPdf(
  fileBuffer: Buffer,
  userCategories: string[],
  modelName?: string
): AsyncGenerator<AIExpenseInput, void, unknown> {
  const base64Pdf = fileBuffer.toString("base64");
  const prompt = generateExpenseExtractionPrompt(userCategories);

  const { elementStream } = streamObject({
    model: resolveModel(modelName),
    output: "array",
    schema: createPermissiveExpenseSchema(userCategories),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "file",
            data: base64Pdf,
            mediaType: "application/pdf",
          },
        ],
      },
    ],
  });

  const expenses = await collectExpenseStream(elementStream);
  for (const expense of expenses) {
    yield expense;
  }
}
