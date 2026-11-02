import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../server/http.mjs';
import { BUDGET_PER_HOUR, Source } from '../server/source.mjs';
import { fakeHost, fakeRelay, memoryLedger, metaEvent, person, textMessage } from './helpers.mjs';

const PHONE = '5511999990000';
const MARINA = [person(PHONE, 'Marina')];

async function setup({ pages = [], settings, routes = [], now } = {}) {
  const ledger = memoryLedger();
  ledger.replaceRoutes(routes);
  const host = fakeHost(settings ? { settings } : {});
  const relay = fakeRelay(pages);
  const source = new Source({ ledger, host, makeRelay: () => relay, now });
  await source.configure();
  return { ledger, host, relay, source };
}

const one = (seq, id, text = 'Oi') => metaEvent(seq, [textMessage(id, PHONE, text)], MARINA);

test('without settings it asks for setup and touches nothing', async () => {
  for (const settings of [{ values: {}, secrets: {} }, { values: { relay_url: 'https://r.example' }, secrets: {} }, { values: {}, secrets: { relay_token: 't' } }, { values: { relay_url: 'https://r.example' }, secrets: { relay_token: 't' } }]) {
    const { source, relay } = await setup({ settings });
    assert.equal(source.state, 'needs-setup');
    assert.equal(await source.poll(), false);
    assert.equal(relay.acks.length, 0);
  }
});

test('an unlisted contact reaches the Inbox as a count, without the text', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1', 'PRIVATE')] });
  await source.poll();
  assert.equal(host.inboxItems.length, 1);
  assert.equal(host.inboxItems[0].title, 'WhatsApp: 1 new message from Marina');
  assert.ok(!JSON.stringify(host.inboxItems).includes('PRIVATE'));
  assert.deepEqual(relay.acks, [1]);
  assert.equal(source.state, 'receiving');
});

test('a contact routed to an agent reaches it, with the text only when preview is on', async () => {
  const cases = [[true, true], [false, false]];
  for (const [preview, shows] of cases) {
    const { source, host } = await setup({ pages: [one(1, 'w1', 'Quinta às 9?')], routes: [{ contact: PHONE, target: 'a1', preview }] });
    await source.poll();
    assert.equal(host.inboxItems.length, 0);
    assert.equal(host.messages[0].to, 'a1');
    assert.equal(host.messages[0].text.includes('Quinta às 9?'), shows);
  }
});

test('a contact tells every destination, each with its own choice about the text', async () => {
  const { source, host } = await setup({ pages: [one(1, 'w1', 'Quinta?')], routes: [
    { contact: PHONE, target: 'a1', preview: true },
    { contact: PHONE, target: 'a2', preview: false },
    { contact: PHONE, target: 'a3', preview: true },
    { contact: PHONE, target: 'inbox', preview: false },
  ] });
  await source.poll();
  assert.deepEqual(host.messages.map(m => [m.to, m.text.includes('Quinta?')]), [['a1', true], ['a2', false], ['a3', true]]);
  assert.equal(host.inboxItems.length, 1);
  assert.ok(!host.inboxItems[0].body.includes('Quinta?'));
});

test('a failure halfway tells only the destinations still missing', async () => {
  const { source, host } = await setup({ pages: [one(1, 'w1')], routes: [{ contact: PHONE, target: 'a1' }, { contact: PHONE, target: 'a2' }] });
  const real = host.message;
  let calls = 0;
  host.message = async (...args) => { if (++calls === 2) throw new ApiError(0, 'down'); return real(...args); };
  await source.poll();
  assert.deepEqual(host.messages.map(m => m.to), ['a1']);
  await source.poll();
  assert.deepEqual(host.messages.map(m => m.to), ['a1', 'a2']);
});

test('the hourly limit counts a message once, however many hear it', async () => {
  const routes = Array.from({ length: 40 }, (_, i) => ({ contact: PHONE, target: `a${i}` }));
  const { source, host } = await setup({ pages: [one(1, 'w1'), one(2, 'w2')], routes });
  await source.poll();
  assert.equal(host.messages.length, 80);
});

test('routes under a phone and under a business id both count, once per destination', async () => {
  const contacts = [{ profile: { name: 'Bia' }, wa_id: PHONE, user_id: 'BR.B1' }];
  const event = metaEvent(1, [textMessage('w1', PHONE, 'x')], contacts);
  const { source, host } = await setup({ pages: [event], routes: [{ contact: PHONE, target: 'a1' }, { contact: 'BR.B1', target: 'a2' }, { contact: 'BR.B1', target: 'a1' }] });
  await source.poll();
  assert.deepEqual(host.messages.map(m => m.to), ['a1', 'a2']);
});

