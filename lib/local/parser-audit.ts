import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEmbeddedTransactions } from "@/lib/local/parser";
import { resolveLocalPaths } from "@/lib/local/paths";
import { Database } from "@/lib/local/sqlite";
import type { ParsedTransactionInput } from "@/lib/local/types";

interface StatementAuditRow {
  id: string;
  file_name: string;
  file_path: string;
  known_count: number;
}

interface KnownAmountRow {
  posted_on: string;
  amount: number;
}

interface KnownGoodAuditOptions {
  statementId?: string;
  limit?: number;
}

interface OcrAuditOptions {
  statementId?: string;
  onlyUnknown?: boolean;
  limit?: number;
  dpi?: number;
}

const MONTH_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function parseIsoDate(isoDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date "${isoDate}".`);
  }

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
  };
}

function key(postedOn: string, amount: number): string {
  return `${postedOn}|${amount.toFixed(2)}`;
}

function multiset(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function intersectionCount(
  left: Map<string, number>,
  right: Map<string, number>
): number {
  let total = 0;
  for (const [token, leftCount] of left.entries()) {
    const rightCount = right.get(token) ?? 0;
    total += Math.min(leftCount, rightCount);
  }
  return total;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

function formatAmountWithCommas(amount: number): string {
  const [whole, decimal] = amount.toFixed(2).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withCommas}.${decimal}`;
}

function normalizeForSearch(text: string): string {
  return text.toUpperCase().replaceAll(/\s+/g, " ").trim();
}

function dateNeedles(postedOn: string): string[] {
  const parsed = parseIsoDate(postedOn);
  const monthToken = MONTH_SHORT[parsed.month - 1] ?? "";
  const dd = String(parsed.day).padStart(2, "0");
  const mm = String(parsed.month).padStart(2, "0");

  return [
    postedOn,
    `${dd}/${mm}`,
    `${dd} ${monthToken}`,
    `${parsed.day} ${monthToken}`,
  ];
}

function amountNeedles(amount: number): string[] {
  return [
    formatAmount(amount),
    formatAmountWithCommas(amount),
    formatAmount(amount).replaceAll(".", " "),
  ];
}

function extractPdfLayoutText(filePath: string): string {
  return String(
    execFileSync("pdftotext", ["-layout", filePath, "-"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 100 * 1024 * 1024,
    })
  );
}

function renderAndOcrPdf(filePath: string, dpi: number): string {
  const tmpPrefix = mkdtempSync(join(tmpdir(), "spendro-ocr-"));
  const imagePrefix = join(tmpPrefix, "page");

  try {
    execFileSync(
      "pdftoppm",
      ["-png", "-r", String(dpi), filePath, imagePrefix],
      {
        stdio: ["ignore", "ignore", "ignore"],
        maxBuffer: 100 * 1024 * 1024,
      }
    );

    const images = readdirSync(tmpPrefix)
      .filter((file) => file.endsWith(".png"))
      .sort();

    let ocrText = "";
    for (const imageFile of images) {
      const fullPath = join(tmpPrefix, imageFile);
      const pageText = String(
        execFileSync("tesseract", [fullPath, "stdout", "--psm", "6"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 100 * 1024 * 1024,
        })
      );
      ocrText += `\n${pageText}`;
    }

    return ocrText;
  } finally {
    rmSync(tmpPrefix, { recursive: true, force: true });
  }
}

function loadKnownStatements(
  db: Database,
  statementId?: string
): StatementAuditRow[] {
  if (statementId) {
    return db
      .query(
        `SELECT s.id, s.file_name, s.file_path, COUNT(t.id) AS known_count
         FROM statements s
         JOIN transactions t ON t.statement_id = s.id
         WHERE s.id = ?1
         GROUP BY s.id`
      )
      .all(statementId) as StatementAuditRow[];
  }

  return db
    .query(
      `SELECT s.id, s.file_name, s.file_path, COUNT(t.id) AS known_count
       FROM statements s
       JOIN transactions t ON t.statement_id = s.id
       GROUP BY s.id
       ORDER BY known_count DESC, s.created_at ASC`
    )
    .all() as StatementAuditRow[];
}

