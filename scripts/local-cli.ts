#!/usr/bin/env node

import { Command, CommanderError } from "commander";

import { createBackupArchive, restoreBackupArchive } from "@/lib/local/backup";
import {
  auditEmbeddedParserAgainstKnownGood,
  auditEmbeddedParserWithOcr,
} from "@/lib/local/parser-audit";
import {
  addCategory,
  addStatementText,
  initializeLocalStore,
  listAccounts,
  listCategories,
  listMissingStatementGaps,
  listStatementCoverage,
  listStatementCoverageOverrides,
  listStatements,
  listTransactions,
  refreshStatementCoverage,
  removeStatementCoverageOverride,
  runAgentParse,
  runEmbeddedLlmParse,
  runEmbeddedParse,
  storeStatement,
  upsertStatementCoverageOverride,
} from "@/lib/local/repository";
import type { AccountProductType } from "@/lib/local/types";

interface GlobalOptions {
  json?: boolean;
}

function isJsonEnabled(command: Command): boolean {
  const options = command.optsWithGlobals() as GlobalOptions;
  return options.json === true;
}

function printResult(value: unknown, command: Command): void {
  if (isJsonEnabled(command)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (typeof value === "string") {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

const program = new Command();

program
  .name("spendro-local")
  .description("Local-first Spendro CLI")
  .showHelpAfterError()
  .option("--json", "Output JSON for agent-friendly automation");

program
  .command("init")
  .description("Initialize local data directories and SQLite schema")
  .action(function () {
    const initialized = initializeLocalStore();
    printResult(initialized, this);
  });

const statementCommand = program
  .command("statement")
  .description("Statement operations");

statementCommand
  .command("store")
  .description("Store a statement file in the local statement store")
  .requiredOption("--file <path>", "Path to statement file")
  .option("--bank <name>", "Bank name")
  .option("--period-start <date>", "Statement period start date")
  .option("--period-end <date>", "Statement period end date")
  .action(function (options) {
    const statement = storeStatement({
      filePath: options.file,
      bankName: options.bank,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    });

    printResult(statement, this);
  });

statementCommand
  .command("list")
  .description("List statements")
  .action(function () {
    const statements = listStatements();
    printResult(statements, this);
  });

const statementTextCommand = statementCommand
  .command("text")
  .description("Statement extracted text operations");

statementTextCommand
  .command("add")
  .description("Attach extracted text to a statement")
  .requiredOption("--statement-id <id>", "Statement ID")
  .requiredOption("--file <path>", "Path to extracted text file")
  .option("--source <name>", "Source identifier for extracted text")
  .action(function (options) {
    const result = addStatementText({
      statementId: options.statementId,
      filePath: options.file,
      source: options.source,
    });

    printResult(result, this);
  });

const categoryCommand = program
  .command("category")
  .description("Category operations");

categoryCommand
  .command("add")
  .description("Add a category")
  .requiredOption("--name <name>", "Category name")
  .option("--description <text>", "Category description")
  .action(function (options) {
    const category = addCategory({
      name: options.name,
      description: options.description,
    });

    printResult(category, this);
  });

categoryCommand
  .command("list")
  .description("List categories")
  .action(function () {
    const categories = listCategories();
    printResult(categories, this);
  });

const transactionCommand = program
  .command("transaction")
  .description("Transaction operations");

transactionCommand
  .command("list")
  .description("List transactions")
  .option("--statement-id <id>", "Filter by statement ID")
  .action(function (options) {
    const transactions = listTransactions(options.statementId);
    printResult(transactions, this);
  });

const coverageCommand = program
  .command("coverage")
  .description("Statement coverage and gap analysis");

coverageCommand
  .command("refresh")
  .description("Infer account and statement-month mapping for all statements")
  .action(function () {
    const result = refreshStatementCoverage();
    printResult(result, this);
  });

coverageCommand
  .command("accounts")
  .description("List inferred accounts/cards")
  .action(function () {
    const accounts = listAccounts();
    printResult(accounts, this);
  });

coverageCommand
  .command("map")
  .description("List statement-to-account-month mappings")
  .action(function () {
    const mappings = listStatementCoverage();
    printResult(mappings, this);
  });

coverageCommand
  .command("overrides")
  .description("List manual statement-account-month overrides")
  .action(function () {
    const overrides = listStatementCoverageOverrides();
    printResult(overrides, this);
  });

coverageCommand
  .command("assign")
  .description("Create or update manual mapping for one statement")
  .requiredOption("--statement-id <id>", "Statement ID")
  .requiredOption("--institution <name>", "Institution/provider name")
  .requiredOption(
    "--product-type <type>",
    "Account product type: card | account | other"
  )
  .requiredOption("--label <label>", "Account/card label")
  .requiredOption("--month <yyyy-mm>", "Statement month in YYYY-MM")
  .option("--last4 <digits>", "Optional last 4 digits")
  .option("--reason <text>", "Optional reason/note for manual override")
  .option(
    "--refresh",
    "Refresh coverage immediately after saving override",
    true
  )
  .action(function (options) {
    const productType = String(options.productType).toLowerCase();
    if (
      productType !== "card" &&
      productType !== "account" &&
      productType !== "other"
    ) {
      throw new Error(
        `Unsupported product type "${productType}". Use card|account|other.`
      );
    }

    const override = upsertStatementCoverageOverride({
      statementId: String(options.statementId),
      institution: String(options.institution),
      productType: productType as AccountProductType,
      accountLabel: String(options.label),
      last4: options.last4 ? String(options.last4) : null,
      statementMonth: String(options.month),
      reason: options.reason ? String(options.reason) : undefined,
    });

    const shouldRefresh = options.refresh !== false;
    const refreshResult = shouldRefresh ? refreshStatementCoverage() : null;

    printResult(
      {
        override,
        refresh: refreshResult,
      },
      this
    );
  });

coverageCommand
  .command("unassign")
  .description("Remove manual mapping override for one statement")
  .requiredOption("--statement-id <id>", "Statement ID")
  .option(
    "--refresh",
    "Refresh coverage immediately after removing override",
    true
  )
  .action(function (options) {
    const result = removeStatementCoverageOverride(String(options.statementId));
    const shouldRefresh = options.refresh !== false;
    const refreshResult = shouldRefresh ? refreshStatementCoverage() : null;

    printResult(
      {
        ...result,
        refresh: refreshResult,
      },
      this
    );
  });

coverageCommand
  .command("gaps")
  .description(
    "List missing statement months per active account up to as-of month"
  )
  .option("--as-of <yyyy-mm>", "As-of month for gap analysis")
  .option(
    "--include-complete",
    "Include accounts with no missing months in output",
    false
  )
  .option(
    "--refresh",
    "Refresh inferred mappings before calculating gaps",
    true
  )
  .action(function (options) {
    const shouldRefresh = options.refresh !== false;
    const refreshResult = shouldRefresh ? refreshStatementCoverage() : null;

    const gaps = listMissingStatementGaps({
      asOfMonth: options.asOf,
      includeComplete: options.includeComplete === true,
    });

    printResult(
      {
        asOfMonth: options.asOf ?? "auto(previous month)",
        refresh: refreshResult,
        gaps,
      },
      this
    );
  });

const parseCommand = program.command("parse").description("Parse operations");

parseCommand
  .command("audit-known")
  .description(
    "Cross-check embedded parser output against known-good transactions"
  )
  .option("--statement-id <id>", "Audit one statement ID")
  .option("--limit <n>", "Limit statements processed", Number.parseInt)
  .action(function (options) {
    const result = auditEmbeddedParserAgainstKnownGood({
      statementId: options.statementId
        ? String(options.statementId)
        : undefined,
      limit:
        typeof options.limit === "number" && Number.isFinite(options.limit)
          ? options.limit
          : undefined,
    });

    printResult(result, this);
  });

parseCommand
  .command("audit-ocr")
  .description(
    "Render statement PDFs to images + OCR and verify parsed transactions are visible"
  )
  .option("--statement-id <id>", "Audit one statement ID")
  .option(
    "--only-unknown",
    "Only audit statements with no known-good transactions",
    true
  )
  .option(
    "--limit <n>",
    "Limit statements processed (recommended for OCR runs)",
    Number.parseInt
  )
  .option("--dpi <n>", "Render DPI for PDF-to-image", Number.parseInt)
  .action(function (options) {
    const result = auditEmbeddedParserWithOcr({
      statementId: options.statementId
        ? String(options.statementId)
        : undefined,
      onlyUnknown: options.onlyUnknown !== false,
      limit:
        typeof options.limit === "number" && Number.isFinite(options.limit)
          ? options.limit
          : undefined,
      dpi:
        typeof options.dpi === "number" && Number.isFinite(options.dpi)
          ? options.dpi
          : undefined,
    });

    printResult(result, this);
  });

parseCommand
  .command("run")
  .description("Run parser for a statement")
  .requiredOption("--statement-id <id>", "Statement ID")
  .requiredOption("--mode <mode>", "Parser mode: embedded | agent")
  .option("--backend <backend>", "Embedded parser backend", "deterministic")
  .option("--input <path>", "Agent mode input JSON path")
  .action(async function (options) {
    const statementId = String(options.statementId);
    const mode = String(options.mode);

    if (mode === "embedded") {
      const backend = String(options.backend ?? "deterministic");

      if (backend === "llm") {
        const result = await runEmbeddedLlmParse(statementId);
        printResult(result, this);
        return;
      }

      if (backend === "deterministic") {
        const result = runEmbeddedParse(statementId);
        printResult(result, this);
        return;
      }

      throw new Error(`Unsupported embedded backend: ${backend}`);
    }

    if (mode === "agent") {
      if (!options.input) {
        throw new Error("parse run --mode agent requires --input <json-path>");
      }

      const result = runAgentParse(statementId, String(options.input));
      printResult(result, this);
      return;
    }

    throw new Error(`Unsupported parse mode: ${mode}`);
  });

const backupCommand = program
  .command("backup")
  .description("Backup operations");

backupCommand
  .command("create")
  .description("Create compressed backup archive")
  .option("--out <path>", "Output path for backup archive")
  .action(function (options) {
    const result = createBackupArchive(options.out);
    printResult(result, this);
  });

backupCommand
  .command("restore")
  .description("Restore from compressed backup archive")
  .requiredOption("--file <path>", "Backup archive path")
  .action(function (options) {
    const result = restoreBackupArchive(options.file);
    printResult(result, this);
  });

program.exitOverride();

async function runCli(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const jsonRequested = rawArgs.includes("--json");

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.helpDisplayed"
    ) {
      process.exit(0);
    }

    const message = error instanceof Error ? error.message : "Command failed.";

    if (jsonRequested) {
      console.error(
        JSON.stringify(
          {
            error: message,
          },
          null,
          2
        )
      );
    } else {
      console.error(`Error: ${message}`);
    }

    process.exit(1);
  }
}

void runCli();
