// Send and inbound guards for the personal number (the linked WhatsApp Web
// session in this panel). Three rules, applied here because this page is where
// the text is, before it is kept or sent:
//
// 1. A chat is allowed by its phone number or its group id, never by the name
//    WhatsApp shows. Anything else is dropped before a notice is sent.
// 2. Nothing is sent to a chat that has not written first.
// 3. A send still needs a confirmation of that exact text, every time.
//
// The official source does not send and is not this file. No message body is
// written to storage: the allow-list and the "has written" map are ids and times.
(() => {
  const ALLOW_KEY = 'picode-whatsapp-allow-v1';
  const WROTE_KEY = 'picode-whatsapp-wrote-v1';
  const NAMES_KEY = 'picode-whatsapp-allow-names';
  const SEND_LABEL = /^(send|enviar|envoyer|senden|invia|verstuur)$/i;

  const SENTENCE = {
    chat_not_allowed: 'This chat is not allowed. Allow it by its number or group id first.',
    never_write_first: 'This chat has not written yet. Nothing is sent first.',
    no_stable_id: 'This chat has no phone number or group id, so nothing is sent.',
    needs_ok: 'Send this exact message?',
  };

  function validKey(kind, key) {
    if (kind === 'group') return typeof key === 'string' && /^[0-9A-Za-z._-]{1,64}@g\.us$/.test(key);
    if (kind === 'direct') return typeof key === 'string' && /^\d{8,15}$/.test(key);
    return false;
  }

  function digitsOf(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function serializedId(model) {
    try {
      const id = model && model.id;
      if (!id) return '';
      if (typeof id === 'string') return id;
      return typeof id._serialized === 'string' ? id._serialized : '';
    } catch { return ''; }
  }

  function phoneDigits(model) {
    try {
      const p = model && model.contact && model.contact.phoneNumber;
      const raw = p && (p._serialized || p);
      if (typeof raw !== 'string') return '';
      const digits = digitsOf(raw.split('@')[0]);
      return /^\d{8,15}$/.test(digits) ? digits : '';
    } catch { return ''; }
  }

  // The stable id: a group's id, or a person's phone number. A lid with no
  // phone is not stable enough, and a display name never is.
  function identityOf(model, title) {
    const waId = serializedId(model);
    const name = typeof title === 'string' ? title : '';
    if (/^[0-9A-Za-z._-]{1,64}@g\.us$/.test(waId)) return { key: waId, kind: 'group', name, waId, phone: '' };
    const phone = phoneDigits(model);
    const user = waId.includes('@') ? digitsOf(waId.split('@')[0]) : '';
    const host = waId.includes('@') ? waId.split('@')[1] : '';
    const fromJid = (host === 'c.us' || host === 's.whatsapp.net') && /^\d{8,15}$/.test(user) ? user : '';
    const key = phone || fromJid;
    if (!key) return null;
    return { key, kind: 'direct', name, waId, phone: key };
  }

  function sendDecision({ allowed, wroteFirst, ok, kind, text }) {
    const body = typeof text === 'string' ? text : '';
    if (kind !== 'direct' && kind !== 'group') return { send: false, reason: 'no_stable_id' };
    if (!allowed) return { send: false, reason: 'chat_not_allowed' };
    if (!wroteFirst) return { send: false, reason: 'never_write_first' };
    if (!ok || body.trim() === '') return { send: false, reason: 'needs_ok' };
    return { send: true, reason: 'ok' };
  }

  // Inbound does not look at the OK or at who spoke. An unlisted chat is
  // dropped whole, so its text is neither kept nor forwarded.
  function inboundDecision({ allowed, kind }) {
    if (kind !== 'direct' && kind !== 'group') return { keep: false, forwardText: false, reason: 'no_stable_id' };
    if (!allowed) return { keep: false, forwardText: false, reason: 'not_allowed' };
    return { keep: true, forwardText: true, reason: 'allowed' };
  }

  function releaseInbound(signal, allowed, kind) {
    const decision = inboundDecision({ allowed, kind });
    if (!decision.keep) return null;
    return {
      chat: signal.chat,
      id: signal.id,
      phone: signal.phone,
      count: signal.count,
      preview: decision.forwardText ? signal.preview : '',
    };
  }

  function considerSend(st, ident, text, pending) {
    const body = typeof text === 'string' ? text : '';
    const ok = !!(pending && ident && pending.key === ident.key && pending.text === body && body.trim() !== '');
    return sendDecision({
      allowed: !!(ident && allows(st, ident.key)),
      wroteFirst: !!(ident && wroteFirst(st, ident.key)),
      ok,
      kind: ident ? ident.kind : '',
      text: body,
    });
  }

  function readJSON(storage, key) {
    try {
      const raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeJSON(storage, key, value) {
    try { if (storage) storage.setItem(key, JSON.stringify(value)); } catch { /* kept in memory until the page will store */ }
  }

  function sanitizeAllow(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw)) {
      const kind = value && value.kind;
      if (!validKey(kind, key)) continue;
      out[key] = { kind, name: String(value.name || '').slice(0, 120), waId: String(value.waId || '').slice(0, 120) };
    }
    return out;
  }

  function sanitizeWrote(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw)) {
      if (!validKey('direct', key) && !validKey('group', key)) continue;
      const t = Number(value);
      if (Number.isFinite(t) && t > 0) out[key] = t;
    }
    return out;
  }

  function memoryStorage() {
    const data = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
    };
  }

  let memory = null;
  let current = null;

  function liveStorage() {
    try {
      const s = globalThis.localStorage;
      if (s) { s.getItem(ALLOW_KEY); return s; }
    } catch { /* the document is not ready to store yet */ }
    return null;
  }

  function createState(storage) {
    const names = readJSON(storage, NAMES_KEY);
    return {
      storage,
      allow: sanitizeAllow(readJSON(storage, ALLOW_KEY)),
      wrote: sanitizeWrote(readJSON(storage, WROTE_KEY)),
      names: Array.isArray(names) ? names.map(n => String(n || '').trim()).filter(Boolean).slice(0, 200) : [],
    };
  }

  function state() {
    const storage = liveStorage();
    if (storage && current && current.ephemeral) current = null;
    if (!current) {
      const s = storage || memory || (memory = memoryStorage());
      current = createState(s);
      current.ephemeral = !storage;
    }
    return current;
  }

  function allows(st, key) {
    return !!(key && st && st.allow && st.allow[key]);
  }

  function allow(st, entry) {
    if (!st || !entry || !validKey(entry.kind, entry.key)) return false;
    st.allow[entry.key] = {
      kind: entry.kind,
      name: String(entry.name || '').slice(0, 120),
      waId: String(entry.waId || '').slice(0, 120),
    };
    writeJSON(st.storage, ALLOW_KEY, st.allow);
    return true;
  }

  function disallow(st, key) {
    if (!st || !st.allow || !st.allow[key]) return;
    delete st.allow[key];
    writeJSON(st.storage, ALLOW_KEY, st.allow);
  }

  function markWrote(st, key, at) {
    if (!st || (!validKey('direct', key) && !validKey('group', key))) return;
    const t = Number(at);
    if (!Number.isFinite(t) || t <= 0 || t <= (st.wrote[key] || 0)) return;
    st.wrote[key] = t;
    writeJSON(st.storage, WROTE_KEY, st.wrote);
  }

  function wroteFirst(st, key) {
    return !!(st && key && st.wrote && st.wrote[key]);
  }

  function knownModel(chat) {
    const id = typeof chat.id === 'string' ? chat.id : '';
    const phone = digitsOf(chat.phone);
    return {
      id: { _serialized: id },
      contact: /^\d{8,15}$/.test(phone) ? { phoneNumber: { _serialized: phone + '@c.us' } } : {},
    };
  }

  // Names the owner saved before ids existed. A phone number is itself the id.
  // A name resolves only when exactly one chat now showing has it, and that
  // chat has a phone or a group id. Anything else stays unresolved.
  function migrateNames(names, known) {
    const entries = [];
    const unresolved = [];
    const used = new Set();
    const list = Array.isArray(known) ? known : [];
    for (const raw of Array.isArray(names) ? names : []) {
      const name = String(raw ?? '').trim();
      if (!name) { unresolved.push({ name: String(raw ?? ''), reason: 'empty' }); continue; }
      if (/^[0-9A-Za-z._-]{1,64}@g\.us$/.test(name)) {
        if (used.has(name)) unresolved.push({ name, reason: 'duplicate_id' });
        else { used.add(name); entries.push({ key: name, kind: 'group', name: '', waId: name }); }
        continue;
      }
      const onlyFmt = name.replace(/[\s+\-().]/g, '');
      if (/^\d{8,15}$/.test(onlyFmt)) {
        const hits = list.filter(k => k.phone && (k.phone === onlyFmt || String(k.phone).endsWith(onlyFmt)));
        if (hits.length > 1) { unresolved.push({ name, reason: 'ambiguous' }); continue; }
        const key = hits.length === 1 ? hits[0].phone : onlyFmt;
        if (!validKey('direct', key)) { unresolved.push({ name, reason: 'no_phone' }); continue; }
        if (used.has(key)) unresolved.push({ name, reason: 'duplicate_id' });
        else { used.add(key); entries.push({ key, kind: 'direct', name: hits[0] ? hits[0].name : '', waId: hits[0] ? hits[0].id || '' : '' }); }
        continue;
      }
      const matches = list.filter(k => String(k.name || '').trim().toLowerCase() === name.toLowerCase());
      if (matches.length === 0) { unresolved.push({ name, reason: 'not_seen' }); continue; }
      if (matches.length > 1) { unresolved.push({ name, reason: 'ambiguous' }); continue; }
      const ident = identityOf(knownModel(matches[0]), matches[0].name);
      if (!ident) { unresolved.push({ name, reason: 'no_phone' }); continue; }
      if (used.has(ident.key)) { unresolved.push({ name, reason: 'duplicate_id' }); continue; }
      used.add(ident.key);
      entries.push({ key: ident.key, kind: ident.kind, name: matches[0].name, waId: ident.waId });
    }
    return { entries, unresolved };
  }

  function migratePending(st, known) {
    if (!st.names.length) return { entries: [], unresolved: [] };
    const result = migrateNames(st.names, known);
    for (const entry of result.entries) allow(st, entry);
    const left = result.unresolved.filter(u => u.reason !== 'empty').map(u => u.name);
    const same = left.length === st.names.length && left.every((n, i) => n === st.names[i]);
    if (!same) {
      st.names = left;
      writeJSON(st.storage, NAMES_KEY, left);
    }
    api.lastMigration = result;
    return result;
  }

  function modelFrom(el) {
    try {
      if (!el) return null;
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
      let fiber = key ? el[key] : null;
      for (let i = 0; fiber && i < 12; i++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        const chat = props && props.data && props.data.data;
        if (chat && chat.id) return chat;
      }
    } catch { /* the internals move; the header still shows the name */ }
    return null;
  }

  let reader = null;
  function currentIdentity() {
    try { return (reader || defaultReader)(); } catch { return null; }
  }

  function defaultReader() {
    const doc = globalThis.document;
    if (!doc || !doc.querySelector) return null;
    const row = doc.querySelector('#pane-side [aria-selected="true"]');
    const headerTitle = doc.querySelector('#main header span[title]');
    let name = '';
    if (row && row.querySelector) {
      const span = row.querySelector('span[title]');
      name = span && span.getAttribute ? (span.getAttribute('title') || '') : '';
    }
    if (!name && headerTitle && headerTitle.getAttribute) name = headerTitle.getAttribute('title') || '';
    const main = doc.getElementById ? doc.getElementById('main') : null;
    return identityOf(modelFrom(row) || modelFrom(main), name);
  }

  function textOf(node) {
    if (!node) return '';
    const value = node.innerText != null ? node.innerText : node.textContent;
    return String(value || '');
  }

  function composerOf(target) {
    if (!target || !target.closest || target.closest('[data-picode-wa]')) return null;
    const box = target.closest('[contenteditable="true"]');
    if (!box || !box.closest) return null;
    if (box.closest('#main footer')) return box;
    const dialog = box.closest('[role="dialog"]');
    if (dialog && dialog.querySelector && dialog.querySelector('[data-icon="send"], [data-testid="send"]')) return box;
    return null;
  }

  function isSendControl(node) {
    if (!node || !node.closest || node.closest('[data-picode-wa]')) return false;
    if (!node.closest('#main, [role="dialog"]')) return false;
    if (node.closest('[data-icon="send"], [data-testid="send"]')) return true;
    const button = node.closest('button, [role="button"]');
    if (!button) return false;
    if (button.querySelector && button.querySelector('[data-icon="send"], [data-testid="send"]')) return true;
    const label = button.getAttribute ? (button.getAttribute('aria-label') || '') : '';
    return SEND_LABEL.test(String(label).trim());
  }

  function composerNode() {
    const doc = globalThis.document;
    if (!doc || !doc.querySelector) return null;
    const footer = doc.querySelector('#main footer [contenteditable="true"]');
    if (footer) return footer;
    const dialog = doc.querySelector('[role="dialog"]');
    if (!dialog || !dialog.querySelector) return null;
    if (!dialog.querySelector('[data-icon="send"], [data-testid="send"]')) return null;
    return dialog.querySelector('[contenteditable="true"]');
  }

  function openComposerText() {
    return textOf(composerNode());
  }

  let grant = null;

  function block(e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function clearNotice() {
    api.notice = null;
    const doc = globalThis.document;
    const have = doc && doc.getElementById && doc.getElementById('picode-wa-send-ok');
    if (have && have.remove) have.remove();
  }

  function showNotice(decision, text, ident) {
    const confirm = decision.reason === 'needs_ok';
    api.notice = {
      reason: decision.reason,
      key: ident ? ident.key : '',
      text: confirm ? text : '',
      confirm,
    };
    renderNotice();
  }

  function renderNotice() {
    const doc = globalThis.document;
    const spec = api.notice;
    if (!doc || !doc.createElement || !spec) return;
    const old = doc.getElementById && doc.getElementById('picode-wa-send-ok');
    if (old && old.remove) old.remove();
    const footer = doc.querySelector && doc.querySelector('#main footer');
    const host = footer || doc.body;
    if (!host || !host.prepend) return;
    const bar = doc.createElement('div');
    bar.id = 'picode-wa-send-ok';
    bar.setAttribute('data-picode-wa', '1');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;padding:8px 12px;background:rgba(127,127,127,.12);color:inherit;font:inherit;font-size:13px;';
    const line = doc.createElement('p');
    line.style.cssText = 'flex:1 1 160px;margin:0;max-height:3.2em;overflow:auto;';
    const who = spec.key ? ' to ' + spec.key : '';
    line.textContent = spec.confirm ? SENTENCE.needs_ok.replace('?', '') + who + '?' : (SENTENCE[spec.reason] || SENTENCE.no_stable_id);
    bar.append(line);
    if (spec.confirm) {
      const quote = doc.createElement('p');
      quote.style.cssText = 'flex:1 1 100%;margin:0;max-height:4.5em;overflow:auto;white-space:pre-wrap;';
      quote.textContent = spec.text;
      bar.append(quote);
      const send = doc.createElement('button');
      send.type = 'button';
      send.setAttribute('data-picode-wa', '1');
      send.textContent = 'Send';
      send.style.cssText = 'height:36px;padding:0 12px;border:0;border-radius:8px;background:inherit;color:inherit;font:inherit;cursor:pointer;';
      send.addEventListener('click', onConfirm);
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.setAttribute('data-picode-wa', '1');
      cancel.textContent = 'Cancel';
      cancel.style.cssText = send.style.cssText;
      cancel.addEventListener('click', (e) => { block(e); grant = null; clearNotice(); });
      bar.append(send, cancel);
    }
    host.prepend(bar);
  }

  function onKeyDown(e) {
    if (!e || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const composer = composerOf(e.target);
    if (!composer) return;
    const text = textOf(composer);
    if (!String(text).trim()) return;
    const ident = currentIdentity();
    const decision = considerSend(state(), ident, text, grant);
    if (decision.send) {
      grant = null;
      clearNotice();
      return;
    }
    block(e);
    showNotice(decision, text, ident);
  }

  function onClick(e) {
    if (!e || !isSendControl(e.target)) return;
    const text = openComposerText();
    if (!String(text).trim()) return;
    const ident = currentIdentity();
    const decision = considerSend(state(), ident, text, grant);
    if (decision.send) {
      grant = null;
      clearNotice();
      return;
    }
    block(e);
    showNotice(decision, text, ident);
  }

  function onConfirm(e) {
    if (e) block(e);
    const ident = currentIdentity();
    const text = openComposerText();
    if (!ident || !String(text).trim()) return;
    const decision = sendDecision({
      allowed: allows(state(), ident.key),
      wroteFirst: wroteFirst(state(), ident.key),
      ok: true,
      kind: ident.kind,
      text,
    });
    if (!decision.send) { showNotice(decision, text, ident); return; }
    grant = { key: ident.key, text };
    const box = composerNode();
    if (box && box.dispatchEvent && typeof KeyboardEvent === 'function') {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      return;
    }
    onKeyDown({
      key: 'Enter', shiftKey: false, isComposing: false, target: box,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    });
  }

  function allowLabel(ident) {
    if (!ident) return 'No number yet';
    const verb = allows(state(), ident.key) ? 'Remove ' : 'Allow ';
    return verb + (ident.kind === 'group' ? 'group ' : '') + ident.key;
  }

  function pendingLine() {
    const pending = state().names;
    if (!pending.length) return '';
    if (pending.length === 1) return pending[0].slice(0, 40) + ' still needs a phone number or group id.';
    return pending.length + ' saved names still need a phone number or group id.';
  }

  function paintAllow(button, note, ident) {
    button.textContent = allowLabel(ident);
    button.title = ident ? (ident.name || ident.key) : 'This chat has no phone number yet, so it cannot be allowed.';
    button.disabled = !ident;
    if (note) note.textContent = pendingLine();
  }

  function refreshAllow() {
    const doc = globalThis.document;
    if (!doc || !doc.querySelector || !doc.createElement) return;
    const header = doc.querySelector('#main header');
    if (!header || !header.append) return;
    const ident = currentIdentity();
    let wrap = doc.getElementById && doc.getElementById('picode-wa-allow');
    if (wrap && wrap.parentElement === header) {
      paintAllow(wrap.querySelector('button'), wrap.querySelector('span'), ident);
      return;
    }
    if (wrap && wrap.remove) wrap.remove();
    wrap = doc.createElement('div');
    wrap.id = 'picode-wa-allow';
    wrap.setAttribute('data-picode-wa', '1');
    wrap.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;margin-left:auto;font:inherit;font-size:12px;color:inherit;';
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-picode-wa', '1');
    button.style.cssText = 'height:28px;padding:0 10px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;';
    button.addEventListener('click', (e) => {
      block(e);
      const who = currentIdentity();
      if (!who) return;
      if (allows(state(), who.key)) disallow(state(), who.key);
      else allow(state(), who);
      refreshAllow();
    });
    const note = doc.createElement('span');
    wrap.append(button, note);
    paintAllow(button, note, ident);
    header.append(wrap);
  }

  function install(doc) {
    const target = doc || globalThis.document;
    if (!target || target.__picodeWaGuard || !target.addEventListener) return;
    target.__picodeWaGuard = true;
    target.addEventListener('keydown', onKeyDown, true);
    target.addEventListener('click', onClick, true);
    const tick = () => { try { refreshAllow(); } catch { /* the header is mid-render */ } };
    if (typeof setInterval === 'function') setInterval(tick, 1000);
    tick();
  }

  const api = {
    identityOf, sendDecision, inboundDecision, releaseInbound, considerSend, migrateNames,
    createState, allows, allow, disallow, markWrote, wroteFirst, validKey,
    state, install, onKeyDown, onClick, onConfirm, isSendControl, composerOf,
    setReader: (fn) => { reader = fn; },
    reload: () => { current = null; memory = null; },
    notice: null,
    lastMigration: null,
  };
  api.allows = (key) => allows(state(), key);
  api.allow = (entry) => allow(state(), entry);
  api.disallow = (key) => disallow(state(), key);
  api.markWrote = (key, at) => markWrote(state(), key, at);
  api.wroteFirst = (key) => wroteFirst(state(), key);
  api.migratePending = (known) => migratePending(state(), known);
  globalThis.__picodeWhatsappPolicy = api;
  try { install(globalThis.document); } catch { /* decisions stay available if the page is not ready */ }
})();
