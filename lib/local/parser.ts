import { z } from "zod";

import type { ParsedTransactionInput } from "@/lib/local/types";

const EMBEDDED_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d,]+(?:\.\d{1,2})?)\s*([A-Z]{3})?$/;

const MONTH_BY_SHORT_NAME: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

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

function normalizeDescription(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function toMonthNumber(monthToken: string): number {
  const normalized = monthToken.trim().toLowerCase().slice(0, 3);
  const month = MONTH_BY_SHORT_NAME[normalized];
  if (!month) {
    throw new Error(`Unsupported month token "${monthToken}".`);
  }
  return month;
}

function formatIsoDate(year: number, month: number, day: number): string {
  const isoYear = String(year).padStart(4, "0");
  const isoMonth = String(month).padStart(2, "0");
  const isoDay = String(day).padStart(2, "0");
  return `${isoYear}-${isoMonth}-${isoDay}`;
}

function inferYearFromStatementMonth(
  statementYear: number,
  statementMonth: number,
  transactionMonth: number
): number {
  return transactionMonth > statementMonth ? statementYear - 1 : statementYear;
}

function extractStatementDateByAnchor(
  rawText: string,
  anchorPattern: RegExp
): { day: number; month: number; year: number } | null {
  const anchorMatch = anchorPattern.exec(rawText);
  if (!anchorMatch) {
    return null;
  }

  const fromAnchor = rawText.slice(anchorMatch.index);
  const dateMatch = /(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})/i.exec(fromAnchor);
  if (!dateMatch) {
    return null;
  }

  return {
    day: Number.parseInt(dateMatch[1], 10),
    month: toMonthNumber(dateMatch[2]),
    year: Number.parseInt(dateMatch[3], 10),
  };
}

function extractNumericStatementDateByAnchor(
  rawText: string,
  anchorPattern: RegExp
): { day: number; month: number; year: number } | null {
  const anchorMatch = anchorPattern.exec(rawText);
  if (!anchorMatch) {
    return null;
  }

  const fromAnchor = rawText.slice(anchorMatch.index);
  const dateMatch = /(\d{2})-(\d{2})-(20\d{2})/.exec(fromAnchor);
  if (!dateMatch) {
    return null;
  }

  return {
    day: Number.parseInt(dateMatch[1], 10),
    month: Number.parseInt(dateMatch[2], 10),
    year: Number.parseInt(dateMatch[3], 10),
  };
}

