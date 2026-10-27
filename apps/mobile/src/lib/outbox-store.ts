import type { OutboxState } from "@liftcut/core/workout-outbox";
import * as SQLite from "expo-sqlite";

// Native: a real SQLite file, not WebView storage the OS may purge (plan section 2).
let database: Promise<SQLite.SQLiteDatabase> | null = null;
const open = () => database ??= SQLite.openDatabaseAsync("liftcut.db").then(async db => {
  await db.execAsync("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS outbox (owner TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL);");
  return db;
});
export const outboxStore = {
  async read(owner: string): Promise<OutboxState | null> {
    const row = await (await open()).getFirstAsync<{ state: string }>("SELECT state FROM outbox WHERE owner = ?", owner);
    return row ? JSON.parse(row.state) as OutboxState : null;
  },
  async write(owner: string, state: OutboxState) {
    await (await open()).runAsync("INSERT INTO outbox (owner, state) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET state = excluded.state", owner, JSON.stringify(state));
  },
  async removeOwner(owner: string) { await (await open()).runAsync("DELETE FROM outbox WHERE owner = ?", owner); },
};
