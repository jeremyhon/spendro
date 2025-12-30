import crypto from "node:crypto";
import { getOrCreateCategoryByName } from "@/app/actions/categories";
import { createPocketbaseServerClient } from "@/lib/pocketbase/server";
import type {
  AIExpenseInput,
  ExpenseInsertData,
  StatementStatus,
} from "@/lib/types/expense";
import { extractExpensesFromPdf } from "@/lib/utils/ai-processor";
import { convertToSGD } from "@/lib/utils/currency";
import {
  transformAIInputToInsert,
  validateExpenseInsert,
} from "@/lib/utils/expense-transformers";
import { getMerchantMapping } from "@/lib/utils/merchant-mappings";

/**
 * Create a hash for expense deduplication
 */
function createExpenseHash(
  date: string,
  description: string,
  amount: number
): string {
  return crypto
    .createHash("sha256")
    .update(`${date}-${description}-${amount}`)
    .digest("hex");
}

/**
 * Convert expense input to database record with validation
 */
async function convertExpenseToRecord(
  expense: AIExpenseInput,
  statementId: string,
  userId: string
): Promise<ExpenseInsertData> {
  const currencyResult = await convertToSGD(
    expense.original_amount,
    expense.original_currency,
    expense.date
  );

  const amountSgd = currencyResult.convertedAmount;
  const lineHash = createExpenseHash(
    expense.date,
    expense.description,
    amountSgd
  );

  // Foreign transactions automatically categorized as "Travel" (existing logic)
  let finalCategory =
    expense.original_currency !== "SGD" ? "Travel" : expense.category;

  // Check for existing merchant mapping and override category if found
  if (expense.merchant) {
    const merchantMapping = await getMerchantMapping(userId, expense.merchant);
    if (merchantMapping) {
      finalCategory = merchantMapping.category;
    }
  }

  // Create expense with potentially overridden category
  const expenseWithMapping = {
    ...expense,
    category: finalCategory,
  };

  // Get category ID for the category name
  const categoryId = await getOrCreateCategoryByName(finalCategory, userId);

  // Use transformer with validation
  const insertData = transformAIInputToInsert(
    expenseWithMapping,
    statementId,
    userId,
    amountSgd,
    lineHash,
    categoryId
  );

  // Add category ID to the insert data
  return {
    ...insertData,
    category_id: categoryId,
  };
}

/**
 * Insert expense record into database with validation
 */
async function insertExpenseRecord(
  pb: Awaited<ReturnType<typeof createPocketbaseServerClient>>,
  expenseRecord: ExpenseInsertData
): Promise<boolean> {
  // Validate before inserting
  const validatedRecord = validateExpenseInsert(expenseRecord);

  try {
    await pb.collection("expenses").create(validatedRecord);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to insert expense";
    if (message.toLowerCase().includes("unique")) {
      return false;
    }
    console.warn("Failed to insert expense:", message);
    return false;
  }

  return true;
}

/**
 * Update statement status in database
 */
async function updateStatementStatus(
  pb: Awaited<ReturnType<typeof createPocketbaseServerClient>>,
  statementId: string,
  status: StatementStatus
): Promise<void> {
  await pb.collection("statements").update(statementId, { status });
}

/**
 * Process PDF and extract expenses with real-time insertion
 */
export async function processPdfExpenses(
  fileBuffer: Buffer,
  statementId: string,
  userId: string
): Promise<void> {
  const pb = await createPocketbaseServerClient();
  let expenseCount = 0;

  try {
    // Fetch user categories for AI processing
    const userCategories = await pb.collection("categories").getFullList<{
      name: string;
    }>({
      filter: `user_id = "${userId}"`,
    });
    const categoryNames = userCategories.map((cat) => cat.name);

    // Extract expenses from PDF using AI
    for await (const expense of extractExpensesFromPdf(
      fileBuffer,
      categoryNames
    )) {
      expenseCount++;

      // Convert to database record
      const expenseRecord = await convertExpenseToRecord(
        expense,
        statementId,
        userId
      );

      // Insert immediately for real-time processing
      await insertExpenseRecord(pb, expenseRecord);
    }

    if (expenseCount === 0) {
      throw new Error("AI failed to extract any transactions.");
    }

    console.log(
      `Processed ${expenseCount} expenses for statement ${statementId}`
    );

    // Mark statement as completed
    await updateStatementStatus(pb, statementId, "completed");
  } catch (error) {
    console.error(`Processing failed for statement ${statementId}:`, error);
    await updateStatementStatus(pb, statementId, "failed");
    throw error;
  }
}