function parseAmount(rawAmount: string): number {
  const trimmed = rawAmount.trim();
  const isNegativeByParentheses =
    trimmed.startsWith("(") && trimmed.endsWith(")");
  const normalized = trimmed.replaceAll(/[(),]/g, "").replaceAll(",", "");
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid amount "${rawAmount}".`);
  }

  return isNegativeByParentheses ? -parsed : parsed;
}

function parseAmountFromSegment(segment: string): number | null {
  const match = /\(?\d[\d,]*\.\d{2}\)?(?:\s*CR)?/i.exec(segment);
  if (!match) {
    return null;
  }

  const raw = match[0];
  const withoutCr = raw.replace(/\s*CR$/i, "").trim();
  const parsed = parseAmount(withoutCr);
  if (/CR$/i.test(raw)) {
    return -Math.abs(parsed);
  }
  return parsed;
}

function extractCounterpartyFromDetailLines(
  detailLines: string[]
): string | null {
  const normalizedLines = detailLines
    .map((line) => normalizeDescription(line))
    .filter((line) => line.length > 0);

  for (const line of normalizedLines) {
    if (
      /^(PIB\d+|COLL\b|OTHR\b|REF[:\s]|VALUE DATE\b|PACS\b|DCC\b|GIRO Collection\b|TOP-UP TO PAYLAH!?)/i.test(
        line
      )
    ) {
      continue;
    }

    if (/^\d[\d\s/-]*$/.test(line)) {
      continue;
    }

    if (/^[A-Z]{2}\d{5,}$/i.test(line)) {
      continue;
    }

    if (/Co\. Reg\. No|GST Reg No|Biz Reg No|SG\d{8,}/i.test(line)) {
      continue;
    }

    if (/^TO\s*:?\s*/i.test(line)) {
      const toValue = normalizeDescription(line.replace(/^TO\s*:?\s*/i, ""));
      if (toValue.length > 0) {
        return toValue;
      }
      continue;
    }

    if (!/[A-Za-z]/.test(line)) {
      continue;
    }

    return line;
  }

  return null;
}

function extractPaylahTopUpTarget(detailLines: string[]): string | null {
  const lines = detailLines.map((line) => normalizeDescription(line));
  const topUpIndex = lines.findIndex((line) =>
    /^TOP-UP TO PAYLAH!?/i.test(line)
  );
  if (topUpIndex < 0) {
    return null;
  }

  const nextLine = lines[topUpIndex + 1] ?? "";
  const accountLike = nextLine.replaceAll(/\s+/g, "");
  if (/^\d{6,}$/.test(accountLike)) {
    return `PAYLAH TOP-UP ${accountLike}`;
  }

  return "PAYLAH TOP-UP";
}

function enrichTransferLikeDescription(
  description: string,
  detailLines: string[]
): { description: string; merchant: string | null } {
  if (
    !/PAYNOW-FAST|Funds Trf - FAST|Advice Funds Transfer|GIRO Payments \/ Collections via GIRO|Inward DR - GIRO|GIRO Standing Instruction|Advice FAST (Collection|Payment \/ Receipt)|Bill Payment/i.test(
      description
    )
  ) {
    return {
      description,
      merchant: description,
    };
  }

  const counterparty = extractCounterpartyFromDetailLines(detailLines);
  if (!counterparty && /Advice Funds Transfer/i.test(description)) {
    const paylahTarget = extractPaylahTopUpTarget(detailLines);
    if (paylahTarget) {
      return {
        description: `${description} - ${paylahTarget}`,
        merchant: paylahTarget,
      };
    }
  }

  if (!counterparty) {
    return {
      description,
      merchant: description,
    };
  }

  const descriptionAlreadyIncludesCounterparty = description
    .toLowerCase()
    .includes(counterparty.toLowerCase());
  const enrichedDescription = descriptionAlreadyIncludesCounterparty
    ? description
    : `${description} - ${counterparty}`;

  return {
    description: enrichedDescription,
    merchant: counterparty,
  };
}

function asExpense(
  postedOn: string,
  description: string,
  amount: number,
  currency = "SGD",
  merchant?: string | null
): ParsedTransactionInput | null {
  if (!(amount > 0)) {
    return null;
  }

  const normalizedDescription = normalizeDescription(description);
  if (!normalizedDescription) {
    return null;
  }

  return {
    postedOn,
    description: normalizedDescription,
    merchant: merchant ? normalizeDescription(merchant) : normalizedDescription,
    amount,
    currency,
    category: "Other",
  };
}

function detectCitibankCardStatement(rawText: string): boolean {
  return (
    /Citibank Singapore Ltd/i.test(rawText) &&
    /YOUR CITIBANK CARDS|YOUR BILL SUMMARY/i.test(rawText)
  );
}

function parseCitibankCardTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const statementDateMatch =
    /Statement Date\s+([A-Za-z]{3,9})\s+\d{1,2},\s*(20\d{2})/i.exec(rawText);
  if (!statementDateMatch) {
    throw new Error("Citibank parser could not find statement date.");
  }

  const statementMonth = toMonthNumber(statementDateMatch[1]);
  const statementYear = Number.parseInt(statementDateMatch[2], 10);

  const linePattern =
    /^\s*(\d{2})\s+([A-Za-z]{3})\s+(.+?)\s+(\(?\d[\d,]*\.\d{2}\)?(?:\s*CR)?)\s*$/;

  const parsed: ParsedTransactionInput[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = linePattern.exec(line);
    if (!match) {
      continue;
    }

    const day = Number.parseInt(match[1], 10);
    const month = toMonthNumber(match[2]);
    const year = inferYearFromStatementMonth(
      statementYear,
      statementMonth,
      month
    );
    const postedOn = formatIsoDate(year, month, day);
    const amount = parseAmount(match[4].replace(/\s*CR$/i, "").trim());
    const signedAmount = /CR$/i.test(match[4]) ? -Math.abs(amount) : amount;
    const expense = asExpense(postedOn, match[3], signedAmount, "SGD");

    if (expense) {
      parsed.push(expense);
    }
  }

  return parsed;
}

function detectDbsCreditCardStatement(rawText: string): boolean {
  return (
    /Credit Cards\s+Statement of Account/i.test(rawText) &&
    /DBS Cards P\.O\. Box/i.test(rawText)
  );
}

function parseDbsCreditCardTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const statementDate = extractStatementDateByAnchor(
    rawText,
    /STATEMENT DATE/i
  );
  if (!statementDate) {
    throw new Error("DBS card parser could not find statement date.");
  }

  const statementMonth = statementDate.month;
  const statementYear = statementDate.year;
  const linePattern =
    /^\s*(\d{2})\s+([A-Za-z]{3})\s+(.+?)\s+(\d[\d,]*\.\d{2})(?:\s+(CR))?\s*$/i;

  const parsed: ParsedTransactionInput[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = linePattern.exec(line);
    if (!match) {
      continue;
    }

    const day = Number.parseInt(match[1], 10);
    const month = toMonthNumber(match[2]);
    const year = inferYearFromStatementMonth(
      statementYear,
      statementMonth,
      month
    );
    const postedOn = formatIsoDate(year, month, day);
    const amount = parseAmount(match[4]);
    const signedAmount = match[5] ? -Math.abs(amount) : amount;
    const expense = asExpense(postedOn, match[3], signedAmount, "SGD");

    if (expense) {
      parsed.push(expense);
    }
  }

  return parsed;
}

function parseWithColumnLayout(
  rawText: string,
  options: {
    dateRegex: RegExp;
    parseDate: (dateMatch: RegExpExecArray) => string;
    headerMatcher: (line: string) => boolean;
    withdrawalLabel: string;
    depositLabel: string;
    balanceLabel: string;
    shouldSkipDescription?: (description: string) => boolean;
    shouldSkipTransaction?: (input: {
      description: string;
      detailLines: string[];
      amount: number;
    }) => boolean;
  }
): ParsedTransactionInput[] {
  const parsed: ParsedTransactionInput[] = [];

  const pages = rawText.split("\f");
  for (const page of pages) {
    const lines = page.split(/\r?\n/);
    const headerLine = lines.find(options.headerMatcher);

    if (!headerLine) {
      continue;
    }

    const withdrawalIndex = headerLine.indexOf(options.withdrawalLabel);
    const depositIndex = headerLine.indexOf(options.depositLabel);
    const balanceIndex = headerLine.indexOf(options.balanceLabel);

    if (
      withdrawalIndex < 0 ||
      depositIndex < 0 ||
      balanceIndex < 0 ||
      !(withdrawalIndex < depositIndex && depositIndex < balanceIndex)
    ) {
      continue;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const dateMatch = options.dateRegex.exec(line);
      if (!dateMatch) {
        continue;
      }

      const postedOn = options.parseDate(dateMatch);
      const description = normalizeDescription(
        line.slice(dateMatch[0].length, withdrawalIndex)
      );

      if (!description) {
        continue;
      }

      if (options.shouldSkipDescription?.(description)) {
        continue;
      }

      const withdrawalSegment = line.slice(withdrawalIndex, depositIndex);
      const withdrawalAmount = parseAmountFromSegment(withdrawalSegment);
      if (withdrawalAmount === null) {
        continue;
      }

      const detailLines: string[] = [];
      let lookahead = index + 1;
      while (lookahead < lines.length) {
        const nextLine = lines[lookahead];
        if (options.dateRegex.test(nextLine)) {
          break;
        }

        const normalized = normalizeDescription(nextLine);
        if (
          /Balance Carried Forward|Balance Brought Forward|PDS_|Page \d+ of \d+|Total$/i.test(
            normalized
          )
        ) {
          break;
        }

        if (normalized) {
          detailLines.push(normalized);
        }
        lookahead += 1;
      }

      index = lookahead - 1;

      const absAmount = Math.abs(withdrawalAmount);
      if (
        options.shouldSkipTransaction?.({
          description,
          detailLines,
          amount: absAmount,
        })
      ) {
        continue;
      }

      const enriched = enrichTransferLikeDescription(description, detailLines);
      const expense = asExpense(
        postedOn,
        enriched.description,
        absAmount,
        "SGD",
        enriched.merchant
      );
      if (expense) {
        parsed.push(expense);
      }
    }
  }

  return parsed;
}

function detectDbsMultiplierDepositStatement(rawText: string): boolean {
  return /Details of Your DBS Multiplier Account/i.test(rawText);
}

function parseDbsMultiplierDepositTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const periodMatch =
    /\d{1,2}\s+([A-Za-z]{3})\s+(20\d{2})\s+to\s+\d{1,2}\s+([A-Za-z]{3})\s+(20\d{2})/i.exec(
      rawText
    );
  if (!periodMatch) {
    throw new Error("DBS multiplier parser could not find statement period.");
  }

  const statementMonth = toMonthNumber(periodMatch[3]);
  const statementYear = Number.parseInt(periodMatch[4], 10);

  return parseWithColumnLayout(rawText, {
    dateRegex: /^\s*(\d{1,2})\s+([A-Za-z]{3})\b/,
    parseDate: (dateMatch) => {
      const day = Number.parseInt(dateMatch[1], 10);
      const month = toMonthNumber(dateMatch[2]);
      const year = inferYearFromStatementMonth(
        statementYear,
        statementMonth,
        month
      );
      return formatIsoDate(year, month, day);
    },
    headerMatcher: (line) =>
      line.includes("WITHDRAWAL") &&
      line.includes("DEPOSIT") &&
      line.includes("BALANCE"),
    withdrawalLabel: "WITHDRAWAL",
    depositLabel: "DEPOSIT",
    balanceLabel: "BALANCE",
    shouldSkipDescription: (description) =>
      /Balance Brought Forward|Balance Carried Forward|Total/i.test(
        description
      ),
    shouldSkipTransaction: ({ description, detailLines }) => {
      const detailText = detailLines.join(" ");
      if (
        /Interest Earned|GIRO Salary|ATM Cash Withdrawal|^Cash$/i.test(
          description
        )
      ) {
        return true;
      }

      if (/Advice FAST Collection/i.test(description)) {
        return !/Utilities/i.test(detailText);
      }

      if (/GIRO Standing Instruction/i.test(description)) {
        return /JEREMY HON/i.test(detailText);
      }

      if (/Advice Funds Transfer/i.test(description)) {
        return /I-BANK|AC CLOSURE TRANSFER/i.test(detailText);
      }

      return false;
    },
  });
}

function detectDbsPosbConsolidatedStatement(rawText: string): boolean {
  return (
    /Consolidated Statement/i.test(rawText) &&
    /Transaction Details as at/i.test(rawText)
  );
}

function parseDbsPosbConsolidatedTransactions(
  rawText: string
): ParsedTransactionInput[] {
  return parseWithColumnLayout(rawText, {
    dateRegex: /^\s*(\d{2})\/(\d{2})\/(\d{4})\b/,
    parseDate: (dateMatch) => {
      const day = Number.parseInt(dateMatch[1], 10);
      const month = Number.parseInt(dateMatch[2], 10);
      const year = Number.parseInt(dateMatch[3], 10);
      return formatIsoDate(year, month, day);
    },
    headerMatcher: (line) =>
      line.includes("Withdrawal (-)") &&
      line.includes("Deposit (+)") &&
      line.includes("Balance"),
    withdrawalLabel: "Withdrawal (-)",
    depositLabel: "Deposit (+)",
    balanceLabel: "Balance",
    shouldSkipDescription: (description) =>
      /Balance Brought Forward|Total Balance Carried Forward|Total/i.test(
        description
      ),
  });
}

function detectUobAccountStatement(rawText: string): boolean {
  return (
    /United Overseas Bank Limited|UOB Privilege Concierge/i.test(rawText) &&
    /Statement of Account/i.test(rawText) &&
    /Account Transaction Details/i.test(rawText)
  );
}

function detectUobAccountSummaryOnlyStatement(rawText: string): boolean {
  return (
    /United Overseas Bank Limited|UOB Privilege Concierge/i.test(rawText) &&
    /Statement of Account/i.test(rawText) &&
    /Portfolio Overview as at/i.test(rawText) &&
    !/Account Transaction Details/i.test(rawText)
  );
}

function parseUobAccountTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const periodMatch =
    /Period:\s+\d{1,2}\s+([A-Za-z]{3})\s+(20\d{2})\s+to\s+\d{1,2}\s+([A-Za-z]{3})\s+(20\d{2})/i.exec(
      rawText
    );
  if (!periodMatch) {
    throw new Error("UOB parser could not find statement period.");
  }

  const statementMonth = toMonthNumber(periodMatch[3]);
  const statementYear = Number.parseInt(periodMatch[4], 10);

  return parseWithColumnLayout(rawText, {
    dateRegex: /^\s*(\d{2})\s+([A-Za-z]{3})\b/,
    parseDate: (dateMatch) => {
      const day = Number.parseInt(dateMatch[1], 10);
      const month = toMonthNumber(dateMatch[2]);
      const year = inferYearFromStatementMonth(
        statementYear,
        statementMonth,
        month
      );
      return formatIsoDate(year, month, day);
    },
    headerMatcher: (line) =>
      line.includes("Withdrawals") &&
      line.includes("Deposits") &&
      line.includes("Balance"),
    withdrawalLabel: "Withdrawals",
    depositLabel: "Deposits",
    balanceLabel: "Balance",
    shouldSkipDescription: (description) =>
      /BALANCE B\/F|Total/i.test(description),
    shouldSkipTransaction: ({ description, detailLines }) => {
      const detailText = detailLines.join(" ");
      if (
        /Interest Credit|Interest Earned|Inward CR - GIRO|O\/W Trf Rev-Chg/i.test(
          description
        )
      ) {
        return true;
      }

      if (/Bill Payment/i.test(description)) {
        return /mBK-(Citi|UOB)\s*CC|mBK-UOB Cards/i.test(detailText);
      }

      if (/Funds Trf - FAST/i.test(description)) {
        return /Transfer/i.test(detailText);
      }

      return false;
    },
  });
}

function detectUobCreditCardStatement(rawText: string): boolean {
  return (
    /Credit Card\(s\) Statement/i.test(rawText) &&
    /Description of Transaction/i.test(rawText) &&
    /Transaction Amount/i.test(rawText)
  );
}

function parseUobCreditCardTransactions(
  rawText: string
): ParsedTransactionInput[] {
  const statementDate = extractStatementDateByAnchor(
    rawText,
    /Statement Date/i
  );
  if (!statementDate) {
    throw new Error("UOB card parser could not find statement date.");
  }

  const statementMonth = statementDate.month;
  const statementYear = statementDate.year;
  const linePattern =
    /^\s*(\d{2})\s+([A-Za-z]{3})\s+\d{2}\s+[A-Za-z]{3}\s+(.+?)\s+(\d[\d,]*\.\d{2})(?:\s+(CR))?\s*$/i;

  const parsed: ParsedTransactionInput[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = linePattern.exec(line);
    if (!match) {
      continue;
    }

    const day = Number.parseInt(match[1], 10);
    const month = toMonthNumber(match[2]);
    const year = inferYearFromStatementMonth(
      statementYear,
      statementMonth,
      month
    );
    const postedOn = formatIsoDate(year, month, day);
    const amount = parseAmount(match[4]);
    const signedAmount = match[5] ? -Math.abs(amount) : amount;
    const expense = asExpense(postedOn, match[3], signedAmount, "SGD");

    if (expense) {
      parsed.push(expense);
    }
  }

  return parsed;
}

function detectOcbcCardStatement(rawText: string): boolean {
  return (
    /OCBC Bank/i.test(rawText) &&
    /TRANSACTION DATE\s+DESCRIPTION\s+AMOUNT \(SGD\)/i.test(rawText)
  );
}

function parseOcbcCardTransactions(rawText: string): ParsedTransactionInput[] {
  const statementDate = extractNumericStatementDateByAnchor(
    rawText,
    /STATEMENT DATE/i
  );
  if (!statementDate) {
    throw new Error("OCBC parser could not find statement date.");
  }

  const statementMonth = statementDate.month;
  const statementYear = statementDate.year;
  const linePattern =
    /^\s*(\d{2})\/(\d{2})\s+(.+?)\s+(\(?\d[\d,]*\.\d{2}\s*\)?)(?:\s*(CR))?\s*$/i;

  const parsed: ParsedTransactionInput[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = linePattern.exec(line);
    if (!match) {
      continue;
    }

    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const year = inferYearFromStatementMonth(
      statementYear,
      statementMonth,
      month
    );
    const postedOn = formatIsoDate(year, month, day);
    const amount = parseAmount(match[4]);
    const signedAmount = match[5] ? -Math.abs(amount) : amount;
    const expense = asExpense(postedOn, match[3], signedAmount, "SGD");
    if (expense) {
      parsed.push(expense);
    }
  }

  return parsed;
}

function parseGenericTransactions(rawText: string): ParsedTransactionInput[] {
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

    const expense = asExpense(postedOn, description, amount, currency);
    if (expense) {
      parsed.push(expense);
    }
  }

  return parsed;
}

export function parseEmbeddedTransactions(
  rawText: string
): ParsedTransactionInput[] {
  let parsed: ParsedTransactionInput[] = [];
  let parserName = "generic";
  let parserMatched = false;

  if (detectCitibankCardStatement(rawText)) {
    parserMatched = true;
    parserName = "citibank-card";
    parsed = parseCitibankCardTransactions(rawText);
  } else if (detectDbsCreditCardStatement(rawText)) {
    parserMatched = true;
    parserName = "dbs-credit-card";
    parsed = parseDbsCreditCardTransactions(rawText);
  } else if (detectOcbcCardStatement(rawText)) {
    parserMatched = true;
    parserName = "ocbc-card";
    parsed = parseOcbcCardTransactions(rawText);
  } else if (detectDbsMultiplierDepositStatement(rawText)) {
    parserMatched = true;
    parserName = "dbs-deposit-account";
    parsed = parseDbsMultiplierDepositTransactions(rawText);
  } else if (detectDbsPosbConsolidatedStatement(rawText)) {
    parserMatched = true;
    parserName = "dbs-posb-consolidated";
    parsed = parseDbsPosbConsolidatedTransactions(rawText);
  } else if (detectUobCreditCardStatement(rawText)) {
    parserMatched = true;
    parserName = "uob-credit-card";
    parsed = parseUobCreditCardTransactions(rawText);
  } else if (detectUobAccountStatement(rawText)) {
    parserMatched = true;
    parserName = "uob-account";
    parsed = parseUobAccountTransactions(rawText);
  } else if (detectUobAccountSummaryOnlyStatement(rawText)) {
    parserMatched = true;
    parserName = "uob-account-summary";
    parsed = [];
  } else {
    parsed = parseGenericTransactions(rawText);
  }

  if (parsed.length === 0 && !parserMatched) {
    throw new Error(`No transactions parsed using parser "${parserName}".`);
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
