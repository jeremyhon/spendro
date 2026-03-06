import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalPaths {
  homeDir: string;
  databasePath: string;
  statementsDir: string;
  backupsDir: string;
}

export function resolveLocalPaths(): LocalPaths {
  const envHome = process.env.SPENDRO_HOME;
  const repoLocalHome = join(process.cwd(), ".local-spendro");
  const homeDir = envHome
    ? envHome
    : existsSync(repoLocalHome)
      ? repoLocalHome
      : join(homedir(), ".spendro");

  return {
    homeDir,
    databasePath: join(homeDir, "spendro.db"),
    statementsDir: join(homeDir, "statements"),
    backupsDir: join(homeDir, "backups"),
  };
}

export function ensureLocalDirectories(paths: LocalPaths): void {
  mkdirSync(paths.homeDir, { recursive: true });
  mkdirSync(paths.statementsDir, { recursive: true });
  mkdirSync(paths.backupsDir, { recursive: true });
}
