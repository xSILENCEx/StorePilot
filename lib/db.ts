import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
const cache = globalThis as unknown as { storepilotSqlite?: Database.Database };
export function sqlite() {
  if (!cache.storepilotSqlite) {
    // User data is created at runtime and must not be bundled into the server output.
    const file = path.resolve(
      /* turbopackIgnore: true */
      process.env.DATABASE_PATH ?? "data/storepilot.sqlite",
    );
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const connection = new Database(file);
    chmodSync(file, 0o600);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma("busy_timeout = 5000");
    connection.exec(
      readFileSync(path.join(process.cwd(), "db/schema.sql"), "utf8"),
    );
    connection
      .transaction(() => {
        for (const table of ["store_snapshots", "google_snapshots"]) {
          const hasHistory = connection
            .prepare(
              `SELECT 1 FROM pragma_table_info(?) WHERE name = 'previous_snapshot'`,
            )
            .get(table);
          if (hasHistory)
            connection.exec(
              `ALTER TABLE ${table} DROP COLUMN previous_snapshot`,
            );
        }
      })
      .immediate();
    cache.storepilotSqlite = connection;
  }
  return cache.storepilotSqlite;
}
export function db() {
  return drizzle(sqlite());
}
export function closeDb() {
  cache.storepilotSqlite?.close();
  delete cache.storepilotSqlite;
}
