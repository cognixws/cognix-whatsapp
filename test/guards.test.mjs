import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const guardSource = readFileSync(new URL('../recipe/guard.js', import.meta.url), 'utf8');
const signalsSource = readFileSync(new URL('../recipe/signals.js', import.meta.url), 'utf8');

function loadPolicy(storage, extra) {
  const sandbox = {
    Map, Set, Object, JSON, Number, String, RegExp, Math, Date, Array,
    localStorage: storage,
    document: undefined,
    ...extra,
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

function world(storage, rows, signals, observers, extra) {
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
    ...extra,
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

function sendHost(storage, ident, extra = {}) {
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
    ...extra,
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

function lidMap(phoneFor) {
  return (name) => {
    if (name !== 'WAWebApiContact') return {};
    return {
      getPhoneNumber(wid) {
        const id = wid && (wid._serialized || (typeof wid.toString === 'function' ? wid.toString() : ''));
        const phone = phoneFor(String(id || ''));
        return phone ? { _serialized: phone + '@c.us' } : undefined;
      },
      getCurrentLid() {},
    };
  };
}

test('an @lid chat becomes its phone id, and Allow stores that phone', () => {
  const policy = loadPolicy(undefined, { require: lidMap(id => (id === '999001@lid' ? '5519983461234' : '')) });
  const model = { id: { _serialized: '999001@lid', user: '999001', server: 'lid' }, contact: {} };
  const ident = policy.identityOf(model, 'Carlos Perche');
  assert.equal(ident.key, '5519983461234');
  assert.equal(ident.kind, 'direct');
  assert.equal(ident.waId, '999001@lid');
  assert.equal(ident.phone, '5519983461234');
  assert.equal(policy.allow(ident), true);
  assert.equal(policy.allows('5519983461234'), true);
  assert.equal(policy.allows('999001'), false);
  assert.equal(policy.allow({ key: '999001', kind: 'direct', name: 'Carlos Perche' }), false);
  policy.markWrote(ident.key, 20);
  const send = policy.sendDecision({
    allowed: policy.allows(ident.key),
    wroteFirst: policy.wroteFirst(ident.key),
    ok: true,
    kind: ident.kind,
    text: 'hi',
  });
  assert.equal(send.send, true);
  assert.equal(send.reason, 'ok');
  const stored = JSON.parse(policy.state().storage.getItem('picode-whatsapp-allow-v1'));
  assert.equal(stored['5519983461234'].waId, '999001@lid');
  assert.equal(stored['999001@lid'], undefined);
});

test('an @lid with no phone is still refused', () => {
  let looked = 0;
  const policy = loadPolicy(undefined, {
    require: (name) => {
      if (name !== 'WAWebApiContact') return {};
      return {
        getPhoneNumber(wid) { looked += 1; return wid && wid._serialized === '999001@lid' ? undefined : undefined; },
        getCurrentLid() {},
        getLidEntry() { return undefined; },
      };
    },
  });
  const model = { id: { _serialized: '999001@lid' }, contact: {} };
  assert.equal(policy.identityOf(model, 'Carlos Perche'), null);
  assert.equal(policy.identityOf({ id: { _serialized: '5511988887777@lid' }, contact: {} }, '+55 19 98346-1234'), null);
  assert.ok(looked > 0, 'the lid map is consulted');
  const send = policy.sendDecision({ allowed: true, wroteFirst: true, ok: true, kind: '', text: TEXT });
  assert.equal(send.send, false);
  assert.equal(send.reason, 'no_stable_id');
  assert.equal(policy.releaseInbound({ preview: 'SECRET LINE' }, true, ''), null);
});

test('a phone wid without _serialized, and the formatted number, are already on the chat', () => {
  const policy = loadPolicy();
  const byUser = policy.identityOf({
    id: { _serialized: '999001@lid' },
    contact: { phoneNumber: { user: '5519983461234', server: 'c.us' } },
  }, 'Carlos Perche');
  assert.equal(byUser.key, '5519983461234');
  const shown = policy.identityOf({
    id: { _serialized: '999001@lid' },
    contact: { formattedPhone: '+55 19 98346-1234' },
  }, 'Carlos Perche');
  assert.equal(shown.key, '5519983461234');
  const onContact = policy.identityOf({
    id: { _serialized: '999001@lid' },
    contact: { id: { _serialized: '5519983461234@s.whatsapp.net' } },
  }, 'Carlos Perche');
  assert.equal(onContact.key, '5519983461234');
  assert.equal(policy.identityOf({
    id: { _serialized: '999001@lid' },
    contact: { phoneNumber: { user: '999001', server: 'lid' } },
  }, 'Carlos Perche'), null);
});

test('the lid map is also read from an already loaded webpack module', () => {
  let pushes = 0;
  const chunk = {
    push(item) {
      pushes += 1;
      item[2]({
        c: {
          7: {
            exports: {
              lidPnCache: {
                getPhoneNumber(wid) { return wid && wid._serialized === '42@lid' ? undefined : undefined; },
                getCurrentLid() {},
                getLidEntry(wid) {
                  return wid && wid._serialized === '42@lid'
                    ? { phoneNumber: { _serialized: '5511911112222@s.whatsapp.net' } }
                    : undefined;
                },
              },
            },
          },
        },
      });
    },
  };
  const policy = loadPolicy(undefined, { webpackChunkwhatsapp_web_client: chunk });
  const ident = policy.identityOf({ id: { _serialized: '42@lid' }, contact: {} }, 'Ana');
  assert.equal(ident.key, '5511911112222');
  policy.identityOf({ id: { _serialized: '42@lid' }, contact: {} }, 'Ana');
  assert.equal(pushes, 1, 'the module cache is kept');
  assert.equal(policy.allow(ident), true);
});

test('a webpack chunk that does not yield the map is pushed once', () => {
  let now = 10_000;
  let pushes = 0;
  const policy = loadPolicy(undefined, {
    Date: { now: () => now },
    webpackChunkwhatsapp_web_client: { push() { pushes += 1; } },
  });
  assert.equal(policy.identityOf({ id: { _serialized: '42@lid' }, contact: {} }, 'Ana'), null);
  now = 20_000;
  assert.equal(policy.identityOf({ id: { _serialized: '42@lid' }, contact: {} }, 'Ana'), null);
  assert.equal(pushes, 1);
});

test('a group and an unsaved number do not go through the lid map', () => {
  let called = 0;
  const policy = loadPolicy(undefined, {
    require: () => ({
      getPhoneNumber() { called += 1; return { _serialized: '5500000000000@c.us' }; },
      getCurrentLid() {},
    }),
  });
  const group = policy.identityOf({ id: { _serialized: '120363@g.us' }, contact: {} }, 'Family');
  assert.equal(group.key, '120363@g.us');
  assert.equal(group.kind, 'group');
  assert.equal(group.phone, '');
  const unsaved = policy.identityOf({ id: { _serialized: '5511988887777@c.us' }, contact: {} }, '+55 11 98888-7777');
  assert.equal(unsaved.key, '5511988887777');
  assert.equal(unsaved.kind, 'direct');
  const net = policy.identityOf({ id: { _serialized: '5511911112222@s.whatsapp.net' }, contact: {} }, 'Ana');
  assert.equal(net.key, '5511911112222');
  assert.equal(called, 0);
});

function infoDrawer(name, phones, fiber) {
  const leaves = [
    { textContent: name, childElementCount: 0, children: [], getAttribute: (attr) => (attr === 'title' ? name : null) },
    ...phones.map((phone) => ({ textContent: phone, childElementCount: 0, children: [], getAttribute: () => null })),
  ];
  const root = {
    __reactFiber$x: fiber || null,
    querySelectorAll(sel) {
      const text = String(sel);
      if (text.includes('title') || text.includes('heading')) return leaves.filter((leaf) => leaf.getAttribute('title'));
      return leaves;
    },
  };
  return root;
}

test('the open contact info is the fallback, and only for that chat', () => {
  const model = { id: { _serialized: '999001@lid' }, contact: {} };
  const doc = {
    querySelector: (sel) => (String(sel).includes('drawer-right') ? infoDrawer('Carlos Perche', ['+55 19 98346-1234']) : null),
  };
  const policy = loadPolicy(undefined, { document: doc });
  assert.equal(policy.drawerPhone('Carlos Perche', model), '5519983461234');
  const ident = policy.identityOf(model, 'Carlos Perche', policy.drawerPhone('Carlos Perche', model));
  assert.equal(ident.key, '5519983461234');
  assert.equal(policy.allow(ident), true);
  assert.equal(policy.drawerPhone('Other', model), '');
  assert.equal(policy.identityOf(model, 'Other', policy.drawerPhone('Other', model)), null);
  const two = loadPolicy(undefined, {
    document: { querySelector: () => infoDrawer('Carlos Perche', ['+55 19 98346-1234', '+55 11 98888-7777']) },
  });
  assert.equal(two.drawerPhone('Carlos Perche', model), '');
  const cached = loadPolicy(undefined, {
    document: doc,
    require: lidMap(() => '5519983461234'),
  });
  assert.equal(cached.identityOf(model, 'Carlos Perche', '5511000000000').key, '5519983461234');
  const fiber = {
    memoizedProps: {
      contact: {
        id: { _serialized: '999001@lid' },
        phoneNumber: { user: '5519983469999', server: 'c.us' },
      },
    },
  };
  const fromState = loadPolicy(undefined, {
    document: { querySelector: () => infoDrawer('Wrong name', [], fiber) },
  });
  assert.equal(fromState.drawerPhone('Wrong name', model), '5519983469999');
});

test('the header Allow button uses the phone resolved for the open @lid chat', () => {
  const model = { id: { _serialized: '999001@lid' }, contact: {} };
  const row = {
    __reactFiber$x: { memoizedProps: { data: { data: model } } },
    querySelector: (sel) => (String(sel).includes('title') ? { getAttribute: () => 'Carlos Perche' } : null),
  };
  const header = { children: [], append(node) { header.children.push(node); } };
  const document = {
    addEventListener() {},
    getElementById: () => null,
    querySelector: (sel) => {
      const text = String(sel);
      if (text === '#pane-side [aria-selected="true"]') return row;
      if (text === '#main header') return header;
      return null;
    },
    createElement: (tag) => {
      const node = {
        tag, style: {}, children: [], textContent: '', disabled: false,
        setAttribute() {},
        append(...kids) { node.children.push(...kids); },
        addEventListener(type, fn) { node['on' + type] = fn; },
        querySelector: (sel) => node.children.find((child) => child.tag === (sel === 'span' ? 'span' : 'button')) || null,
        remove() {},
      };
      return node;
    },
  };
  const policy = loadPolicy(undefined, {
    document,
    setInterval() {},
    require: lidMap(id => (id === '999001@lid' ? '5519983461234' : '')),
  });
  const button = header.children[0].children[0];
  assert.equal(button.textContent, 'Allow 5519983461234');
  assert.equal(button.disabled, false);
  button.onclick({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(policy.allows('5519983461234'), true);
  assert.equal(policy.allows('999001'), false);
});

test('signals allow and refuse an @lid by the resolved phone', () => {
  const carlos = {
    id: { _serialized: '999001@lid' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const ghost = {
    id: { _serialized: '888@lid' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const unsaved = {
    id: { _serialized: '5511988887777@c.us' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const group = {
    id: { _serialized: '120363@g.us' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const storage = {
    'picode-whatsapp-allow-v1': JSON.stringify({
      '5519983461234': { kind: 'direct', name: 'Carlos Perche', waId: '999001@lid' },
      '5511988887777': { kind: 'direct', name: '', waId: '5511988887777@c.us' },
      '120363@g.us': { kind: 'group', name: 'Family', waId: '120363@g.us' },
    }),
    'picode-whatsapp-seen-v2': JSON.stringify({
      '999001@lid': { c: 0, t: 100 },
      '888@lid': { c: 0, t: 100 },
      '5511988887777@c.us': { c: 0, t: 100 },
      '120363@g.us': { c: 0, t: 100 },
    }),
  };
  const signals = [];
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, world(storage, () => [
    chatRow('Carlos Perche', carlos, 0),
    chatRow('Ghost', ghost, 0),
    chatRow('+55 11 98888-7777', unsaved, 0),
    chatRow('Family', group, 0),
  ], signals, [], {
    require: lidMap(id => (id === '999001@lid' ? '5519983461234' : '')),
  }), { filename: 'recipe.js' });
  assert.deepEqual(signals.map(s => [s.chat, s.id, s.phone]), [
    ['Carlos Perche', '999001@lid', '5519983461234'],
    ['+55 11 98888-7777', '5511988887777@c.us', '5511988887777'],
    ['Family', '120363@g.us', ''],
  ]);
  const wrote = JSON.parse(storage['picode-whatsapp-wrote-v1']);
  assert.equal(wrote['5519983461234'], 300);
  assert.equal(wrote['5511988887777'], 300);
  assert.equal(wrote['120363@g.us'], 300);
  assert.equal(wrote['888@lid'], undefined);
  assert.equal(wrote['888'], undefined);
  assert.equal(JSON.stringify(storage).includes('SECRET'), false);
});

test('only the open chat borrows the number from contact info', () => {
  const selected = {
    id: { _serialized: '999001@lid' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const other = {
    id: { _serialized: '888@lid' },
    contact: {},
    msgs: { last: () => ({ t: 300, id: { fromMe: false }, type: 'chat', body: 'SECRET LINE' }) },
  };
  const row = (name, model, open) => ({
    getAttribute: (attr) => (attr === 'aria-selected' && open ? 'true' : null),
    __reactFiber$x: { return: { memoizedProps: { data: { data: model } } } },
    querySelector: (sel) => (String(sel).includes('secondary') ? { getAttribute: () => 'preview' } : { getAttribute: () => name }),
    querySelectorAll: () => [],
  });
  const storage = {
    'picode-whatsapp-allow-v1': JSON.stringify({
      '5519983461234': { kind: 'direct', name: 'Carlos Perche', waId: '999001@lid' },
    }),
    'picode-whatsapp-seen-v2': JSON.stringify({
      '999001@lid': { c: 0, t: 100 },
      '888@lid': { c: 0, t: 100 },
    }),
  };
  const signals = [];
  const drawer = infoDrawer('Carlos Perche', ['+55 19 98346-1234']);
  const document = {
    title: 'WhatsApp',
    documentElement: {},
    body: { prepend() {}, append() {} },
    getElementById: (id) => (id === 'pane-side' ? { querySelectorAll: () => [row('Carlos Perche', selected, true), row('Carlos Perche', other, false)] } : null),
    querySelector: (sel) => {
      const text = String(sel);
      if (text === 'title') return {};
      if (text.includes('drawer-right') || text.includes('contact-info')) return drawer;
      return null;
    },
    createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {} }),
    addEventListener() {},
  };
  vm.runInNewContext(guardSource + '\n;\n' + signalsSource, world(storage, () => [], signals, [], {
    document,
    require: lidMap(() => ''),
  }), { filename: 'recipe.js' });
  assert.deepEqual(signals.map(s => [s.id, s.phone]), [['999001@lid', '5519983461234']]);
  const wrote = JSON.parse(storage['picode-whatsapp-wrote-v1']);
  assert.equal(wrote['5519983461234'], 300);
  assert.equal(Object.keys(wrote).length, 1);
  assert.equal(JSON.stringify(storage).includes('SECRET'), false);
});

// COGNIX[WS] with doors N and O (picode v4, ADR-0403): the list lives there.
function fakeHost() {
  const posted = [];
  const ears = { subjects: [], verdict: [] };
  const picode = {
    v: 4,
    subjects: {
      allow: (x) => posted.push({ ...x, op: 'allow' }),
      remove: (key) => posted.push({ op: 'remove', key }),
      import: (entries) => posted.push({ op: 'import', entries }),
      list: () => { posted.push({ op: 'list' }); return null; },
    },
    on: (name, fn) => { ears[name].push(fn); return () => {}; },
  };
  return { picode, posted, push: (name, value) => ears[name].forEach((fn) => fn(value)) };
}

function memory(seed = {}) {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('with COGNIX doors the old list is imported once, then the page keeps COGNIX\'s copy', () => {
  const storage = memory({ 'picode-whatsapp-allow-v1': JSON.stringify({ '5511999990000': { kind: 'direct', name: 'Bia' }, 'bad': { kind: 'direct' } }) });
  const host = fakeHost();
  const policy = loadPolicy(storage, { picode: host.picode });
  assert.equal(policy.allows('5511999990000'), true, 'the old list answers until COGNIX sends its own');
  assert.equal(policy.hosted(), true);
  assert.deepEqual(host.posted.map((m) => m.op), ['import', 'list']);
  assert.deepEqual(JSON.parse(JSON.stringify(host.posted[0].entries)), [{ key: '5511999990000', kind: 'direct', name: 'Bia' }]);
  assert.equal(storage.data['picode-whatsapp-allow-v1'], '{}', 'cleared after the import');
  host.push('subjects', [{ key: '120363@g.us', kind: 'group', name: 'Work' }]);
  assert.equal(policy.allows('5511999990000'), false, 'COGNIX\'s list wins');
  assert.equal(policy.allows('120363@g.us'), true);
  assert.ok(storage.data['picode-whatsapp-subjects-cache-v1'].includes('120363@g.us'));
  // A second load imports nothing again and starts from the copy.
  const again = fakeHost();
  const p2 = loadPolicy(storage, { picode: again.picode });
  assert.equal(p2.allows('120363@g.us'), true);
  assert.deepEqual(again.posted.map((m) => m.op), ['list']);
});

test('with COGNIX doors Allow and Remove write to COGNIX, not to this page', () => {
  const storage = memory();
  const host = fakeHost();
  const policy = loadPolicy(storage, { picode: host.picode });
  assert.equal(policy.allow({ key: '5511888880000', kind: 'direct', name: 'Ana' }), true);
  policy.disallow('5511888880000');
  assert.deepEqual(host.posted.filter((m) => m.op !== 'list').map((m) => [m.op, m.key]), [['allow', '5511888880000'], ['remove', '5511888880000']]);
  assert.equal(storage.data['picode-whatsapp-allow-v1'], undefined, 'nothing kept here');
  assert.equal(policy.allow({ key: 'Ana', kind: 'direct' }), false, 'a name is still not an id');
});

test('an older COGNIX keeps the list in this page', () => {
  const storage = memory();
  const policy = loadPolicy(storage, { picode: { v: 3, signal() {}, badge() {} } });
  policy.allow({ key: '5511888880000', kind: 'direct', name: 'Ana' });
  assert.equal(policy.hosted(), false);
  assert.ok(storage.data['picode-whatsapp-allow-v1'].includes('5511888880000'));
});

// Door O (0.8.0, ADR-0403): with picode.ask the page holds the send and
// COGNIX[WS] decides; the page sends that text once on a yes.
function askHost(ident, { verdict } = {}) {
  const storage = {};
  const asked = [];
  const outcomes = [];
  const ears = [];
  let resolveFirst = null;
  const picode = {
    v: 4,
    subjects: { allow() {}, remove() {}, import() {}, list() { return null; } },
    on: (name, fn) => { if (name === 'verdict') ears.push(fn); return () => {}; },
    ask: (action, data) => { asked.push({ action, ...data }); return new Promise((r) => { resolveFirst = r; }); },
    outcome: (requestId, outcome, item) => outcomes.push([requestId, outcome, item]),
  };
  const host = sendHost(storage, ident, { picode, setTimeout() { return 0; }, clearTimeout() {} });
  host.policy.allow(ident);
  host.policy.markWrote(ident.key, 1_700_000_000);
  return {
    ...host, asked, outcomes,
    first: async (v) => { resolveFirst(v); await Promise.resolve(); await Promise.resolve(); },
    later: (v) => ears.forEach((fn) => fn(v)),
  };
}

const BIA = { key: '5511988887777', kind: 'direct', name: 'Bia', waId: '123@lid', phone: '5511988887777' };

test('door O: Enter asks COGNIX, the card\'s yes sends that text once, and says so', async () => {
  const h = askHost(BIA);
  h.composer.innerText = TEXT;
  assert.equal(h.press().stopped, true);
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].subject, BIA.key);
  assert.equal(h.asked[0].text, TEXT);
  assert.equal(h.asked[0].lastInboundAt, 1_700_000_000_000, 'seconds become milliseconds');
  assert.equal(h.policy.notice.reason, 'waiting');
  await h.first({ requestId: 'r1', verdict: 'wait', item: 'inb-1' });
  assert.equal(h.press().stopped, true, 'a second Enter does not ask twice');
  assert.equal(h.asked.length, 1);
  h.later({ requestId: 'r1', verdict: 'send', item: 'inb-1', until: '' });
  assert.deepEqual(h.sent, [TEXT]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.outcomes)), [['r1', 'sent', 'inb-1']]);
  assert.equal(h.policy.notice.reason, 'sent');
  assert.equal(h.press().stopped, true, 'the yes was for that one send');
  assert.equal(h.asked.length, 2);
});

test('door O: a grant answers at once; a no keeps the text unsent', async () => {
  const h = askHost(BIA);
  h.composer.innerText = TEXT;
  h.press();
  await h.first({ requestId: 'r1', verdict: 'send', until: 'always' });
  assert.deepEqual(h.sent, [TEXT]);
  assert.match(h.policy.notice.line, /^Sent \(allowed always\)\.$/);
  h.composer.innerText = 'Another';
  h.press();
  await h.first({ requestId: 'r2', verdict: 'wait', item: 'inb-2' });
  h.later({ requestId: 'r2', verdict: 'deny', item: 'inb-2' });
  assert.deepEqual(h.sent, [TEXT]);
  assert.equal(h.policy.notice.reason, 'denied');
  assert.deepEqual(h.outcomes.length, 1);
});

test('door O: a changed text, or a yes for a request the page let go, sends nothing', async () => {
  const h = askHost(BIA);
  h.composer.innerText = TEXT;
  h.press();
  await h.first({ requestId: 'r1', verdict: 'wait', item: 'inb-1' });
  h.composer.innerText = TEXT + ' (edited)';
  h.later({ requestId: 'r1', verdict: 'send', item: 'inb-1' });
  assert.deepEqual(h.sent, []);
  assert.equal(h.policy.notice.reason, 'changed');
  h.later({ requestId: 'old', verdict: 'send', item: 'inb-0' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.outcomes)), [['r1', 'lost', 'inb-1'], ['old', 'lost', 'inb-0']]);
});

test('door O: the page still refuses an unlisted chat and writing first, without asking', () => {
  const h = askHost(BIA);
  h.policy.disallow(BIA.key);
  h.composer.innerText = TEXT;
  h.press();
  assert.equal(h.policy.notice.reason, 'chat_not_allowed');
  assert.equal(h.asked.length, 0);
});
