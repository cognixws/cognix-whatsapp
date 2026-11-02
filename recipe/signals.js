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
  const seen = new Map(); // chat name -> unread count last seen
  let primed = false;
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
      seen.set(chat, count);
      // The first look only learns what is there; a row scrolled back into
      // view with the same count is not news.
      if (primed && count > 0 && (before === undefined ? true : count > before)) {
        window.picode.signal("message", { chat, count });
      }
    }
    primed = true;
    offerChats();
  };

  // The names you can pick in Notifications…. They stay in COGNIX[WS]'s window
  // on this computer; nothing is sent while the list has not changed.
  let offered = '';
  const offerChats = () => {
    const names = [...seen.keys()];
    const key = names.join('\n');
    if (key === offered || !window.picode.chats) return;
    offered = key;
    window.picode.chats(names);
  };

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
