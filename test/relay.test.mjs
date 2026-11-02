import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker, { expire } from '../relay/worker.mjs';
import { fakeD1 } from './d1-fake.mjs';
import { generateKeys, open, privateKey } from '../relay/seal.mjs';

const KEYS = await generateKeys();
const unseal = async event => JSON.parse(await open(await privateKey(KEYS.privateKey), event.sealed));

const base = 'https://relay.example';
const makeEnv = options => ({ APP_SECRET: 'app-secret', VERIFY_TOKEN: 'verify-me', RELAY_TOKEN: 'relay-token', PUBLIC_KEY: KEYS.publicKey, DB: fakeD1(options) });
const sign = (body, secret = 'app-secret') => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const change = (id, text = 'hello') => ({ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ id, from: '5511999990000', type: 'text', text: { body: text } }] } });
const payload = (...changes) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes }] });
const post = (env, body, signature = sign(body)) => worker.fetch(new Request(`${base}/webhook`, { method: 'POST', body, headers: signature ? { 'X-Hub-Signature-256': signature } : {} }), env);
const authed = (env, path, init = {}) => worker.fetch(new Request(`${base}${path}`, { ...init, headers: { Authorization: 'Bearer relay-token', ...init.headers } }), env);

test('the handshake answers the challenge only with the right token', async () => {
  const env = makeEnv();
  const ask = token => worker.fetch(new Request(`${base}/webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=${token}`), env);
  const right = await ask('verify-me');
  assert.equal(right.status, 200);
  assert.equal(await right.text(), 'abc123');
  assert.equal((await ask('wrong')).status, 403);
  const otherMode = await worker.fetch(new Request(`${base}/webhook?hub.mode=other&hub.challenge=x&hub.verify_token=verify-me`), env);
  assert.equal(otherMode.status, 403);
});

test('an event is stored only with a valid signature', async () => {
  const cases = [
    ['valid', sign(payload(change('a'))), 200, 1],
    ['another secret', sign(payload(change('a')), 'not-it'), 401, 0],
    ['no prefix', sign(payload(change('a'))).slice(7), 401, 0],
    ['not hex', 'sha256=zz', 401, 0],
    ['missing', '', 401, 0],
  ];
  for (const [name, signature, status, stored] of cases) {
    const env = makeEnv();
    const response = await post(env, payload(change('a')), signature);
    assert.equal(response.status, status, name);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(1) AS n FROM events').get().n, stored, name);
  }
});

test('a signature over other bytes is refused', async () => {
  const env = makeEnv();
  const response = await post(env, payload(change('a', 'changed')), sign(payload(change('a'))));
  assert.equal(response.status, 401);
});

test('a repeated delivery is stored once, and a batch splits by change', async () => {
  const env = makeEnv();
  const body = payload(change('a'), change('b'));
  assert.equal((await post(env, body)).status, 200);
  assert.equal((await post(env, body)).status, 200);
  const { events } = await (await authed(env, '/events')).json();
  assert.deepEqual(await Promise.all(events.map(async e => (await unseal(e)).messages[0].id)), ['a', 'b']);
});

test('a database failure answers 500 so that Meta delivers again', async () => {
  let fail = true;
  const env = makeEnv({ failBatch: () => fail });
  await assert.rejects(post(env, payload(change('a'))));
  fail = false;
  assert.equal((await post(env, payload(change('a')))).status, 200);
});

test('events page by cursor, and ack removes only what was taken', async () => {
  const env = makeEnv();
  await post(env, payload(change('a'), change('b'), change('c')));
  const first = await (await authed(env, '/events?after=0&limit=2')).json();
  assert.equal(first.events.length, 2);
  const upTo = first.events.at(-1).seq;
  const second = await (await authed(env, `/events?after=${upTo}`)).json();
  assert.deepEqual(await Promise.all(second.events.map(async e => (await unseal(e)).messages[0].id)), ['c']);
  const ack = await authed(env, '/ack', { method: 'POST', body: JSON.stringify({ upTo }) });
  assert.equal(ack.status, 200);
  const health = await (await authed(env, '/health')).json();
  assert.equal(health.pending, 1);
  assert.ok(health.lastReceivedAt > 0);
});

test('the fetching routes refuse without the relay token', async () => {
  const env = makeEnv();
  for (const path of ['/events', '/health']) {
    assert.equal((await worker.fetch(new Request(`${base}${path}`), env)).status, 401, path);
    assert.equal((await worker.fetch(new Request(`${base}${path}`, { headers: { Authorization: 'Bearer nope' } }), env)).status, 401, path);
  }
  assert.equal((await worker.fetch(new Request(`${base}/ack`, { method: 'POST', body: '{"upTo":9}' }), env)).status, 401);
});

test('bad cursors are refused', async () => {
  const env = makeEnv();
  assert.equal((await authed(env, '/events?after=-1')).status, 400);
  assert.equal((await authed(env, '/events?after=x')).status, 400);
  assert.equal((await authed(env, '/ack', { method: 'POST', body: '{"upTo":"9"}' })).status, 400);
  assert.equal((await authed(env, '/ack', { method: 'POST', body: 'no' })).status, 400);
});

test('an unconfigured relay answers nothing but its state', async () => {
  for (const missing of ['APP_SECRET', 'PUBLIC_KEY']) {
    const env = { ...makeEnv(), [missing]: '' };
    assert.equal((await post(env, payload(change('a')))).status, 503, missing);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(1) AS n FROM events').get().n, 0, missing);
  }
});

test('what waits in the relay is sealed: the text is not in the database', async () => {
  const env = makeEnv();
  await post(env, payload(change('a', 'SECRET WORDS')));
  const stored = JSON.stringify(env.DB.raw.prepare('SELECT * FROM events').all());
  assert.ok(!stored.includes('SECRET WORDS'));
  const { events } = await (await authed(env, '/events')).json();
  assert.equal((await unseal(events[0])).messages[0].text.body, 'SECRET WORDS');
});

test('a large message near the limit still seals and opens', async () => {
  const env = makeEnv();
  assert.equal((await post(env, payload(change('mid', 'y'.repeat(1_300_000))))).status, 200);
  const { events } = await (await authed(env, '/events')).json();
  assert.equal((await unseal(events[0])).messages[0].text.body.length, 1_300_000);
});

test('an oversize change is counted, and what never came back expires and is counted', async () => {
  const env = makeEnv();
  await post(env, payload(change('big', 'x'.repeat(1_400_000)), change('small')));
  let health = await (await authed(env, '/health')).json();
  assert.equal(health.pending, 1);
  assert.equal(health.dropped, 1);
  assert.equal(await expire(env, Date.now() + 15 * 24 * 60 * 60 * 1000), 1);
  health = await (await authed(env, '/health')).json();
  assert.equal(health.pending, 0);
  assert.equal(health.dropped, 2);
  assert.equal(await expire(env, Date.now()), 0);
});
