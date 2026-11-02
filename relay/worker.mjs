// A small relay in the owner's own Cloudflare account. Meta can only deliver
// to a public address, and COGNIX[WS] opens no public port, so this holds each
// event until the owner's computer fetches it. Secrets are Worker secrets:
// APP_SECRET and VERIFY_TOKEN come from the Meta app, RELAY_TOKEN is the one
// the extension holds.

const MAX_BODY = 4 * 1024 * 1024; // Meta sends up to 3 MB.
const MAX_ROW = 1_900_000; // D1 refuses a value over 2 MB.
const MAX_PAGE = 100;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

const json = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// crypto.subtle.verify compares in constant time.
export async function signatureValid(secret, body, header) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const signature = hexToBytes(header.slice(7));
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, body);
}

// Comparing digests keeps the time independent of where two strings differ.
async function sameText(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([a, b].map(text => crypto.subtle.digest('SHA-256', encoder.encode(text))));
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

const setMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value);
const addMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = value + excluded.value').bind(key, value);

async function verifyWebhook(url, env) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (mode === 'subscribe' && await sameText(token, env.VERIFY_TOKEN)) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('', { status: 403 });
}

async function receive(request, env, now) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return new Response('', { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return new Response('', { status: 413 });
  if (!await signatureValid(env.APP_SECRET, body, request.headers.get('x-hub-signature-256'))) return new Response('', { status: 401 });

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(body)); }
  catch { return new Response('', { status: 400 }); }

  // One row per change: a batch can carry up to 1000 updates. Meta repeats a
  // delivery it could not confirm, so a row's id is its content.
  const rows = [];
  let oversize = 0;
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = JSON.stringify(change?.value ?? null);
      if (value.length > MAX_ROW) { oversize++; continue; }
      rows.push({ id: await digest(`${change?.field}\n${value}`), field: String(change?.field ?? ''), value });
    }
  }
  const statements = rows.map(row => env.DB.prepare('INSERT OR IGNORE INTO events (id, received_at, field, value) VALUES (?, ?, ?, ?)').bind(row.id, now, row.field, row.value));
  statements.push(setMeta(env.DB, 'last_received_at', now));
  if (oversize) statements.push(addMeta(env.DB, 'dropped', oversize));
  // All or nothing: a failure answers 500 and Meta delivers again.
  await env.DB.batch(statements);
  return new Response('', { status: 200 });
}

async function listEvents(url, env) {
  const after = Number(url.searchParams.get('after') || 0);
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), MAX_PAGE);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1) return json(400, { error: 'bad-cursor' });
  const { results } = await env.DB.prepare('SELECT seq, received_at, field, value FROM events WHERE seq > ? ORDER BY seq LIMIT ?').bind(after, limit).all();
  return json(200, {
    events: results.map(row => ({ seq: row.seq, receivedAt: row.received_at, field: row.field, value: JSON.parse(row.value) })),
  });
}

async function acknowledge(request, env) {
  let upTo;
  try { ({ upTo } = await request.json()); }
  catch { return json(400, { error: 'bad-body' }); }
  if (!Number.isSafeInteger(upTo) || upTo < 0) return json(400, { error: 'bad-cursor' });
  await env.DB.prepare('DELETE FROM events WHERE seq <= ?').bind(upTo).run();
  return json(200, { ok: true });
}

async function health(env) {
  const pending = await env.DB.prepare('SELECT COUNT(1) AS n FROM events').first();
  const { results } = await env.DB.prepare('SELECT key, value FROM meta').all();
  const meta = Object.fromEntries(results.map(row => [row.key, row.value]));
  return json(200, { ok: true, pending: pending?.n ?? 0, lastReceivedAt: meta.last_received_at ?? 0, dropped: meta.dropped ?? 0 });
}

export async function expire(env, now) {
  const cutoff = now - RETENTION_MS;
  const old = await env.DB.prepare('SELECT COUNT(1) AS n FROM events WHERE received_at < ?').bind(cutoff).first();
  const n = old?.n ?? 0;
  if (!n) return 0;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE received_at < ?').bind(cutoff),
    addMeta(env.DB, 'dropped', n),
  ]);
  return n;
}

export default {
  async fetch(request, env) {
    if (!env.APP_SECRET || !env.VERIFY_TOKEN || !env.RELAY_TOKEN || !env.DB) return json(503, { error: 'not-configured' });
    const url = new URL(request.url);
    const { pathname: path } = url;
    if (path === '/webhook' && request.method === 'GET') return verifyWebhook(url, env);
    if (path === '/webhook' && request.method === 'POST') return receive(request, env, Date.now());
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (!await sameText(bearer, env.RELAY_TOKEN)) return json(401, { error: 'unauthorized' });
    if (path === '/events' && request.method === 'GET') return listEvents(url, env);
    if (path === '/ack' && request.method === 'POST') return acknowledge(request, env);
    if (path === '/health' && request.method === 'GET') return health(env);
    return json(404, { error: 'not-found' });
  },
  async scheduled(_event, env, context) {
    context.waitUntil(expire(env, Date.now()));
  },
};
