import { ApiError, Relay } from './http.mjs';
import { INBOX, OFF } from './ledger.mjs';
import { messagesOf, renderNotice } from './meta.mjs';

export const POLL_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const HEALTH_EVERY = 30; // polls, about every five minutes.
const STOPPED_NOTE_AFTER_MS = 5 * 60_000;
export const BUDGET_PER_HOUR = 30;
const HOUR = 60 * 60_000;

// How a failure reads in the page: what is true and what the person can do.
const PROBLEMS = {
  'relay-rejected': 'Your relay refused this computer\'s token, so no messages arrive.',
  'relay-unreachable': 'New messages cannot reach this computer until your relay answers.',
  'relay-misconfigured': 'Your relay is missing a secret, so it cannot receive messages.',
};

export class Source {
  constructor({ ledger, host, makeRelay = (address, token) => new Relay(address, token), now = Date.now }) {
    Object.assign(this, { ledger, host, makeRelay, now });
    this.relay = null;
    this.phoneNumberId = '';
    this.state = 'checking';
    this.lastPollAt = 0;
    this.lastMessageAt = Number(ledger.get('last_message_at', '0')) || 0;
    this.health = null;
    this.failingSince = 0;
    this.noted = false;
    this.failures = 0;
    this.polls = 0;
    this.sent = [];
    this.knownDropped = Number(ledger.get('known_dropped', '0')) || 0;
    this.timer = null;
  }

  async configure() {
    const { values = {}, secrets = {} } = await this.host.settings();
    this.phoneNumberId = String(values.phone_number_id || '').trim();
    if (!values.relay_url || !secrets.relay_token) { this.relay = null; this.state = 'needs-setup'; return; }
    this.relay = this.makeRelay(values.relay_url, secrets.relay_token);
    this.state = 'checking';
  }

  status() {
    return {
      state: this.state,
      problem: PROBLEMS[this.state] ?? '',
      lastPollAt: this.lastPollAt,
      lastMessageAt: this.lastMessageAt,
      pending: this.health?.pending ?? 0,
      lastReceivedAt: this.health?.lastReceivedAt ?? 0,
      dropped: this.health?.dropped ?? 0,
    };
  }

  // One look at a time: a person's Check now can land during the timed poll,
  // and two at once would deliver the same events twice.
  poll() {
    if (!this.polling) this.polling = this.pollOnce().finally(() => { this.polling = null; });
    return this.polling;
  }

  // Answers whether there may be more right away.
  async pollOnce() {
    if (!this.relay) return false;
    let page;
    try {
      // What the relay still holds is what is left to do. No cursor is kept
      // here: a relay with a new database numbers from 1 again, and a saved
      // cursor would skip every new message without a word.
      page = await this.relay.events(0);
      if (this.polls++ % HEALTH_EVERY === 0) await this.checkHealth();
    } catch (error) {
      await this.failed(error);
      return false;
    }
    let upTo = 0;
    try {
      for (const event of page.events ?? []) {
        await this.handle(event);
        upTo = event.seq;
      }
    } catch (error) {
      // COGNIX[WS] itself did not answer. The next poll gets the rest again, and
      // what was already delivered is not delivered twice.
      if (upTo) await this.acknowledge(upTo);
      this.state = 'host-unavailable';
      this.failures++;
      return false;
    }
    this.lastPollAt = this.now();
    this.recovered();
    if (!upTo) return false;
    await this.acknowledge(upTo);
    this.ledger.prune(this.now());
    return (page.events?.length ?? 0) >= 50;
  }

  // A failed ack only means these events return on the next poll, where the
  // delivery record stops them from being announced again.
  async acknowledge(upTo) {
    try { await this.relay.ack(upTo); }
    catch { /* See above. */ }
  }

  async checkHealth() {
    this.health = await this.relay.health();
    const dropped = Number(this.health?.dropped) || 0;
    if (dropped > this.knownDropped) {
      const lost = dropped - this.knownDropped;
      try {
        await this.host.inbox('WhatsApp lost messages in your relay', `${lost} update${lost === 1 ? '' : 's'} could not be kept, because this computer stayed away too long or the update was too large.`);
        this.knownDropped = dropped;
        this.ledger.set('known_dropped', dropped);
      } catch { /* COGNIX[WS] did not answer, not the relay. The next look tries again. */ }
    }
  }

