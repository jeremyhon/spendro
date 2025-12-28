import { google } from "@ai-sdk/google";
import { streamObject } from "ai";
import { z } from "zod";
import {
  type AIExpenseInput,
  createAiExpenseSchema,
} from "@/lib/types/expense";

/**
 * Generate dynamic AI prompt for expense extraction from PDF statements
 */
function generateExpenseExtractionPrompt(userCategories: string[]): string {
  const categoriesText = userCategories.join(", ");

  return `You are a financial data extraction expert. Analyze this bank statement PDF and extract ALL transaction expenses (outgoing payments, purchases, debits).

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
2. description: Keep concise but informative (e.g., "Coffee purchase" not "VISA PURCHASE 123456"),
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
 * Process PDF buffer and extract expenses using AI
 * @param fileBuffer - PDF file buffer
 * @param userCategories - User's custom categories
 * @returns AsyncGenerator<ExpenseInput> - Stream of extracted expenses
 */
/**
 * Create a permissive union schema with three options:
 * 1. Original strict schema
 * 2. String schema that parses JSON and transforms to original schema
 * 3. Permissive schema that accepts anything
 */
function createPermissiveExpenseSchema(userCategories: string[]) {
  const originalSchema = createAiExpenseSchema(userCategories);

  const stringSchema = z.string().transform((data) => {
    console.log(
      "🔍 Received JSON string, parsing:",
      `${data.substring(0, 100)}...`
    );

    try {
      const parsed = JSON.parse(data);
      console.log("✅ Parsed JSON:", JSON.stringify(parsed, null, 2));

      // Try to validate with original schema
      const result = originalSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      console.log(
        "❌ Parsed JSON failed original schema, coercing:",
        result.error.issues
      );
      // Coerce to valid format
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
    } catch (error) {
      console.log("❌ Failed to parse JSON string:", error);
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
    console.log(
      "🔍 Permissive schema, received data:",
      JSON.stringify(data, null, 2)
    );

    // Try to coerce any data into valid format
    if (typeof data === "object" && data !== null) {
      return {
        date: String(data.date || ""),
        description: String(data.description || ""),
        merchant: String(data.merchant || ""),
        category: userCategories.includes(String(data.category))
          ? String(data.category)
          : "Other",
        original_amount: Number(data.original_amount) || 0,
        original_currency: String(data.original_currency || "SGD"),
      };
    }

    // Fallback for non-objects
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

export async function* extractExpensesFromPdf(
  fileBuffer: Buffer,
  userCategories: string[]
): AsyncGenerator<AIExpenseInput, void, unknown> {
  const base64Pdf = fileBuffer.toString("base64");
  const prompt = generateExpenseExtractionPrompt(userCategories);

  try {
    const { elementStream } = streamObject({
      model: google("gemini-2.5-flash"),
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

    for await (const element of elementStream) {
      if (element) {
        console.log("✅ Yielding element:", JSON.stringify(element, null, 2));
        yield element as AIExpenseInput;
      }
    }
  } catch (error) {
    console.error("❌ Error in AI extraction:", error);
    throw error;
  }
}
