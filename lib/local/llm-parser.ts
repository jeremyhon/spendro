import type { ParsedTransactionInput } from "@/lib/local/types";
import { extractExpensesFromStatementText } from "@/lib/utils/ai-processor";

function normalizeDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new Error(
      `Unsupported date format "${value}". Expected YYYY-MM-DD or DD/MM/YYYY.`
    );
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function normalizeCurrency(value: string): string {
  if (!value) {
    return "SGD";
  }

  return value.toUpperCase();
}

export async function parseTransactionsWithEmbeddedLlm(
  rawText: string,
  categoryNames: string[]
): Promise<ParsedTransactionInput[]> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY for embedded LLM parsing."
    );
  }

  const normalizedCategories = Array.from(new Set(categoryNames));
  if (!normalizedCategories.includes("Other")) {
    normalizedCategories.push("Other");
  }

  const model = process.env.SPENDRO_LOCAL_LLM_MODEL;
  const expenses = await extractExpensesFromStatementText(
    rawText,
    normalizedCategories,
    model
  );

  const transactions = expenses.map((expense) => {
    const normalizedCategory = normalizedCategories.includes(expense.category)
      ? expense.category
      : "Other";

    return {
      postedOn: normalizeDate(expense.date),
      description: expense.description,
      merchant: expense.merchant || expense.description,
      category: normalizedCategory,
      amount: expense.original_amount,
      currency: normalizeCurrency(expense.original_currency),
    } satisfies ParsedTransactionInput;
  });

  if (transactions.length === 0) {
    throw new Error("Embedded LLM parser returned zero transactions.");
  }

  return transactions;
}
