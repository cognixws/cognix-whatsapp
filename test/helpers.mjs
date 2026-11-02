import { readFileSync } from 'node:fs';
import { Ledger } from '../server/ledger.mjs';
import { generateKeys, seal } from '../relay/seal.mjs';

// One key pair for the whole run: generating one per test is slow and proves nothing more.
export const KEYS = await generateKeys();

export function memoryLedger() {
  const ledger = new Ledger(':memory:');
  for (const file of ['001_official_source.sql', '002_many_destinations.sql']) ledger.db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return ledger;
}

export const metaEvent = (seq, messages, contacts, { number = 'PN1', field = 'messages' } = {}) => ({
  seq, receivedAt: 1, field,
  value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001111', phone_number_id: number }, contacts, messages },
});

export const textMessage = (id, from, body) => ({ from, id, timestamp: '1760000000', type: 'text', text: { body } });
export const person = (wa_id, name) => ({ profile: { name }, wa_id });

export function fakeHost({ settings = { values: { relay_url: 'https://relay.example' }, secrets: { relay_token: 't', relay_private_key: KEYS.privateKey } } } = {}) {
  const host = {
    inboxItems: [], messages: [], failInbox: null, failMessage: null,
    settings: async () => settings,
    agents: async () => ({ agents: [{ id: 'a1', name: 'Atlas', cli: 'claude-code' }] }),
    inbox: async (title, body) => { if (host.failInbox) throw host.failInbox; host.inboxItems.push({ title, body }); return {}; },
    message: async (to, text) => { if (host.failMessage) throw host.failMessage; host.messages.push({ to, text }); return {}; },
  };
  return host;
}

export function fakeRelay(pages = []) {
  const relay = {
    pages, acks: [], health_: { ok: true, pending: 0, lastReceivedAt: 0, dropped: 0 }, failEvents: null, failAck: null,
    // The relay seals each event as it stores it; this one seals as it hands out.
    publicKey: KEYS.publicKey,
    events: async after => {
      if (relay.failEvents) throw relay.failEvents;
      const page = relay.pages.filter(event => event.seq > after);
      return { events: await Promise.all(page.map(async ({ seq, receivedAt, field, value }) => ({ seq, receivedAt, field, sealed: await seal(relay.publicKey, JSON.stringify(value)) }))) };
    },
    ack: async upTo => {
      if (relay.failAck) throw relay.failAck;
      relay.acks.push(upTo);
      relay.pages = relay.pages.filter(event => event.seq > upTo);
      return { ok: true };
    },
    health: async () => relay.health_,
  };
  return relay;
}
