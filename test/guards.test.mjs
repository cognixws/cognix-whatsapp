import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const guardSource = readFileSync(new URL('../recipe/guard.js', import.meta.url), 'utf8');
const signalsSource = readFileSync(new URL('../recipe/signals.js', import.meta.url), 'utf8');

function loadPolicy(storage) {
  const sandbox = {
    Map, Set, Object, JSON, Number, String, RegExp, Math, Date, Array,
    localStorage: storage,
    document: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(guardSource, sandbox, { filename: 'guard.js' });
  return sandbox.__picodeWhatsappPolicy;
}

const TEXT = 'See you Thursday';
const REASON = {
  '0,0,0': 'chat_not_allowed',
  '0,0,1': 'chat_not_allowed',
  '0,1,0': 'chat_not_allowed',
  '0,1,1': 'chat_not_allowed',
  '1,0,0': 'never_write_first',
  '1,0,1': 'never_write_first',
  '1,1,0': 'needs_ok',
  '1,1,1': 'ok',
};

// One row per combination the send path has to decide.
for (const kind of ['direct', 'group']) {
  for (const allowed of [false, true]) {
    for (const wroteFirst of [false, true]) {
      for (const ok of [false, true]) {
        const reason = REASON[`${+allowed},${+wroteFirst},${+ok}`];
        const who = kind === 'group' ? 'group' : 'individual';
        const wrote = wroteFirst ? 'reply' : 'first message';
        const approval = ok ? 'with OK' : 'without OK';
        const listed = allowed ? 'allowed' : 'not allowed';
        test(`${listed} × ${wrote} × ${approval} × ${who}`, () => {
          const policy = loadPolicy();
          const send = policy.sendDecision({ allowed, wroteFirst, ok, kind, text: TEXT });
          assert.equal(send.reason, reason);
          assert.equal(send.send, reason === 'ok');
          const released = policy.releaseInbound({ chat: 'Bia', id: '1', phone: '5511999999999', count: 1, preview: 'SECRET LINE' }, allowed, kind);
          if (!allowed) {
            assert.equal(released, null);
          } else {
            assert.equal(released.preview, 'SECRET LINE');
          }
          assert.equal(JSON.stringify(policy.state()).includes('SECRET'), false);
        });
      }
    }
  }
}

test('a chat with no phone or group id is refused, and its text is not kept', () => {
  const policy = loadPolicy();
  const send = policy.sendDecision({ allowed: true, wroteFirst: true, ok: true, kind: '', text: TEXT });
  assert.equal(send.send, false);
  assert.equal(send.reason, 'no_stable_id');
  assert.equal(policy.releaseInbound({ preview: 'SECRET LINE' }, true, ''), null);
  assert.equal(policy.identityOf({ id: { _serialized: '123@lid' }, contact: {} }, 'Bia'), null);
  assert.equal(policy.identityOf(null, 'Family'), null);
});

test('a blank confirmation does not send', () => {
  const policy = loadPolicy();
  const send = policy.sendDecision({ allowed: true, wroteFirst: true, ok: true, kind: 'direct', text: '   ' });
  assert.equal(send.reason, 'needs_ok');
  assert.equal(send.send, false);
});

test('the stable id is the phone or the group id, including after a rename', () => {
  const policy = loadPolicy();
  const bia = { id: { _serialized: '123@lid' }, contact: { phoneNumber: { _serialized: '5511988887777@c.us' } } };
  const named = policy.identityOf(bia, '~Bia');
  assert.equal(named.key, '5511988887777');
  assert.equal(named.kind, 'direct');
  assert.equal(named.name, '~Bia');
  assert.equal(named.waId, '123@lid');
  assert.equal(named.phone, '5511988887777');
  assert.equal(policy.identityOf(bia, 'Bia Lima').key, '5511988887777');
  const fromJid = policy.identityOf({ id: { _serialized: '5511988887777@c.us' }, contact: {} }, 'Bia');
  assert.equal(fromJid.key, '5511988887777');
  const group = policy.identityOf({ id: { _serialized: '120363@g.us' } }, 'Family');
  assert.equal(group.key, '120363@g.us');
  assert.equal(group.kind, 'group');
  assert.equal(group.phone, '');
  assert.equal(policy.allow({ key: 'Family', kind: 'direct', name: 'Family' }), false);
  assert.equal(policy.allows('Family'), false);
});

test('saved names migrate to a phone or a group id, and the rest stay unresolved', () => {
  const policy = loadPolicy();
  const known = [
    { id: '120363@g.us', name: 'Family', phone: '' },
    { id: '1@lid', name: 'Bia', phone: '5511988887777' },
    { id: '2@lid', name: 'Bia', phone: '5511900000000' },
    { id: '3@lid', name: 'Carlos', phone: '' },
    { id: '4@lid', name: 'Ana', phone: '5511911112222' },
  ];
  const result = policy.migrateNames(
    ['Family', 'family', '+55 11 98888-7777', '11 91111-2222', 'Bia', 'Carlos', 'Ghost', '120363999@g.us', '', '7777'],
    known,
  );
  assert.equal(JSON.stringify(result.entries.map(e => [e.key, e.kind])), JSON.stringify([
    ['120363@g.us', 'group'],
    ['5511988887777', 'direct'],
    ['5511911112222', 'direct'],
    ['120363999@g.us', 'group'],
  ]));
  assert.equal(JSON.stringify(result.unresolved), JSON.stringify([
    { name: 'family', reason: 'duplicate_id' },
    { name: 'Bia', reason: 'ambiguous' },
    { name: 'Carlos', reason: 'no_phone' },
    { name: 'Ghost', reason: 'not_seen' },
    { name: '', reason: 'empty' },
    { name: '7777', reason: 'not_seen' },
  ]));
});

test('a number that matches two chats is not guessed', () => {
  const policy = loadPolicy();
  const result = policy.migrateNames(['98888-7777'], [
    { id: '1@lid', name: 'Bia', phone: '5511988887777' },
    { id: '2@lid', name: 'Teo', phone: '5521988887777' },
  ]);
  assert.equal(result.entries.length, 0);
  assert.equal(result.unresolved[0].reason, 'ambiguous');
});

function chatRow(name, model, unread) {
  return {
    __reactFiber$x: { return: { memoizedProps: { data: { data: model } } } },
    querySelector: (sel) => (String(sel).includes('secondary') ? { getAttribute: () => 'preview' } : { getAttribute: () => name }),
    querySelectorAll: () => (unread ? [{ getAttribute: () => `${unread} unread messages` }] : []),
  };
}

test('an unlisted chat is not signalled and its text is not stored', () => {
  const model = {
    id: { _serialized: '123@lid' },
    contact: { phoneNumber: { _serialized: '5511988887777@c.us' } },
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const storage = {};
  const signals = [];
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, world(storage, () => [chatRow('Bia', model, 1)], signals, []), { filename: 'recipe.js' });
  assert.deepEqual(signals, []);
  assert.equal(JSON.stringify(storage).includes('SECRET'), false);
  assert.equal(JSON.parse(storage['picode-whatsapp-wrote-v1'])['5511988887777'], 300);
  // My own message does not count as them writing.
  const storage3 = {};
  const mine = { ...model, msgs: { last: () => ({ t: 400, id: { fromMe: true }, type: 'chat', body: 'SECRET LINE' }) } };
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, world(storage3, () => [chatRow('Bia', mine, 0)], [], []), { filename: 'recipe.js' });
  assert.equal(storage3['picode-whatsapp-wrote-v1'], undefined);
});