test('a route set to off stays silent and still moves on', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1')], routes: [{ contact: PHONE, target: 'off', preview: false }] });
  await source.poll();
  assert.equal(host.inboxItems.length + host.messages.length, 0);
  assert.deepEqual(relay.acks, [1]);
});

test('an agent that cannot take it becomes an Inbox note without the text', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1', 'PRIVATE')], routes: [{ contact: PHONE, target: 'gone', preview: true }] });
  host.failMessage = new ApiError(409, 'stopped');
  await source.poll();
  assert.equal(host.inboxItems.length, 1);
  assert.match(host.inboxItems[0].body, /could not be reached/);
  assert.ok(!host.inboxItems[0].body.includes('PRIVATE'));
  assert.deepEqual(relay.acks, [1]);
});

test('COGNIX[WS] not answering keeps what is left in the relay, and nothing is lost or repeated', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1'), one(2, 'w2')] });
  const realInbox = host.inbox;
  let calls = 0;
  host.inbox = async (...args) => { if (++calls === 2) throw new ApiError(0, 'down'); return realInbox(...args); };
  await source.poll();
  assert.equal(source.state, 'host-unavailable');
  assert.deepEqual(relay.acks, [1]);
  assert.equal(host.inboxItems.length, 1);
  await source.poll();
  assert.equal(source.state, 'receiving');
  assert.equal(host.inboxItems.length, 2);
  assert.deepEqual(relay.acks, [1, 2]);
});

test('a message Meta delivers twice notifies once', async () => {
  const { source, host } = await setup({ pages: [one(1, 'w1'), one(2, 'w1')] });
  await source.poll();
  assert.equal(host.inboxItems.length, 1);
});

test('a failed ack is retried by the next one, without a repeat', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1')] });
  relay.failAck = new ApiError(0, 'down');
  await source.poll();
  relay.failAck = null;
  relay.pages.push(one(2, 'w2'));
  await source.poll();
  assert.equal(host.inboxItems.length, 2);
  assert.deepEqual(relay.acks, [2]);
});

test('a relay with a new database, numbering from 1 again, still delivers', async () => {
  const { source, host, relay } = await setup({ pages: [one(7, 'w1')] });
  await source.poll();
  relay.pages = [one(1, 'after-new-database')];
  await source.poll();
  assert.equal(host.inboxItems.length, 2);
});

test('relay failures name their state, and recovery clears them', async () => {
  const cases = [[401, 'relay-rejected'], [403, 'relay-rejected'], [503, 'relay-misconfigured'], [500, 'relay-unreachable'], [0, 'relay-unreachable']];
  for (const [status, state] of cases) {
    const { source, relay } = await setup();
    relay.failEvents = new ApiError(status, 'x');
    await source.poll();
    assert.equal(source.state, state, String(status));
    assert.ok(source.status().problem);
    assert.ok(source.delay() > 10_000);
    relay.failEvents = null;
    await source.poll();
    assert.equal(source.state, 'receiving');
    assert.equal(source.delay(), 10_000);
  }
});

test('a long failure files one note, and another only after recovering', async () => {
  let clock = 1_000_000;
  const { source, host, relay } = await setup({ now: () => clock });
  relay.failEvents = new ApiError(0, 'down');
  await source.poll();
  assert.equal(host.inboxItems.length, 0);
  for (let i = 0; i < 4; i++) { clock += 120_000; await source.poll(); }
  assert.equal(host.inboxItems.length, 1);
  assert.equal(host.inboxItems[0].title, 'WhatsApp stopped receiving');
  relay.failEvents = null;
  await source.poll();
  relay.failEvents = new ApiError(0, 'down');
  await source.poll();
  clock += 301_000;
  await source.poll();
  assert.equal(host.inboxItems.length, 2);
});

test('past the hourly budget messages are held and the next notice says how many', async () => {
  let clock = 1_000_000;
  const pages = Array.from({ length: BUDGET_PER_HOUR + 2 }, (_, i) => one(i + 1, `w${i}`));
  const { source, host, relay } = await setup({ pages, now: () => clock });
  await source.poll();
  assert.equal(host.inboxItems.length, BUDGET_PER_HOUR);
  assert.deepEqual(relay.acks, [BUDGET_PER_HOUR + 2]);
  clock += 61 * 60_000;
  source.relay.pages.push(one(BUDGET_PER_HOUR + 3, 'later'));
  await source.poll();
  assert.match(host.inboxItems.at(-1).body, /2 earlier messages were held back/);
});

