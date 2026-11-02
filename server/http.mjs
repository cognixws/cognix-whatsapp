import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

export class ApiError extends Error {
  constructor(status, message, { code = '' } = {}) { super(message); this.status = status; this.code = code; }
}

// Never logs or reflects a request URL, a token or a response body. Redirects
// are errors, so only the named endpoint ever receives a credential.
export function jsonRequest(url, { method = 'GET', body, headers = {}, ca, timeout = 15_000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((done, fail) => {
    let settled = false;
    let deadline;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(deadline); fn(value); };
    const transport = url.protocol === 'https:' ? https : http;
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = transport.request(url, { method, ca, headers: { ...headers, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(); else chunks.push(chunk);
      });
      response.on('end', () => {
        const status = response.statusCode;
        if (status >= 300) { finish(fail, new ApiError(status, 'The service refused this request.')); return; }
        try { finish(done, JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
        catch { finish(fail, new ApiError(status, 'The answer could not be read.')); }
      });
      response.on('error', () => finish(fail, new ApiError(0, 'The connection failed.')));
    });
    deadline = setTimeout(() => request.destroy(), timeout);
    request.on('error', () => finish(fail, new ApiError(0, 'The connection failed.')));
    request.end(bytes);
  });
}

export class HostAPI {
  constructor({ url, token, caFile }) {
    this.url = new URL(url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(this.url.hostname)) throw new Error('COGNIX[WS] must provide its loopback address.');
    this.headers = { 'X-PiCode-Extension-Token': token };
    if (caFile) this.ca = readFileSync(caFile);
  }
  request(path, body) {
    if (!path.startsWith('/api/ext/v1/')) throw new Error('Only the extension Host API may be used.');
    return jsonRequest(new URL(path, this.url), { body, method: body === undefined ? 'GET' : 'POST', headers: this.headers, ca: this.ca });
  }
  settings() { return this.request('/api/ext/v1/settings'); }
  agents() { return this.request('/api/ext/v1/agents'); }
  message(to, text) { return this.request('/api/ext/v1/messages', { to, text }); }
  inbox(title, body) { return this.request('/api/ext/v1/inbox', { title, body }); }
}

// The relay must be HTTPS. Plain HTTP is only ever the same computer, for tests.
export function relayAddress(raw) {
  let url;
  try { url = new URL(String(raw ?? '').trim()); }
  catch { throw new ApiError(400, 'Check the relay address.'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password) throw new ApiError(400, 'Use the relay\'s https address.');
  return new URL(url.origin);
}

// A person waits on this when pressing Check, so a relay that hangs gives up sooner.
const RELAY_TIMEOUT_MS = 8_000;

export class Relay {
  constructor(address, token, { request = jsonRequest } = {}) {
    this.base = relayAddress(address);
    this.headers = { Authorization: `Bearer ${token}` };
    this.send = request;
  }
  events(after, limit = 50) { return this.send(new URL(`/events?after=${after}&limit=${limit}`, this.base), { headers: this.headers, timeout: RELAY_TIMEOUT_MS }); }
  ack(upTo) { return this.send(new URL('/ack', this.base), { method: 'POST', body: { upTo }, headers: this.headers, timeout: RELAY_TIMEOUT_MS }); }
  health() { return this.send(new URL('/health', this.base), { headers: this.headers, timeout: RELAY_TIMEOUT_MS }); }
}
