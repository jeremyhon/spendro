#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { stdin } from "node:process";
import { Command, CommanderError } from "commander";

import { resolveLocalPaths } from "@/lib/local/paths";
import { Database } from "@/lib/local/sqlite";

type SqlParam = string | number | bigint | boolean | null;

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseParam(value: string): SqlParam {
  const lower = value.toLowerCase();
  if (lower === "null") {
    return null;
  }

  if (lower === "true") {
    return true;
  }

  if (lower === "false") {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    const asBigInt = BigInt(value);
    if (
      asBigInt <= BigInt(Number.MAX_SAFE_INTEGER) &&
      asBigInt >= BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return Number(value);
    }
    return asBigInt;
  }

  if (/^-?\d+\.\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function expandTilde(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith("~/")) {
    return resolve(homedir(), pathValue.slice(2));
  }

  return resolve(pathValue);
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isMutatingQuery(sql: string): boolean {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (
    /^(insert|update|delete|replace|create|drop|alter|truncate|reindex|vacuum|attach|detach|begin|commit|rollback)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }

  return /^pragma\s+\w+\s*=/i.test(trimmed);
}

function printRows(rows: unknown[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("0 rows");
    return;
  }

  console.table(rows);
}

function printRunResult(
  result: { changes: number; lastInsertRowid: number | bigint },
  json: boolean
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.table([result]);
}

async function main(): Promise<void> {
  const defaultDbPath = resolveLocalPaths().databasePath;

  const program = new Command();
  program
    .name("sqlite-query")
    .description("Quick SQLite query helper for Spendro local data")
    .argument("[sql...]", "SQL query to run")
    .option("--db <path>", "SQLite database path", defaultDbPath)
    .option("--file <path>", "Read SQL query from file")
    .option("--stdin", "Read SQL query from stdin")
    .option(
      "--param <value>",
      "Positional SQL parameter (repeatable). Use ?1, ?2, ... in SQL",
      collect,
      []
    )
    .option("--json", "Print machine-readable JSON output")
    .option("--write", "Allow mutating SQL (INSERT/UPDATE/DELETE/etc)")
    .showHelpAfterError();

  try {
    program.parse();
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exit(error.exitCode);
    }
    throw error;
  }

  const options = program.opts<{
    db: string;
    file?: string;
    stdin?: boolean;
    param: string[];
    json?: boolean;
    write?: boolean;
  }>();
  const sqlArgs = program.args as string[];

  let sql = "";
  if (options.file) {
    const sqlPath = expandTilde(options.file);
    if (!existsSync(sqlPath)) {
      throw new Error(`SQL file not found: ${sqlPath}`);
    }
    sql = readFileSync(sqlPath, "utf8");
  } else if (options.stdin === true) {
    sql = await readStdinText();
  } else {
    sql = sqlArgs.join(" ");
  }

  sql = sql.trim();
  if (sql.length === 0) {
    throw new Error("No SQL provided. Pass a query, --file, or --stdin.");
  }

  const dbPath = expandTilde(options.db);
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const params = options.param.map(parseParam);
  const readOnly = options.write !== true;
  const db = readOnly
    ? new Database(dbPath, { readonly: true })
    : new Database(dbPath);

  try {
    const mutating = isMutatingQuery(sql);

    if (readOnly && mutating) {
      throw new Error(
        "Mutating query blocked in read-only mode. Re-run with --write."
      );
    }

    if (mutating) {
      const result = db.prepare(sql).run(...params);
      printRunResult(
        {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        },
        options.json === true
      );
      return;
    }

    try {
      const rows = db.query(sql).all(...params);
      printRows(rows, options.json === true);
      return;
    } catch (queryError) {
      if (readOnly) {
        throw queryError;
      }
    }

    const result = db.prepare(sql).run(...params);
    printRunResult(
      {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      },
      options.json === true
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
