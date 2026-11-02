import { DatabaseSync } from 'node:sqlite';

const KEEP_DELIVERIES_MS = 30 * 24 * 60 * 60 * 1000;

export const INBOX = 'inbox';
export const OFF = 'off';

export class Ledger {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout = 5000');
  }
  close() { this.db.close(); }

  get(key, fallback = '') { return this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value ?? fallback; }
  set(key, value) { this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value)); }

  delivered(messageId, target) { return !!this.db.prepare('SELECT 1 FROM deliveries WHERE message_id = ? AND target = ?').get(messageId, target); }
  markDelivered(messageIds, target, now) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO deliveries (message_id, target, at) VALUES (?, ?, ?)');
    for (const id of messageIds) insert.run(id, target, now);
  }
  prune(now) { this.db.prepare('DELETE FROM deliveries WHERE at < ?').run(now - KEEP_DELIVERIES_MS); }

  touchContact({ key, name, phone }, now) {
    this.db.prepare(`INSERT INTO contacts (key, name, phone, last_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET name = excluded.name, phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE phone END, last_at = excluded.last_at`).run(key, name, phone, now);
  }
  contacts(limit = 50) { return this.db.prepare('SELECT key, name, phone, last_at AS lastAt FROM contacts ORDER BY last_at DESC LIMIT ?').all(limit); }
  addHeld(key, n) { this.db.prepare('UPDATE contacts SET held = held + ? WHERE key = ?').run(n, key); }
  heldFor(key) { return this.db.prepare('SELECT held FROM contacts WHERE key = ?').get(key)?.held ?? 0; }
  clearHeld(key) { this.db.prepare('UPDATE contacts SET held = 0 WHERE key = ?').run(key); }

  routes() {
    return this.db.prepare('SELECT contact, target, preview FROM routes ORDER BY contact').all().map(row => ({ contact: row.contact, target: row.target, preview: !!row.preview }));
  }
  // A contact can be known by a phone number, a business-scoped id, or both.
  routeFor(ids) {
    const find = this.db.prepare('SELECT contact, target, preview FROM routes WHERE contact = ?');
    for (const id of ids) {
      const row = find.get(id);
      if (row) return { contact: row.contact, target: row.target, preview: !!row.preview };
    }
    return null;
  }
  replaceRoutes(routes) {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM routes');
      const insert = this.db.prepare('INSERT INTO routes (contact, target, preview) VALUES (?, ?, ?)');
      for (const route of routes) insert.run(route.contact, route.target, route.preview ? 1 : 0);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
