// Tells COGNIX[WS] once when this page stops being able to notice messages:
// WhatsApp asks for the QR code again, or its page changed so that the chat
// list cannot be read. It reads the page's structure only, never a message.
(() => {
  if (!window.picode) return;
  const CHECK_MS = 15_000;
  // A state must hold for two looks in a row: loading screens come and go.
  const CONFIRM = 2;
  const REASONS = {
    'signed-out': 'it asks for the QR code. Scan it on your phone, in Linked devices.',
    'page-changed': 'its page changed and new messages are not noticed. Update the extension.',
  };
  let reported = '';
  let candidate = '';
  let seen = 0;

  const stateNow = () => {
    const side = document.getElementById('pane-side');
    // The QR screen: a canvas inside WhatsApp's [data-ref] box, with no chat list.
    if (!side && document.querySelector('[data-ref] canvas')) return 'signed-out';
    if (side && side.childElementCount > 0 && !side.querySelector('[role="row"], [role="listitem"]')) return 'page-changed';
    return 'ok';
  };

  const look = () => {
    const now = stateNow();
    if (now !== candidate) { candidate = now; seen = 1; return; }
    if (++seen < CONFIRM || now === reported) return;
    reported = now;
    if (now !== 'ok') window.picode.signal('attention', { reason: REASONS[now] });
  };

  setInterval(look, CHECK_MS);
  look();
})();
