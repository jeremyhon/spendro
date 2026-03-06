import { z } from "zod";

import type { ParsedTransactionInput } from "@/lib/local/types";

const EMBEDDED_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d,]+(?:\.\d{1,2})?)\s*([A-Z]{3})?$/;

const agentTransactionSchema = z.object({
  postedOn: z.string().min(1),
  description: z.string().min(1),
  merchant: z.string().min(1).optional().nullable(),
  category: z.string().min(1).optional().nullable(),
  amount: z.number().finite(),
  currency: z.string().length(3).optional(),
});

const agentPayloadSchema = z.array(agentTransactionSchema);

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

function parseAmount(rawAmount: string): number {
  const normalized = rawAmount.replaceAll(",", "");
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid amount "${rawAmount}".`);
  }

  return parsed;
}

export function parseEmbeddedTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: ParsedTransactionInput[] = [];

  for (const line of lines) {
    const match = EMBEDDED_LINE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const [, rawDate, rawDescription, rawAmount, rawCurrency] = match;
    const postedOn = normalizeDate(rawDate);
    const description = rawDescription.trim();
    const amount = parseAmount(rawAmount);
    const currency = rawCurrency ?? "SGD";

    parsed.push({
      postedOn,
      description,
      merchant: description,
      amount,
      currency,
      category: "Other",
    });
  }

  if (parsed.length === 0) {
    throw new Error(
      "No transaction-like lines found. Embedded parser expects lines in the format: YYYY-MM-DD DESCRIPTION AMOUNT [CURRENCY]."
    );
  }

  return parsed;
}

export function parseAgentTransactionsJson(
  jsonText: string
): ParsedTransactionInput[] {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error("Agent payload is not valid JSON.");
  }

  const validationResult = agentPayloadSchema.safeParse(parsedJson);
  if (!validationResult.success) {
    const detail = validationResult.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`Invalid agent payload: ${detail}`);
  }

  return validationResult.data.map((row) => ({
    postedOn: normalizeDate(row.postedOn),
    description: row.description,
    merchant: row.merchant ?? row.description,
    category: row.category ?? "Other",
    amount: row.amount,
    currency: row.currency ?? "SGD",
  }));
}