test('an allowed chat is signalled, still without storing the text', () => {
  const storage = { 'picode-whatsapp-allow-v1': JSON.stringify({ '5511988887777': { kind: 'direct', name: 'Bia', waId: '123@lid' } }) };
  const model = {
    id: { _serialized: '123@lid' },
    contact: { phoneNumber: { _serialized: '5511988887777@c.us' } },
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  // Learn, then a newer incoming line.
  const storageA = { ...storage };
  const signals = [];
  const observers = [];
  const first = chatRow('Bia', { ...model, msgs: { last: () => ({ t: 100, id: { fromMe: false }, type: 'chat', body: 'old' }) } }, 0);
  let current = first;
  const sandbox = world(storageA, () => [current], signals, observers);
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, sandbox, { filename: 'recipe.js' });
  current = chatRow('Bia Lima', model, 0);
  observers[0]();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].preview, 'preview');
  assert.equal(signals[0].chat, 'Bia Lima');
  assert.equal(signals[0].phone, '5511988887777');
  assert.equal(JSON.stringify(storageA).includes('SECRET'), false);
});

test('saved names become ids when the chat list shows them, and the unseen stay', () => {
  const storage = { 'picode-whatsapp-allow-names': JSON.stringify(['Family', 'Ghost', '+55 11 98888-7777']) };
  const group = {
    id: { _serialized: '120363@g.us' },
    contact: {},
    msgs: { last: () => ({ t: 50, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const bia = {
    id: { _serialized: '9@lid' },
    contact: { phoneNumber: { _serialized: '5511988887777@c.us' } },
    msgs: { last: () => ({ t: 50, id: { fromMe: true }, type: 'chat', body: 'mine' }) },
  };
  const signals = [];
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, world(storage, () => [chatRow('Family', group, 0), chatRow('Bia', bia, 0)], signals, []), { filename: 'recipe.js' });
  const allow = JSON.parse(storage['picode-whatsapp-allow-v1']);
  assert.equal(allow['120363@g.us'].kind, 'group');
  assert.equal(allow['5511988887777'].kind, 'direct');
  assert.deepEqual(JSON.parse(storage['picode-whatsapp-allow-names']), ['Ghost']);
  assert.equal(JSON.stringify(storage).includes('SECRET'), false);
  assert.equal(signals.length, 0, 'the learning look does not announce');
});

function world(storage, rows, signals, observers) {
  const sandbox = {
    Map, Set, Object, JSON, Number, String, RegExp, Math, Date, Array,
    localStorage: {
      getItem: k => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = String(v); },
    },
    document: {
      title: 'WhatsApp',
      documentElement: {},
      body: { prepend() {}, append() {} },
      getElementById: (id) => (id === 'pane-side' ? { querySelectorAll: rows } : null),
      querySelector: (sel) => (sel === 'title' ? {} : null),
      createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {} }),
      addEventListener() {},
    },
    MutationObserver: class { constructor(f) { observers.push(f); } observe() {} disconnect() {} },
    queueMicrotask: f => f(),
    setInterval() {},
    KeyboardEvent: function KeyboardEvent() {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { picode: { signal: (n, d) => signals.push(d), badge() {}, chats() {} } };
  return sandbox;
}

test('Enter does not send until the person confirms that exact text, and only once', () => {
  const ident = { key: '5511988887777', kind: 'direct', name: 'Bia', waId: '123@lid', phone: '5511988887777' };
  const storage = {};
  const host = sendHost(storage, ident);
  host.composer.innerText = TEXT;
  const blocked = host.press();
  assert.equal(blocked.stopped, true);
  assert.deepEqual(host.sent, []);
  assert.equal(host.policy.notice.reason, 'chat_not_allowed');
  assert.equal(host.policy.notice.text, '');
  host.policy.allow(ident);
  const unwritten = host.press();
  assert.equal(unwritten.stopped, true);
  assert.equal(host.policy.notice.reason, 'never_write_first');
  host.policy.markWrote(ident.key, 10);
  const needs = host.press();
  assert.equal(needs.stopped, true);
  assert.equal(host.policy.notice.reason, 'needs_ok');
  assert.equal(host.policy.notice.text, TEXT);
  assert.deepEqual(host.sent, []);
  host.policy.onConfirm({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.deepEqual(host.sent, [TEXT]);
  const again = host.press();
  assert.equal(again.stopped, true, 'the OK was for that one send');
  assert.equal(JSON.stringify(storage).includes(TEXT), false);
});

test('a group that has not written is refused, and Shift+Enter is left alone', () => {
  const ident = { key: '120363@g.us', kind: 'group', name: 'Family', waId: '120363@g.us', phone: '' };
  const host = sendHost({}, ident);
  host.policy.allow(ident);
  host.composer.innerText = TEXT;
  const blocked = host.press();
  assert.equal(blocked.stopped, true);
  assert.equal(host.policy.notice.reason, 'never_write_first');
  host.policy.markWrote(ident.key, 5);
  const shift = host.press({ shiftKey: true });
  assert.equal(shift.stopped, false);
  assert.deepEqual(host.sent, [], 'a newline is not a send');
});

test('the send button is the same gate as Enter', () => {
  const ident = { key: '5511988887777', kind: 'direct', name: 'Bia', waId: '1@lid', phone: '5511988887777' };
  const host = sendHost({}, ident);
  host.policy.allow(ident);
  host.policy.markWrote(ident.key, 5);
  host.composer.innerText = TEXT;
  const button = {
    closest(sel) {
      const s = String(sel);
      if (s.includes('data-picode-wa')) return null;
      if (s.includes('#main') || s.includes('button') || s.includes('data-icon')) return button;
      return null;
    },
    getAttribute: (n) => (n === 'data-icon' ? 'send' : ''),
    querySelector: () => null,
  };
  const ev = {
    target: button, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  host.policy.onClick(ev);
  assert.equal(ev.stopped, true);
  assert.equal(host.policy.notice.reason, 'needs_ok');
  const ours = {
    closest(sel) { return String(sel).includes('data-picode-wa') ? ours : null; },
  };
  const skip = { target: ours, stopped: false, preventDefault() {}, stopPropagation() {} };
  host.policy.onClick(skip);
  assert.equal(skip.stopped, false);
});

function sendHost(storage, ident) {
  const sent = [];
  const capture = [];
  const composer = {
    innerText: '',
    closest(sel) {
      const s = String(sel);
      if (s.includes('data-picode-wa')) return null;
      if (s.includes('contenteditable') || s.includes('#main footer')) return composer;
      return null;
    },
    dispatchEvent() {
      const ev = {
        key: 'Enter', shiftKey: false, isComposing: false, target: composer,
        defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; },
      };
      for (const fn of capture) fn(ev);
      if (!ev.stopped) sent.push(composer.innerText);
    },
  };
  const sandbox = {
    Map, Set, Object, JSON, Number, String, RegExp, Math, Date, Array,
    localStorage: {
      getItem: k => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = String(v); },
    },
    KeyboardEvent: function KeyboardEvent() {},
    document: {
      body: { prepend() {} },
      getElementById: () => null,
      querySelector: (sel) => (sel === '#main footer [contenteditable="true"]' ? composer : null),
      createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {}, remove() {} }),
      addEventListener(type, fn, flag) { if (type === 'keydown' && flag) capture.push(fn); },
    },
    setInterval() {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(guardSource, sandbox, { filename: 'guard.js' });
  const policy = sandbox.__picodeWhatsappPolicy;
  policy.setReader(() => ident);
  return {
    policy, sent, composer, storage,
    press(extra) {
      const ev = {
        key: 'Enter', shiftKey: false, isComposing: false, target: composer,
        defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...extra,
      };
      for (const fn of capture) fn(ev);
      if (!ev.stopped && !ev.shiftKey) sent.push(composer.innerText);
      return ev;
    },
  };
}
