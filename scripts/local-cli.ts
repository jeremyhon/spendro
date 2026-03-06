#!/usr/bin/env bun

import { Command, CommanderError } from "commander";

import { createBackupArchive, restoreBackupArchive } from "@/lib/local/backup";
import {
  addCategory,
  addStatementText,
  initializeLocalStore,
  listCategories,
  listStatements,
  listTransactions,
  runAgentParse,
  runEmbeddedLlmParse,
  runEmbeddedParse,
  storeStatement,
} from "@/lib/local/repository";

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

const parseCommand = program.command("parse").description("Parse operations");

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
