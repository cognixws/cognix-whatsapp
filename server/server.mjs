import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, Relay } from './http.mjs';

const MAX_BODY = 64 * 1024;

// Checks candidate settings before COGNIX[WS] saves them. The values are used once
// and never returned or logged.
export async function checkSettings(body, makeRelay = (address, token) => new Relay(address, token)) {
  const address = body.values?.relay_url;
  const token = body.secrets?.relay_token;
  if (!address && !token) return;
  if (!address) throw new ApiError(400, 'Add the relay address too.');
  if (!token) return; // The saved token stays; it was checked when it was saved.
  await makeRelay(address, token).health();
}

export function createServer(source, { secret, check = checkSettings }) {
  return http.createServer(async (request, response) => {
    const reply = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    const supplied = Buffer.from(request.headers['x-picode-proxy-secret'] || '');
    const expected = Buffer.from(secret);
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      reply(401, { message: 'Open this page through COGNIX[WS].' });
      return;
    }
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    try {
      if (request.method === 'GET' && path === '/status') { reply(200, source.status()); return; }
      if (request.method === 'GET' && path === '/routes') { reply(200, await source.routesView()); return; }
      if (request.method !== 'POST') { reply(404, { message: 'This action is unavailable.' }); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { message: 'This request is too large.' }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
      catch { reply(400, { message: 'This request could not be read.' }); return; }
      if (path === '/routes') { reply(200, { routes: source.saveRoutes(body.routes) }); return; }
      if (path === '/check') { source.polls = 0; await source.poll(); reply(200, source.status()); return; }
      if (path === '/settings/check') {
        try { await check(body); reply(200, { valid: true }); }
        catch (error) {
          // COGNIX[WS] turns these into its own sentence: 400 and 401 say to check
          // the settings, anything else to try again.
          const rejected = error.status === 401 || error.status === 403;
          reply(error.status === 400 ? 400 : rejected ? 401 : 502, { valid: false });
        }
        return;
      }
      reply(404, { message: 'This action is unavailable.' });
    } catch (error) {
      reply(error instanceof ApiError && error.status === 400 ? 400 : 502, { message: error instanceof ApiError && error.status === 400 ? error.message : 'This could not be done. Try again.' });
    }
  });
}
