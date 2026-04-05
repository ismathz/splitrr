import { BaseSqliteStorage, BaseSqliteStorageDriver } from "@mtcute/core";
import { Database } from "bun:sqlite";

type MtcuteSqliteDb = ReturnType<BaseSqliteStorageDriver["_createDatabase"]>;

/** SQLite session storage for mtcute using `bun:sqlite` instead of `better-sqlite3` (unsupported in Bun). */
export class BunSqliteStorageDriver extends BaseSqliteStorageDriver {
  constructor(
    private readonly filename: string = ":memory:",
    private readonly params?: { disableWal?: boolean }
  ) {
    super();
  }

  _createDatabase(): MtcuteSqliteDb {
    const db = new Database(this.filename, { create: true, readwrite: true });
    if (!this.params?.disableWal) {
      db.run("PRAGMA journal_mode = WAL");
    }
    return db as MtcuteSqliteDb;
  }
}

export function createBunSqliteStorage(
  filename: string,
  params?: { disableWal?: boolean }
): BaseSqliteStorage {
  return new BaseSqliteStorage(new BunSqliteStorageDriver(filename, params));
}
