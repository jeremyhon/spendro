import { createRequire } from "node:module";

export type SqlParam = string | number | bigint | boolean | null | Uint8Array;

type SqlParamBinding = Record<number, SqlParam>;
type RawSqlBindValue = SqlParam | SqlParamBinding;

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  all(...params: SqlParam[]): unknown[];
  get(...params: SqlParam[]): unknown;
  run(...params: SqlParam[]): SqlRunResult;
}

type RawSqlStatement = {
  all: (...params: RawSqlBindValue[]) => unknown[];
  get: (...params: RawSqlBindValue[]) => unknown;
  run: (...params: RawSqlBindValue[]) => {
    changes: number;
    lastInsertRowid: number | bigint;
  };
};

type RawSqlDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => RawSqlStatement;
  close: () => void;
};

type RawSqlDatabaseConstructor = new (
  path: string,
  options?: unknown
) => RawSqlDatabase;

const NUMBERED_PARAM_PATTERN = /\?(\d+)/g;
const require = createRequire(import.meta.url);

function extractMaxNumberedParamIndex(sql: string): number {
  let maxIndex = 0;

  for (const match of sql.matchAll(NUMBERED_PARAM_PATTERN)) {
    const rawIndex = match[1];
    const parsed = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      continue;
    }

    maxIndex = Math.max(maxIndex, parsed);
  }

  return maxIndex;
}

function loadBetterSqliteDatabaseConstructor(): RawSqlDatabaseConstructor {
  return require("better-sqlite3") as RawSqlDatabaseConstructor;
}

class StatementWrapper implements SqlStatement {
  private readonly maxNumberedParamIndex: number;

  constructor(
    private readonly statement: RawSqlStatement,
    sql: string
  ) {
    this.maxNumberedParamIndex = extractMaxNumberedParamIndex(sql);
  }

  private normalizeParams(params: SqlParam[]): RawSqlBindValue[] {
    if (this.maxNumberedParamIndex === 0) {
      return params;
    }

    if (params.length < this.maxNumberedParamIndex) {
      throw new RangeError("Too few parameter values were provided");
    }

    if (params.length > this.maxNumberedParamIndex) {
      throw new RangeError("Too many parameter values were provided");
    }

    const binding: SqlParamBinding = {};
    for (let index = 1; index <= this.maxNumberedParamIndex; index += 1) {
      binding[index] = params[index - 1];
    }

    return [binding];
  }

  all(...params: SqlParam[]): unknown[] {
    return this.statement.all(...this.normalizeParams(params));
  }

  get(...params: SqlParam[]): unknown {
    return this.statement.get(...this.normalizeParams(params));
  }

  run(...params: SqlParam[]): SqlRunResult {
    const result = this.statement.run(...this.normalizeParams(params));
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }
}

export class Database {
  private readonly db: RawSqlDatabase;

  constructor(path: string, options?: { readonly?: boolean }) {
    const readonly = options?.readonly === true;
    const BetterSqlite3 = loadBetterSqliteDatabaseConstructor();
    this.db = new BetterSqlite3(path, {
      readonly,
      fileMustExist: readonly,
    });
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): SqlStatement {
    return new StatementWrapper(this.db.prepare(sql), sql);
  }

  prepare(sql: string): SqlStatement {
    return new StatementWrapper(this.db.prepare(sql), sql);
  }

  close(): void {
    this.db.close();
  }
}