function loadStatementsForOcr(
  db: Database,
  options: OcrAuditOptions
): Array<{
  id: string;
  file_name: string;
  file_path: string;
  known_count: number;
}> {
  if (options.statementId) {
    return db
      .query(
        `SELECT s.id, s.file_name, s.file_path, COUNT(t.id) AS known_count
         FROM statements s
         LEFT JOIN transactions t ON t.statement_id = s.id
         WHERE s.id = ?1
         GROUP BY s.id`
      )
      .all(options.statementId) as Array<{
      id: string;
      file_name: string;
      file_path: string;
      known_count: number;
    }>;
  }

  if (options.onlyUnknown !== false) {
    return db
      .query(
        `SELECT s.id, s.file_name, s.file_path, COUNT(t.id) AS known_count
         FROM statements s
         LEFT JOIN transactions t ON t.statement_id = s.id
         GROUP BY s.id
         HAVING COUNT(t.id) = 0
         ORDER BY s.created_at ASC`
      )
      .all() as Array<{
      id: string;
      file_name: string;
      file_path: string;
      known_count: number;
    }>;
  }

  return db
    .query(
      `SELECT s.id, s.file_name, s.file_path, COUNT(t.id) AS known_count
       FROM statements s
       LEFT JOIN transactions t ON t.statement_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at ASC`
    )
    .all() as Array<{
    id: string;
    file_name: string;
    file_path: string;
    known_count: number;
  }>;
}

