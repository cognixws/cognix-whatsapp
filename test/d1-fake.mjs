import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Just enough of Cloudflare D1 to run the relay's real SQL: a real SQLite
// behind D1's statement shape. batch is all or nothing, as D1 documents.
class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async run() { return this.exec(); }
  exec() { return this.db.prepare(this.sql).run(...this.params); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
}

export function fakeD1({ failBatch = () => false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../relay/schema.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      if (failBatch()) throw new Error('D1 unavailable');
      db.exec('BEGIN');
      try { for (const statement of statements) statement.exec(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
