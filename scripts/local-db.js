import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Minimal D1 interface backed by SQLite for local runs; no in-memory production fallback.
export function localDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS local_schema_migrations (name TEXT PRIMARY KEY)');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
    if (sqlite.prepare('SELECT 1 FROM local_schema_migrations WHERE name=?').get(name)) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
      sqlite.prepare('INSERT INTO local_schema_migrations VALUES(?)').run(name);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); sqlite.close(); throw error; }
  }
  function prepare(sql) {
    return { bind(...args) {
      const query = sqlite.prepare(sql);
      return {
        first: () => query.get(...args) ?? null,
        all: () => ({ results: query.all(...args) }),
        run: () => ({ meta: { changes: Number(query.run(...args).changes) } }),
      };
    } };
  }
  return { sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }, close: () => sqlite.close() };
}
