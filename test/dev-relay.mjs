// The real relay Worker on a loopback port, with a fake D1, to test the whole
// path on one computer: node test/dev-relay.mjs <port>. Secrets come from the
// environment. Never used in production.
import http from 'node:http';
import worker from '../relay/worker.mjs';
import { fakeD1 } from './d1-fake.mjs';

const env = { APP_SECRET: process.env.DEV_APP_SECRET, VERIFY_TOKEN: process.env.DEV_VERIFY_TOKEN, RELAY_TOKEN: process.env.DEV_RELAY_TOKEN, DB: fakeD1() };
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const init = { method: req.method, headers: req.headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
  const answer = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, init), env).catch(() => new Response('', { status: 500 }));
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
}).listen(Number(process.argv[2]), '127.0.0.1');
