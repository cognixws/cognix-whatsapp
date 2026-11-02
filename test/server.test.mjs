import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../server/http.mjs';
import { checkSettings, createServer } from '../server/server.mjs';

const SECRET = 'proxy-secret';

async function withServer(source, check, run) {
  const server = createServer(source, { secret: SECRET, check });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const call = (base, path, body, secret = SECRET) => fetch(base + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: secret ? { 'X-PiCode-Proxy-Secret': secret } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('only COGNIX, with the proxy secret, reaches the process', async () => {
  await withServer({ status: () => ({ state: 'receiving' }) }, async () => {}, async base => {
    assert.equal((await call(base, '/status', undefined, '')).status, 401);
    assert.equal((await call(base, '/status', undefined, 'wrong-secret')).status, 401);
    assert.equal((await call(base, '/status')).status, 200);
  });
});

test('the settings check answers what COGNIX maps to a sentence, and no detail', async () => {
  const cases = [
    [null, 200],
    [new ApiError(400, 'Check the relay address.'), 400],
    [new ApiError(401, 'x'), 401],
    [new ApiError(403, 'x'), 401],
    [new ApiError(500, 'x'), 502],
    [new ApiError(0, 'x'), 502],
  ];
  for (const [error, status] of cases) {
    await withServer({}, async () => { if (error) throw error; }, async base => {
      const answer = await call(base, '/settings/check', { secrets: { relay_token: 'SECRET-VALUE' } });
      assert.equal(answer.status, status);
      const text = await answer.text();
      assert.ok(!text.includes('SECRET-VALUE'));
      assert.equal(JSON.parse(text).valid, status === 200);
    });
  }
});

test('the check needs an address with a token, and keeps a saved token', async () => {
  const seen = [];
  const makeRelay = (address, token) => ({ health: async () => seen.push([address, token]) });
  await checkSettings({ values: {}, secrets: {} }, makeRelay);
  await checkSettings({ values: { relay_url: 'https://r.example' }, secrets: {} }, makeRelay);
  await assert.rejects(checkSettings({ values: {}, secrets: { relay_token: 't' } }, makeRelay), ApiError);
  assert.deepEqual(seen, []);
  await checkSettings({ values: { relay_url: 'https://r.example' }, secrets: { relay_token: 't' } }, makeRelay);
  assert.deepEqual(seen, [['https://r.example', 't']]);
});

test('routes and errors keep their own shape', async () => {
  const source = {
    saveRoutes: routes => { if (!Array.isArray(routes)) throw new ApiError(400, 'Each contact can have one route.'); return routes; },
    routesView: async () => { throw new ApiError(0, 'hidden detail'); },
  };
  await withServer(source, async () => {}, async base => {
    assert.equal((await call(base, '/routes', { routes: [] })).status, 200);
    const bad = await call(base, '/routes', { routes: 'x' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).message, 'Each contact can have one route.');
    const failed = await call(base, '/routes');
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes('hidden detail'));
    assert.equal((await call(base, '/nope', {})).status, 404);
  });
});
