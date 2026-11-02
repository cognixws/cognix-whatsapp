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

  async function save(next, done, focusNext) {
    const before = routes;
    routes = next;
    render(focusNext);
    showSaved('Saving…');
    $('problem').hidden = true;
    saving++;
    try {
      routes = (await call('/routes', { routes: next })).routes;
      render(focusNext);
      done ? done(before) : showSaved('Saved.');
    } catch (error) {
      routes = before;
      render();
      showSaved('');
      showProblem(error.message);
    } finally { saving--; }
  }

  // Removing rows shrinks the page, and the browser then moves whatever is under
  // the pointer: a second tap could land on another contact's Remove. The height
  // holds until the person scrolls.
  const releaseHeight = () => { $('people').style.minHeight = ''; };
  const holdHeight = () => { $('people').style.minHeight = `${$('people').offsetHeight}px`; };
  for (const name of ['wheel', 'touchmove']) addEventListener(name, releaseHeight, { passive: true });

  const missing = route => agentsKnown && !['inbox', 'off'].includes(route.target) && !agents.some(a => a.id === route.target);
  const focusKey = (contact, target, part) => `${contact}\n${target}\n${part}`;
  const agentName = id => id === 'inbox' ? 'Inbox' : agents.find(a => a.id === id)?.name ?? (agentsKnown ? 'Agent not found' : 'Chosen agent');
  const inSentence = id => agentsKnown && !['inbox', 'off'].includes(id) && !agents.some(a => a.id === id) ? 'The missing agent' : agentName(id);
  // A new destination sits with its contact's others, so a block never jumps.
  const withRoute = (route) => {
    const last = routes.map(r => r.contact).lastIndexOf(route.contact);
    return last < 0 ? [...routes, route] : [...routes.slice(0, last + 1), route, ...routes.slice(last + 1)];
  };

  function renderDestination(route, siblings, name) {
    const row = document.createElement('div');
    row.className = 'dest';
    const select = document.createElement('select');
    select.className = 'pc-select';
    select.dataset.focus = focusKey(route.contact, route.target, 'who');
    select.setAttribute('aria-label', `Who hears ${name}`);
    const taken = new Set(siblings.map(r => r.target).filter(t => t !== route.target));
    if (!taken.has('inbox')) select.append(option('inbox', 'Inbox'));
    for (const agent of agents) if (!taken.has(agent.id)) select.append(option(agent.id, agent.name));
    if (!['inbox', 'off'].includes(route.target) && !agents.some(a => a.id === route.target)) select.append(option(route.target, agentName(route.target)));
    select.value = route.target;
    select.title = select.selectedOptions[0]?.textContent || '';
    select.onchange = () => save(routes.map(r => r === route ? { ...r, target: select.value } : r), undefined, focusKey(route.contact, select.value, 'who'));

    const check = document.createElement('label');
    check.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = route.preview;
    box.dataset.focus = focusKey(route.contact, route.target, 'text');
    box.onchange = () => save(routes.map(r => r === route ? { ...r, preview: box.checked } : r));
    box.setAttribute('aria-label', `Include text for ${agentName(route.target)}, from ${name}`);
    check.append(box, 'Include text');
    // A missing agent means no text goes anywhere.
    check.style.visibility = missing(route) ? 'hidden' : '';

    const remove = document.createElement('button');
    remove.className = 'pc-button';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${agentName(route.target)} from ${name}`);
    remove.onclick = () => { holdHeight(); save(routes.filter(r => r !== route), before => {
      const last = siblings.length === 1;
      showSaved(last ? `${name} now counts as any other contact.` : `${inSentence(route.target)} no longer hears ${name}.`, () => {
        showSaved('');
        save(before, () => { showSaved('Restored.'); focusContact(route.contact); });
      });
      if (last) $('pick').focus(); else focusContact(route.contact);
    }); };

    row.append(select, check, remove);
    if (missing(route)) {
      const note = document.createElement('p');
      note.className = 'row-note';
      note.textContent = 'This agent no longer exists, so these messages reach your Inbox without the text. Choose who hears them.';
      row.append(note);
    }
    return row;
  }

  function renderContact(contact, own) {
    const block = document.createElement('div');
    block.className = 'contact';
    const { name, detail } = contactLabel(contact);
    const head = document.createElement('div');
    head.className = 'contact-head';
    const who = document.createElement('div');
    who.className = 'who';
    const strong = document.createElement('strong');
    strong.textContent = name;
    who.append(strong);
    if (detail) { const small = document.createElement('small'); small.textContent = detail; who.append(small); }
    head.append(who);
    block.append(head);

    const silent = own.some(r => r.target === 'off');
    const button = document.createElement('button');
    button.className = 'pc-button';
    button.type = 'button';
    button.dataset.focus = focusKey(contact, '', 'silence');
    if (silent) {
      button.textContent = 'Hear again';
      button.setAttribute('aria-label', `Hear ${name} again`);
      button.onclick = () => save(routes.map(r => r.contact === contact ? { contact, target: 'inbox', preview: false } : r), undefined, focusKey(contact, 'inbox', 'who'));
      const quiet = document.createElement('p');
      quiet.className = 'pc-muted';
      quiet.textContent = 'Stays silent: nobody hears this contact.';
      head.append(button);
      block.append(quiet);
      return block;
    }
    button.textContent = 'Silence';
    button.setAttribute('aria-label', `Silence ${name}`);
    button.onclick = () => {
      const first = routes.findIndex(r => r.contact === contact);
      const others = routes.filter(r => r.contact !== contact);
      const next = [...others.slice(0, first), { contact, target: 'off', preview: false }, ...others.slice(first)];
      holdHeight();
      save(next, before => {
        showSaved(`Nobody hears ${name} now.`, () => {
          showSaved('');
          save(before, () => { showSaved('Restored.'); focusContact(contact); });
        });
      }, focusKey(contact, '', 'silence'));
    };
    head.append(button);
    block.append(...own.map(route => renderDestination(route, own, name)));

    const taken = new Set(own.map(r => r.target));
    const free = [...(taken.has('inbox') ? [] : [{ id: 'inbox', name: 'Inbox' }]), ...agents.filter(a => !taken.has(a.id))];
    if (free.length) {
      const row = document.createElement('div');
      row.className = 'more-row';
      const more = document.createElement('select');
      more.className = 'pc-select';
      more.dataset.focus = focusKey(contact, '', 'more');
      more.setAttribute('aria-label', `Who else hears ${name}`);
      more.append(option('', 'Add who hears…'), ...free.map(f => option(f.id, f.name)));
      const add = document.createElement('button');
      add.className = 'pc-button';
      add.type = 'button';
      add.textContent = 'Add';
      add.dataset.focus = focusKey(contact, '', 'add');
      add.setAttribute('aria-label', `Add who else hears ${name}`);
      add.disabled = true;
      more.onchange = () => { add.disabled = !more.value; };
      add.onclick = () => {
        // The Add row goes away with the last free destination; focus moves to the new row.
        const focus = free.length === 1 ? focusKey(contact, more.value, 'who') : focusKey(contact, '', 'more');
        save(withRoute({ contact, target: more.value, preview: false }), undefined, focus);
      };
      row.append(more, add);
      block.append(row);
    }
    return block;
  }

  function render(focusNext) {
    // Rebuilding the rows must not take the keyboard away from the person.
    const focused = focusNext || document.activeElement?.dataset?.focus;
    const groups = new Map();
    for (const route of routes) groups.set(route.contact, [...(groups.get(route.contact) ?? []), route]);
    $('rows').replaceChildren(...[...groups].map(([contact, own]) => renderContact(contact, own)));
    // Only a move the person asked for may scroll the page.
    if (focused) [...$('rows').querySelectorAll('[data-focus]')].find(e => e.dataset.focus === focused)?.focus({ preventScroll: !focusNext });
    const free = contacts.filter(c => !groups.has(c.key) && !(c.phone && groups.has(c.phone)));
    const picked = $('pick').value;
    $('pick').replaceChildren(...free.map(c => option(c.key, c.name ? `${c.name}${c.phone ? ` (${phoneText(c.phone)})` : ''}` : c.phone ? phoneText(c.phone) : c.key)));
    if (free.some(c => c.key === picked)) $('pick').value = picked;
    $('add').hidden = !free.length;
    $('empty').hidden = free.length > 0 || routes.length > 0;
    // Kept in place while there are rows, so that silencing a contact moves nothing.
    $('intro').hidden = !routes.length;
    $('intro').style.visibility = routes.some(r => r.target !== 'off' && !missing(r)) ? '' : 'hidden';
  }

  const focusContact = contact => $('rows').querySelector(`select[data-focus^="${CSS.escape(contact)}"]`)?.focus();

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
        // Not under the person's hands: a rebuild would close an open list.
        const busyHere = $('rows').contains(document.activeElement) || document.activeElement === $('pick');
        if (seen !== renderedView && !busyHere) {
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