  async handle(event) {
    const messages = messagesOf(event, { phoneNumberId: this.phoneNumberId });
    const groups = new Map();
    for (const message of messages) {
      const group = groups.get(message.contact.key) ?? { contact: message.contact, messages: [] };
      group.messages.push(message);
      groups.set(message.contact.key, group);
    }
    for (const group of groups.values()) await this.deliver(group);
  }

  // Decision table in docs/official-source.md.
  async deliver({ contact, messages }) {
    const now = this.now();
    this.ledger.touchContact(contact, now);
    this.lastMessageAt = now;
    this.ledger.set('last_message_at', now);
    const route = this.ledger.routeFor(contact.ids);
    const target = route?.target ?? INBOX;
    const fresh = messages.filter(message => !this.ledger.delivered(message.id, target));
    if (!fresh.length) return;
    const ids = fresh.map(message => message.id);
    if (target === OFF) { this.ledger.markDelivered(ids, OFF, now); return; }
    if (!this.spend(now)) {
      this.ledger.addHeld(contact.key, fresh.length);
      this.ledger.markDelivered(ids, target, now);
      return;
    }
    // Text goes only where the owner asked for it, for this contact.
    const held = this.ledger.heldFor(contact.key);
    const notice = renderNotice({ contact, messages: fresh, preview: !!route?.preview, held });
    if (target === INBOX) {
      await this.host.inbox(notice.title, notice.text);
    } else {
      try {
        await this.host.message(target, notice.text);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 400 || error.status >= 500) throw error;
        // That agent cannot take it (stopped, deleted). The owner still hears,
        // without the text, since the owner chose an agent to read it.
        const safe = renderNotice({ contact, messages: fresh, preview: false, held });
        await this.host.inbox(safe.title, `${safe.text}\nThe agent chosen for this contact could not be reached.`);
      }
    }
    this.ledger.clearHeld(contact.key);
    this.ledger.markDelivered(ids, target, now);
  }

  spend(now) {
    this.sent = this.sent.filter(at => now - at < HOUR);
    if (this.sent.length >= BUDGET_PER_HOUR) return false;
    this.sent.push(now);
    return true;
  }

  async failed(error) {
    const status = error instanceof ApiError ? error.status : 0;
    this.state = status === 401 || status === 403 ? 'relay-rejected' : status === 503 ? 'relay-misconfigured' : 'relay-unreachable';
    this.failures++;
    const now = this.now();
    if (!this.failingSince) this.failingSince = now;
    if (!this.noted && now - this.failingSince >= STOPPED_NOTE_AFTER_MS) {
      try {
        await this.host.inbox('WhatsApp stopped receiving', PROBLEMS[this.state]);
        this.noted = true;
      } catch { /* The next failing poll tries again. */ }
    }
  }

  recovered() {
    this.state = 'receiving';
    this.failures = 0;
    this.failingSince = 0;
    this.noted = false;
  }

  delay() {
    return this.failures ? Math.min(POLL_MS * 2 ** this.failures, MAX_BACKOFF_MS) : POLL_MS;
  }

  start() {
    const loop = async () => {
      let more = false;
      try { more = await this.poll(); }
      catch { this.failures++; }
      if (this.stopped) return;
      this.timer = setTimeout(loop, more ? 0 : this.delay());
      this.timer.unref?.();
    };
    this.stopped = false;
    loop();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  async routesView() {
    let agents = [];
    let agentsKnown = true;
    try { agents = ((await this.host.agents()).agents ?? []).map(({ id, name }) => ({ id, name })); }
    catch { agentsKnown = false; } // Not knowing is not the same as an agent being gone.
    return { routes: this.ledger.routes(), contacts: this.ledger.contacts(), agents, agentsKnown };
  }

  saveRoutes(routes) {
    if (!Array.isArray(routes) || routes.length > 200) throw new ApiError(400, 'Keep up to 200 contacts.');
    const seen = new Set();
    const clean = routes.map(route => {
      const contact = String(route?.contact ?? '').trim();
      const target = String(route?.target ?? '').trim();
      if (!contact || contact.length > 200 || !target || target.length > 200 || seen.has(contact)) throw new ApiError(400, 'Each contact can have one route.');
      seen.add(contact);
      return { contact, target, preview: route.preview === true && target !== OFF };
    });
    this.ledger.replaceRoutes(clean);
    return clean;
  }
}
