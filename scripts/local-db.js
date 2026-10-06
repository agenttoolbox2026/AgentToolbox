import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Minimal D1 interface backed by SQLite for local runs; no in-memory production fallback.
export function localDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
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
