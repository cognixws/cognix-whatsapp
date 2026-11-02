import { Ledger } from './ledger.mjs';
import { HostAPI } from './http.mjs';
import { Source } from './source.mjs';
import { createServer } from './server.mjs';

const required = ['PICODE_URL', 'PICODE_EXT_TOKEN', 'PICODE_EXT_DB', 'PICODE_EXT_PORT', 'PICODE_EXT_PROXY_SECRET'];
if (Number(process.versions.node.split('.')[0]) < 24 || required.some(key => !process.env[key])) {
  process.stderr.write('WhatsApp\'s official source needs Node.js 24 or newer and must be started by COGNIX[WS].\n');
  process.exit(1);
}
const ledger = new Ledger(process.env.PICODE_EXT_DB);
const host = new HostAPI({ url: process.env.PICODE_URL, token: process.env.PICODE_EXT_TOKEN, caFile: process.env.PICODE_CA_FILE });
const source = new Source({ ledger, host });
const server = createServer(source, { secret: process.env.PICODE_EXT_PROXY_SECRET });
server.listen(Number(process.env.PICODE_EXT_PORT), '127.0.0.1', async () => {
  try { await source.configure(); }
  catch { source.state = 'host-unavailable'; }
  source.start();
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  source.stop();
  server.close(() => { ledger.close(); process.exit(0); });
  setTimeout(() => { ledger.close(); process.exit(0); }, 1500).unref();
});
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, () => {
  process.stderr.write('WhatsApp\'s official source stopped unexpectedly. Restart it from COGNIX[WS].\n');
  process.exit(1);
});
