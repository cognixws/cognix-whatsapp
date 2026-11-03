// Page signals (COGNIX[WS] manifest version 9): tells COGNIX[WS] when a chat
// gets new messages, and how many chats are unread for the app's tile.
// It reads only the chat list's row names and unread counts, never a
// message, and sends nothing anywhere else: picode.signal and picode.badge
// hand them to COGNIX[WS], which checks and delivers them.
(() => {
  if (!window.picode) return;
  // "3 mensagens não lidas", "1 unread message", … : the number counts, the
  // words depend on WhatsApp's language.
  const UNREAD = /^(\d+)\s.*(lid|unread|non lu|no le[ií]d|ungelesen)/i;
  // Chat name -> unread count last seen. Kept across reloads, in this session's own
  // storage on this computer, so a message that arrived while the page was down is
  // still news and an old unread one is not news twice.
  const KEY = 'picode-whatsapp-seen';
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? new Map(Object.entries(JSON.parse(raw))) : null;
    } catch { return null; }
  };
  const remembered = load();
  const seen = remembered || new Map();
  // With nothing remembered (a new session), the first look only learns.
  let primed = !!remembered;
  let dirty = false;
  const save = () => {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(seen))); } catch { /* lasts until a reload */ }
  };
  let lastBadge = -1;

  const unreadOf = (row) => {
    for (const e of row.querySelectorAll("[aria-label]")) {
      const m = UNREAD.exec(e.getAttribute("aria-label") || "");
      if (m) return Number(m[1]);
    }
    return 0;
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
    // The chat list is a grid of rows (role="row"); older builds used
    // list items.
    for (const row of side.querySelectorAll('[role="row"], [role="listitem"]')) {
      const chat = row.querySelector("span[title]")?.getAttribute("title") || "";
      if (!chat) continue;
      const count = unreadOf(row);
      const before = seen.get(chat);
      if (before !== count) { seen.set(chat, count); dirty = true; }
      // A row scrolled back into view with the same count is not news.
      if (primed && count > (before || 0)) {
        window.picode.signal("message", { chat, count });
      }
    }
    primed = true;
    save();
    offerChats();
  };

  // The names you can pick in Notifications…. They stay in COGNIX[WS]'s window
  // on this computer; nothing is sent while the list has not changed.
  let offered = '';
  const offerChats = () => {
    if (!window.picode.chats) return;
    const names = [...seen.keys()];
    const key = names.join('\n');
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
    wait.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