export function auditEmbeddedParserAgainstKnownGood(
  options: KnownGoodAuditOptions = {}
): {
  overall: Record<string, unknown>;
  parseFailures: Array<Record<string, unknown>>;
  worst: Array<Record<string, unknown>>;
  best: Array<Record<string, unknown>>;
  results: Array<Record<string, unknown>>;
} {
  const db = new Database(resolveLocalPaths().databasePath);

  try {
    const statements = loadKnownStatements(db, options.statementId);
    const scoped =
      options.limit && options.limit > 0
        ? statements.slice(0, options.limit)
        : statements;

    const parseFailures: Array<Record<string, unknown>> = [];
    const results: Array<Record<string, unknown>> = [];

    for (const row of scoped) {
      let layoutText = "";
      try {
        layoutText = extractPdfLayoutText(row.file_path);
      } catch (error) {
        parseFailures.push({
          statementId: row.id,
          fileName: row.file_name,
          knownCount: row.known_count,
          stage: "text-extraction",
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let parsedTransactions: ParsedTransactionInput[] = [];
      try {
        parsedTransactions = parseEmbeddedTransactions(layoutText);
      } catch (error) {
        parseFailures.push({
          statementId: row.id,
          fileName: row.file_name,
          knownCount: row.known_count,
          stage: "embedded-parse",
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const knownRows = db
        .query(
          `SELECT posted_on, amount
           FROM transactions
           WHERE statement_id = ?1`
        )
        .all(row.id) as KnownAmountRow[];

      const knownKeys = knownRows.map((item) =>
        key(item.posted_on, item.amount)
      );
      const parsedKeys = parsedTransactions.map((item) =>
        key(item.postedOn, item.amount)
      );
      const knownSet = multiset(knownKeys);
      const parsedSet = multiset(parsedKeys);
      const matched = intersectionCount(knownSet, parsedSet);
      const recall = matched / Math.max(knownRows.length, 1);
      const precision = matched / Math.max(parsedTransactions.length, 1);

      results.push({
        statementId: row.id,
        fileName: row.file_name,
        knownCount: knownRows.length,
        parsedCount: parsedTransactions.length,
        matched,
        recall,
        precision,
      });
    }

    const avgRecall =
      results.reduce((sum, row) => sum + Number(row.recall), 0) /
      Math.max(results.length, 1);
    const avgPrecision =
      results.reduce((sum, row) => sum + Number(row.precision), 0) /
      Math.max(results.length, 1);

    const worst = [...results]
      .sort((left, right) => Number(left.recall) - Number(right.recall))
      .slice(0, 20);
    const best = [...results]
      .sort((left, right) => Number(right.recall) - Number(left.recall))
      .slice(0, 20);

    return {
      overall: {
        evaluatedAt: new Date().toISOString(),
        totalKnownStatements: statements.length,
        scopedStatements: scoped.length,
        comparedStatements: results.length,
        parseFailures: parseFailures.length,
        avgRecall,
        avgPrecision,
        perfectMatches: results.filter(
          (row) => Number(row.recall) === 1 && Number(row.precision) === 1
        ).length,
      },
      parseFailures,
      worst,
      best,
      results,
    };
  } finally {
    db.close();
  }
}

export function auditEmbeddedParserWithOcr(options: OcrAuditOptions = {}): {
  overall: Record<string, unknown>;
  statementResults: Array<Record<string, unknown>>;
} {
  const db = new Database(resolveLocalPaths().databasePath);

  try {
    const dpi = options.dpi && options.dpi > 0 ? options.dpi : 180;
    const statements = loadStatementsForOcr(db, options);
    const scoped =
      options.limit && options.limit > 0
        ? statements.slice(0, options.limit)
        : statements;

    const statementResults: Array<Record<string, unknown>> = [];

    for (const statement of scoped) {
      let layoutText = "";
      try {
        layoutText = extractPdfLayoutText(statement.file_path);
      } catch (error) {
        statementResults.push({
          statementId: statement.id,
          fileName: statement.file_name,
          knownCount: statement.known_count,
          status: "text-extraction-failed",
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let parsedTransactions: ParsedTransactionInput[] = [];
      try {
        parsedTransactions = parseEmbeddedTransactions(layoutText);
      } catch (error) {
        statementResults.push({
          statementId: statement.id,
          fileName: statement.file_name,
          knownCount: statement.known_count,
          status: "embedded-parse-failed",
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let ocrText = "";
      try {
        ocrText = renderAndOcrPdf(statement.file_path, dpi);
      } catch (error) {
        statementResults.push({
          statementId: statement.id,
          fileName: statement.file_name,
          knownCount: statement.known_count,
          status: "ocr-failed",
          parsedCount: parsedTransactions.length,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const searchableOcr = normalizeForSearch(ocrText);
      const unmatchedTransactions = parsedTransactions.filter((transaction) => {
        const dateTokens = dateNeedles(transaction.postedOn);
        const amountTokens = amountNeedles(transaction.amount);

        const hasDate = dateTokens.some((token) =>
          searchableOcr.includes(normalizeForSearch(token))
        );
        const hasAmount = amountTokens.some((token) =>
          searchableOcr.includes(normalizeForSearch(token))
        );

        return !(hasDate && hasAmount);
      });

      statementResults.push({
        statementId: statement.id,
        fileName: statement.file_name,
        knownCount: statement.known_count,
        status: unmatchedTransactions.length === 0 ? "ok" : "needs-review",
        parsedCount: parsedTransactions.length,
        ocrMatchedCount:
          parsedTransactions.length - unmatchedTransactions.length,
        ocrUnmatchedCount: unmatchedTransactions.length,
        unmatchedTransactions: unmatchedTransactions.map((transaction) => ({
          postedOn: transaction.postedOn,
          amount: Number(transaction.amount.toFixed(2)),
          description: transaction.description,
        })),
      });
    }

    const successful = statementResults.filter(
      (row) => row.status === "ok" || row.status === "needs-review"
    );
    const unmatchedTotal = successful.reduce(
      (sum, row) => sum + Number(row.ocrUnmatchedCount ?? 0),
      0
    );
    const parsedTotal = successful.reduce(
      (sum, row) => sum + Number(row.parsedCount ?? 0),
      0
    );

    return {
      overall: {
        evaluatedAt: new Date().toISOString(),
        totalStatements: statements.length,
        scopedStatements: scoped.length,
        successfulStatements: successful.length,
        failedStatements: statementResults.length - successful.length,
        parsedTransactions: parsedTotal,
        ocrUnmatchedTransactions: unmatchedTotal,
      },
      statementResults,
    };
  } finally {
    db.close();
  }
}
