import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../recipe/signals.js', import.meta.url), 'utf8');

// The script against a small fake of the chat list: enough to run the real file.
function page(storage) {
  const rows = new Map();
  const row = (name, count) => ({
    querySelector: () => ({ getAttribute: () => name }),
    querySelectorAll: () => (count ? [{ getAttribute: () => `${count} unread messages` }] : []),
  });
  const side = { querySelectorAll: () => [...rows].map(([n, c]) => row(n, c)) };
  const signals = [];
  const observers = [];
  const sandbox = {
    localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
    document: { title: 'WhatsApp', documentElement: {}, getElementById: () => side, querySelector: () => ({}) },
    window: { picode: { signal: (n, d) => signals.push(d), badge() {}, chats() {} } },
    MutationObserver: class { constructor(f) { observers.push(f); } observe() {} disconnect() {} },
    queueMicrotask: f => f(),
    setInterval() {},
    Map, Object, JSON, Number,
  };
  return { rows, signals, run: () => vm.runInNewContext(source, sandbox), change: () => observers[0]() };
}

test('a new session learns first, then a higher count is news', () => {
  const p = page({});
  p.rows.set('Family', 2);
  p.run();
  assert.deepEqual(p.signals, []);
  p.rows.set('Family', 3);
  p.change();
  assert.deepEqual(p.signals.map(s => [s.chat, s.count]), [['Family', 3]]);
});

test('a message that arrived with the page down is news after the reload, once', () => {
  const storage = {};
  const a = page(storage);
  a.rows.set('Family', 0);
  a.run();
  const b = page(storage);
  b.rows.set('Family', 1);
  b.run();
  assert.deepEqual(b.signals.map(s => s.count), [1]);
  const c = page(storage);
  c.rows.set('Family', 1);
  c.run();
  assert.deepEqual(c.signals, []);
});

test('reading it clears it, so the next message is news again', () => {
  const p = page({});
  p.rows.set('Family', 1);
  p.run();
  p.rows.set('Family', 0);
  p.change();
  p.rows.set('Family', 1);
  p.change();
  assert.equal(p.signals.length, 1);
});

test('a contact first seen with unread messages is news, and not twice', () => {
  const p = page({});
  p.rows.set('Family', 0);
  p.run();
  p.rows.set('+55 11 98888-7777', 1);
  p.change();
  p.change();
  assert.deepEqual(p.signals.map(s => s.chat), ['+55 11 98888-7777']);
});
