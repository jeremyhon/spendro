import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ensureLocalDirectories, resolveLocalPaths } from "@/lib/local/paths";

function timestampSlug(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function createBackupArchive(outputPath?: string): {
  backupPath: string;
} {
  const paths = resolveLocalPaths();
  ensureLocalDirectories(paths);

  if (!existsSync(paths.databasePath)) {
    throw new Error(
      "Database file does not exist yet. Run `spendro-local init` first."
    );
  }

  const backupPath = outputPath
    ? resolve(outputPath)
    : join(paths.backupsDir, `spendro-backup-${timestampSlug()}.tar.gz`);

  execFileSync("tar", [
    "-czf",
    backupPath,
    "-C",
    paths.homeDir,
    "spendro.db",
    "statements",
  ]);

  return { backupPath };
}

export function restoreBackupArchive(backupFilePath: string): {
  restoredFrom: string;
  restoreRoot: string;
} {
  const resolvedBackupPath = resolve(backupFilePath);
  if (!existsSync(resolvedBackupPath)) {
    throw new Error(`Backup file not found: ${resolvedBackupPath}`);
  }

  const paths = resolveLocalPaths();
  ensureLocalDirectories(paths);

  const restoreTempDir = mkdtempSync(join(tmpdir(), "spendro-restore-"));

  try {
    execFileSync("tar", ["-xzf", resolvedBackupPath, "-C", restoreTempDir]);

    const extractedDbPath = join(restoreTempDir, "spendro.db");
    const extractedStatementsPath = join(restoreTempDir, "statements");

    if (!existsSync(extractedDbPath)) {
      throw new Error("Backup archive is missing spendro.db.");
    }

    if (!existsSync(extractedStatementsPath)) {
      mkdirSync(extractedStatementsPath, { recursive: true });
    }

    const preRestoreDir = join(paths.homeDir, `pre-restore-${timestampSlug()}`);
    mkdirSync(preRestoreDir, { recursive: true });

    if (existsSync(paths.databasePath)) {
      cpSync(paths.databasePath, join(preRestoreDir, "spendro.db"));
    }

    if (existsSync(paths.statementsDir)) {
      cpSync(paths.statementsDir, join(preRestoreDir, "statements"), {
        recursive: true,
      });
    }

    cpSync(extractedDbPath, paths.databasePath);
    rmSync(paths.statementsDir, { recursive: true, force: true });
    cpSync(extractedStatementsPath, paths.statementsDir, { recursive: true });

    return {
      restoredFrom: resolvedBackupPath,
      restoreRoot: paths.homeDir,
    };
  } finally {
    rmSync(restoreTempDir, { recursive: true, force: true });
  }
}
