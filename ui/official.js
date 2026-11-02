(async () => {
  const $ = id => document.getElementById(id);
  await picode.use('theme');
  const process = await picode.use('process');
  const links = await picode.use('links');
  const SAVED_MS = 3000;
  const UNDO_MS = 8000;
  const MIN_CHECK_MS = 500; // A check this fast must still be seen to happen.
  let routes = [], contacts = [], agents = [], agentsKnown = true;
  let status = null, checking = false, checkedAt = 0, saving = 0, savedTimer = 0, renderedView = '';

  async function call(path, body) {
    const result = await process.request(path, body === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(body), contentType: 'application/json' });
    let data;
    try { data = JSON.parse(result.body || '{}'); } catch { throw new Error('This could not be confirmed. Try again.'); }
    if (result.status >= 400) throw new Error(data.message || 'Turn the extension on in a workspace and try again.');
    return data;
  }

  const ago = at => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  };
  const brazil = /^55(\d{2})(\d{4,5})(\d{4})$/;
  const phoneText = phone => {
    const match = brazil.exec(phone);
    return match ? `+55 ${match[1]} ${match[2]}-${match[3]}` : `+${phone}`;
  };

  const openSettings = () => links.open(new URL('/#/extensions/whatsapp', location.href).href);
  async function check() {
    if (checking) return;
    checking = true;
    showBand();
    const started = Date.now();
    try {
      status = await call('/check', {});
      await new Promise(done => setTimeout(done, MIN_CHECK_MS - (Date.now() - started)));
      checkedAt = Date.now();
      $('problem').hidden = true;
    } catch (error) { showProblem(error.message); }
    checking = false;
    showBand();
    $('action').focus();
    refresh();
  }

  // Each state: tone, title, one sentence, one action, whether it is the primary one.
  function bandFor(s) {
    const recent = Date.now() - checkedAt < 10_000;
    const checked = recent ? 'Checked just now. ' : '';
    // In the title, so that a failing check does not wrap the sentence and move the page.
    const seen = recent ? ', checked just now' : '';
    switch (s.state) {
      case 'needs-setup': return ['idle', 'Not connected', 'Add your relay\'s address and token to start receiving.', 'Open settings', openSettings, true];
      case 'receiving': return ['', 'Receiving', checked + (s.lastMessageAt ? `Last message ${ago(s.lastMessageAt)}.` : 'Connected to your relay. No message yet.'), 'Check now', check, false];
      case 'relay-rejected': return ['bad', 'Relay refused the token', s.problem, 'Open settings', openSettings, true];
      case 'relay-misconfigured': return ['bad', `Relay not set up${seen}`, s.problem, 'Check again', check, true];
      case 'relay-unreachable': return ['bad', `Relay not answering${seen}`, s.problem, 'Check again', check, true];
      case 'host-unavailable': return ['bad', 'Delivery paused', 'New messages wait in your relay until COGNIX[WS] answers.', 'Check again', check, true];
      default: return ['idle', 'Checking', 'Looking at your relay.', 'Check now', check, false];
    }
  }

  function showBand() {
    if (!status) return;
    const behind = bandFor(status);
    const [tone, title, sentence, label, handler, primary] = checking
      ? ['busy', 'Checking', 'Looking at your relay.', 'Checking…', () => {}, false]
      : behind;
    $('band').className = `band ${tone}`.trim();
    $('title').textContent = title;
    $('sentence').textContent = sentence;
    $('action').textContent = label;
    $('action').onclick = handler;
    $('action').disabled = checking;
    $('action').classList.toggle('primary', primary);
    // A failing check can be the address itself: settings stay one step away.
    $('settings').hidden = behind[0] !== 'bad' || behind[4] === openSettings;
    $('people').hidden = status.state === 'needs-setup' && !routes.length && !contacts.length;
  }

  function showProblem(message) {
    $('problem').textContent = message;
    $('problem').hidden = false;
  }

  function showSaved(text, undo) {
    clearTimeout(savedTimer);
    $('saved-text').textContent = text;
    $('undo').hidden = !undo;
    $('undo').onclick = undo || null;
    if (text) savedTimer = setTimeout(() => showSaved(''), undo ? UNDO_MS : SAVED_MS);
  }

  const contactOf = key => contacts.find(c => c.key === key || c.phone === key);
  const contactLabel = key => {
    const contact = contactOf(key);
    if (!contact) return { name: /^\d+$/.test(key) ? phoneText(key) : key, detail: '' };
    const phone = contact.phone ? phoneText(contact.phone) : '';
    return { name: contact.name || phone || key, detail: contact.name ? phone : '' };
  };
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };

  async function save(next, done) {
    const before = routes;
    routes = next;
    render();
    showSaved('Saving…');
    $('problem').hidden = true;
    saving++;
    try {
      routes = (await call('/routes', { routes: next })).routes;
      render();
      done ? done(before) : showSaved('Saved.');
    } catch (error) {
      routes = before;
      render();
      showSaved('');
      showProblem(error.message);
    } finally { saving--; }
  }

  const missing = route => agentsKnown && !['inbox', 'off'].includes(route.target) && !agents.some(a => a.id === route.target);

  function renderRow(route) {
    const row = document.createElement('div');
    row.className = 'row';
    const { name, detail } = contactLabel(route.contact);
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name;
    if (detail) { const small = document.createElement('small'); small.textContent = detail; who.append(small); }

    const select = document.createElement('select');
    select.className = 'pc-select';
    select.dataset.focus = `${route.contact}\nwho`;
    select.setAttribute('aria-label', `Who hears ${name}`);
    select.append(option('inbox', 'Inbox'));
    for (const agent of agents) select.append(option(agent.id, agent.name));
    if (!['inbox', 'off'].includes(route.target) && !agents.some(a => a.id === route.target)) select.append(option(route.target, agentsKnown ? 'Agent not found' : 'Chosen agent'));
    select.append(option('off', 'Off, stay silent'));
    select.value = route.target;
    select.title = select.selectedOptions[0]?.textContent || '';
    select.onchange = () => save(routes.map(r => r === route ? { ...r, target: select.value, preview: select.value === 'off' ? false : r.preview } : r));

    const check = document.createElement('label');
    check.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = route.preview;
    box.dataset.focus = `${route.contact}\ntext`;
    box.onchange = () => save(routes.map(r => r === route ? { ...r, preview: box.checked } : r));
    check.append(box, 'Include text');
    // Off and a missing agent both mean no text goes anywhere.
    check.style.visibility = route.target === 'off' || missing(route) ? 'hidden' : '';

    const remove = document.createElement('button');
    remove.className = 'pc-button';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.onclick = () => save(routes.filter(r => r !== route), before => {
      showSaved(`${name} now counts as any other contact.`, () => {
        showSaved('');
        save(before, () => { showSaved('Restored.'); focusContact(route.contact); });
      });
      $('pick').focus();
    });

    row.append(who, select, check, remove);
    if (missing(route)) {
      const note = document.createElement('p');
      note.className = 'row-note';
      note.textContent = 'This agent no longer exists, so these messages reach your Inbox without the text. Choose who hears them.';
      row.append(note);
    }
    return row;
  }

  function render() {
    // Rebuilding the rows must not take the keyboard away from the person.
    const focused = document.activeElement?.dataset?.focus;
    $('rows').replaceChildren(...routes.map(renderRow));
    if (focused) [...$('rows').querySelectorAll('[data-focus]')].find(e => e.dataset.focus === focused)?.focus();
    const routed = new Set(routes.map(r => r.contact));
    const free = contacts.filter(c => !routed.has(c.key) && !(c.phone && routed.has(c.phone)));
    const picked = $('pick').value;
    $('pick').replaceChildren(...free.map(c => option(c.key, c.name ? `${c.name}${c.phone ? ` (${phoneText(c.phone)})` : ''}` : c.phone ? phoneText(c.phone) : c.key)));
    if (free.some(c => c.key === picked)) $('pick').value = picked;
    $('add').hidden = !free.length;
    $('empty').hidden = free.length > 0 || routes.length > 0;
    $('intro').hidden = !routes.some(r => r.target !== 'off' && !missing(r));
  }

  const focusContact = contact => [...$('rows').querySelectorAll('select')].find(e => e.dataset.focus === `${contact}\nwho`)?.focus();

  $('settings').onclick = openSettings;
  $('add-button').onclick = () => {
    const contact = $('pick').value;
    if (contact) save([...routes, { contact, target: 'inbox', preview: false }], () => { showSaved('Saved.'); focusContact(contact); });
  };

  async function refresh() {
    try {
      const [nextStatus, view] = await Promise.all([call('/status'), call('/routes')]);
      if (!checking) status = nextStatus;
      if (!saving) {
        const seen = JSON.stringify(view);
        if (seen !== renderedView) {
          renderedView = seen;
          ({ routes, contacts, agents, agentsKnown } = view);
          render();
        }
      }
      showBand();
      if (!saving) $('problem').hidden = true;
    } catch (error) {
      status = status ?? { state: 'host-unavailable' };
      showBand();
      showProblem(error.message);
    }
    $('loading').hidden = true;
    $('content').hidden = false;
  }

  await refresh();
  setInterval(() => { if (!document.hidden && !checking) refresh(); }, 15_000);
})();