test('a failed delivery keeps the held count for the next notice', async () => {
  let clock = 1_000_000;
  const pages = Array.from({ length: BUDGET_PER_HOUR + 1 }, (_, i) => one(i + 1, `w${i}`));
  const { source, host, relay } = await setup({ pages, now: () => clock });
  await source.poll();
  clock += 61 * 60_000;
  relay.pages.push(one(BUDGET_PER_HOUR + 2, 'later'));
  host.failInbox = new ApiError(0, 'down');
  await source.poll();
  host.failInbox = null;
  await source.poll();
  assert.match(host.inboxItems.at(-1).body, /1 earlier message was held back/);
});

test('COGNIX failing during the relay check does not read as a relay failure', async () => {
  const { source, host, relay } = await setup();
  relay.health_ = { ok: true, pending: 0, lastReceivedAt: 0, dropped: 1 };
  host.failInbox = new ApiError(0, 'down');
  await source.poll();
  assert.equal(source.state, 'receiving');
  host.failInbox = null;
  source.polls = 0;
  await source.poll();
  assert.equal(host.inboxItems[0].title, 'WhatsApp lost messages in your relay');
});

test('messages lost in the relay file one note per loss', async () => {
  const { source, host, relay } = await setup();
  relay.health_ = { ok: true, pending: 0, lastReceivedAt: 0, dropped: 2 };
  await source.poll();
  assert.equal(host.inboxItems[0].title, 'WhatsApp lost messages in your relay');
  source.polls = 0;
  await source.poll();
  assert.equal(host.inboxItems.length, 1);
});

test('a check during a poll shares it, and nothing is delivered twice', async () => {
  const { source, host, relay } = await setup({ pages: [one(1, 'w1'), one(2, 'w2')] });
  await Promise.all([source.poll(), source.poll(), source.poll()]);
  assert.equal(host.inboxItems.length, 2);
  assert.deepEqual(relay.acks, [2]);
});

test('not being able to list agents does not read as agents being gone', async () => {
  const { source, host } = await setup();
  host.agents = async () => { throw new ApiError(0, 'down'); };
  const view = await source.routesView();
  assert.equal(view.agentsKnown, false);
});

test('events sealed to another key stay in the relay and say so', async () => {
  const { generateKeys } = await import('../relay/seal.mjs');
  const { source, host, relay } = await setup({ pages: [one(1, 'w1'), one(2, 'w2')] });
  await source.poll();
  assert.equal(host.inboxItems.length, 2);
  relay.publicKey = (await generateKeys()).publicKey;
  relay.pages.push(one(3, 'w3'));
  await source.poll();
  assert.equal(source.state, 'key-mismatch');
  assert.ok(source.status().problem);
  assert.equal(host.inboxItems.length, 2);
  assert.deepEqual(relay.acks, [2]);
  assert.equal(relay.pages.length, 1);
});

test('text is never written to the database', async () => {
  const { source, ledger } = await setup({ pages: [one(1, 'w1', 'NEVER STORED')], routes: [{ contact: PHONE, target: 'a1', preview: true }] });
  await source.poll();
  const dump = JSON.stringify(['metadata', 'contacts', 'routes', 'deliveries'].map(table => ledger.db.prepare(`SELECT * FROM ${table}`).all()));
  assert.ok(!dump.includes('NEVER STORED'));
});

test('the page sees senders to choose from, and routes are validated', async () => {
  const { source } = await setup({ pages: [one(1, 'w1')] });
  await source.poll();
  const view = await source.routesView();
  assert.equal(view.contacts[0].name, 'Marina');
  assert.equal(view.agents[0].name, 'Atlas');
  assert.deepEqual(source.saveRoutes([{ contact: PHONE, target: 'off', preview: true }]), [{ contact: PHONE, target: 'off', preview: false }]);
  assert.throws(() => source.saveRoutes([{ contact: PHONE, target: 'a1' }, { contact: PHONE, target: 'a1' }]), ApiError);
  assert.throws(() => source.saveRoutes([{ contact: PHONE, target: 'a1' }, { contact: PHONE, target: 'off' }]), ApiError);
  assert.equal(source.saveRoutes(Array.from({ length: 500 }, (_, i) => ({ contact: PHONE, target: `a${i}` }))).length, 500);
  assert.throws(() => source.saveRoutes([{ contact: '', target: 'a1' }]), ApiError);
  assert.throws(() => source.saveRoutes('no'), ApiError);
});
