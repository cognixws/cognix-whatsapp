// Page signals (COGNIX[WS] manifest version 9): tells COGNIX[WS] when a chat
// gets new messages, and how many chats are unread for the app's tile.
// It reads the chat list: each chat's name, id, number, unread count and last
// line. It sends nothing anywhere else: picode.signal and picode.badge hand them
// to COGNIX[WS]. A chat that is not allowed by phone number or group id is not
// reported at all, so its text is never handed on (recipe/guard.js).
(() => {
  if (!window.picode) return;
  // "3 mensagens não lidas", "1 unread message", … : the number counts, the
  // words depend on WhatsApp's language.
  const UNREAD = /^(\d+)\s.*(lid|unread|non lu|no le[ií]d|ungelesen)/i;
  // Chat name -> unread count last seen. Kept across reloads, in this session's own
  // storage on this computer, so a message that arrived while the page was down is
  // still news and an old unread one is not news twice.
  const KEY = 'picode-whatsapp-seen-v2';
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? new Map(Object.entries(JSON.parse(raw))) : null;
    } catch { return null; }
  };
  // Read at the first look, not now: the script can start before the page has a
  // document, when storage refuses to be read (seen live 2026-11-03).
  let seen = null; // chat id -> { c: unread count, t: last message's time }
  // With nothing remembered (a new session), the first look only learns.
  let primed = false;
  const recall = () => {
    if (seen) return;
    const remembered = load();
    seen = remembered || new Map();
    primed = !!remembered;
  };
  let dirty = false;
  let lastBadge = -1;
  const known = new Map(); // chat id -> what the picker in Notifications… offers
  const save = () => {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(seen))); } catch { /* lasts until a reload */ }
  };

  const unreadOf = (row) => {
    for (const e of row.querySelectorAll("[aria-label]")) {
      const m = UNREAD.exec(e.getAttribute("aria-label") || "");
      if (m) return Number(m[1]);
    }
    return 0;
  };

  // WhatsApp's own record of the chat behind a row: a stable id, the contact's
  // number and the last message. Its internals can change, so everything here is
  // optional and the row's name and count still work without it.
  const modelOf = (row) => {
    try {
      const key = Object.keys(row).find(k => k.startsWith('__reactFiber'));
      let fiber = key ? row[key].return : null;
      for (let i = 0; fiber && i < 6; i++, fiber = fiber.return) {
        const chat = fiber.memoizedProps && fiber.memoizedProps.data && fiber.memoizedProps.data.data;
        if (chat && chat.id) return chat;
      }
    } catch { /* see above */ }
    return null;
  };

  // Not somebody writing: WhatsApp's own lines in a chat.
  const NOTICE = new Set(['e2e_notification', 'gp2', 'notification', 'notification_template', 'call_log', 'protocol', 'ciphertext', 'revoked']);
  const lastOf = (chat) => {
    try {
      const m = chat && chat.msgs && chat.msgs.last && chat.msgs.last();
      if (!m || !m.id || typeof m.t !== 'number') return null;
      return { t: m.t, incoming: !m.id.fromMe && !NOTICE.has(m.type), type: m.type, body: typeof m.body === 'string' && m.type === 'chat' ? m.body : '' };
    } catch { return null; }
  };
  const phoneOf = (chat) => {
    const gate = globalThis.__picodeWhatsappPolicy;
    if (gate && typeof gate.phoneOf === 'function') {
      try {
        const resolved = gate.phoneOf(chat);
        if (typeof resolved === 'string') return resolved;
      } catch { /* the row still has its own fields */ }
    }
    try {
      const p = chat && chat.contact && chat.contact.phoneNumber;
      const raw = p && (p._serialized || p);
      return typeof raw === 'string' ? raw.split('@')[0] : '';
    } catch { return ''; }
  };
  // What the list itself shows as the last line, with the sender's name in a group.
  const previewOf = (row, last) => {
    const shown = row.querySelector('[data-testid="cell-frame-secondary"] span[title]');
    const text = shown && shown.getAttribute('title');
    return text || (last && (last.body || '[' + last.type + ']')) || '';
  };

  const scan = () => {
    // WhatsApp's title counts the chats with unread messages: "(2) WhatsApp".
    const t = /^\((\d+)\)/.exec(document.title);
    const badge = t ? Number(t[1]) : 0;
    if (badge !== lastBadge) {
      lastBadge = badge;
      window.picode.badge(badge);
    }
    const side = document.getElementById("pane-side");
    if (!side) return;
    recall();
    // The chat list is a grid of rows (role="row"); older builds used
    // list items.
    for (const row of side.querySelectorAll('[role="row"], [role="listitem"]')) {
      const chat = row.querySelector("span[title]")?.getAttribute("title") || "";
      if (!chat) continue;
      const model = modelOf(row);
      const id = (model && model.id && model.id._serialized) || chat;
      const count = unreadOf(row);
      const last = lastOf(model);
      const lastT = last ? last.t : 0;
      const before = seen.get(id);
      // The newest message ever seen, never an older one: right after a load
      // WhatsApp can list a chat before its last message is in, and the true one
      // arriving later would read as new (seen live 2026-11-03).
      const newest = Math.max(before ? before.t || 0 : 0, lastT);
      if (!before || before.c !== count || before.t !== newest) { seen.set(id, { c: count, t: newest }); dirty = true; }
      // Unlisted chats are dropped here, before a notice and before the text
      // exists anywhere but on WhatsApp's own page. The "has written" mark is
      // only the id and the time, so a later allow still knows not to write first.
      // A selected row may take the number from the open contact-info drawer.
      const gate = globalThis.__picodeWhatsappPolicy;
      let identity = null;
      if (gate && gate.identityOf) {
        let hint = '';
        if (row.getAttribute && row.getAttribute('aria-selected') === 'true' && gate.drawerPhone) {
          try { hint = gate.drawerPhone(chat, model) || ''; } catch { hint = ''; }
        }
        try { identity = gate.identityOf(model, chat, hint); } catch { identity = null; }
      }
      const phone = identity && identity.kind === 'direct' ? identity.phone : phoneOf(model);
      known.set(id, { id, name: chat, phone });
      if (gate) {
        if (identity && last && last.incoming) gate.markWrote(identity.key, last.t);
        const inbound = gate.inboundDecision({
          allowed: !!(identity && gate.allows(identity.key)),
          kind: identity ? identity.kind : '',
        });
        if (!inbound.keep) continue;
      }
      if (!primed) continue;
      // More unread, or somebody wrote into a chat that is open, where the count
      // stays at zero. A row scrolled back into view with the same state is not news.
      const more = count > (before ? before.c : 0);
      // Only an open chat, whose count stays at zero: a closed one says it by its count.
      const wrote = !!(count === 0 && before && before.t && last && last.incoming && lastT > before.t);
      if (more || wrote) {
        window.picode.signal("message", { chat, count: Math.max(count, 1), id, phone, preview: previewOf(row, last) });
      }
    }
    primed = true;
    save();
    const gate = globalThis.__picodeWhatsappPolicy;
    if (gate && gate.migratePending) gate.migratePending([...known.values()]);
    offerChats();
  };

  // The names you can pick in Notifications…. They stay in COGNIX[WS]'s window
  // on this computer; nothing is sent while the list has not changed.
  let offered = '';
  const offerChats = () => {
    if (!window.picode.chats) return;
    const names = [...known.values()];
    const key = names.map(n => n.id + n.name).join('\n');
    if (key === offered) return;
    offered = key;
    window.picode.chats(names);
  };
  // COGNIX[WS] may not have been ready for the first offer.
  setInterval(() => { offered = ''; offerChats(); }, 5 * 60_000);

  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(); });
  };

  const watch = () => {
    const side = document.getElementById("pane-side");
    const title = document.querySelector("title");
    if (!side || !title) return false;
    new MutationObserver(later).observe(side, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
    new MutationObserver(later).observe(title, { childList: true, characterData: true, subtree: true });
    scan();
    return true;
  };

  // The chat list appears after sign-in and after WhatsApp's own loading.
  if (!watch()) {
    const wait = new MutationObserver(() => { if (watch()) wait.disconnect(); });
    // The document itself: a script that starts with the page has no root
    // element yet, and observing none threw and stopped every script after it.
    wait.observe(document, { childList: true, subtree: true });
  }
})();
