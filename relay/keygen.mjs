// Makes the relay's key pair: node relay/keygen.mjs <folder>
// Writes public.json (the Worker secret PUBLIC_KEY) and private.json (the
// extension's "Relay private key"), readable by you only. Prints no key.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeys } from './seal.mjs';

const folder = process.argv[2];
if (!folder) { process.stderr.write('Usage: node relay/keygen.mjs <folder>\n'); process.exit(1); }
const { publicKey, privateKey } = await generateKeys();
writeFileSync(join(folder, 'public.json'), publicKey, { mode: 0o600 });
writeFileSync(join(folder, 'private.json'), privateKey, { mode: 0o600 });
process.stdout.write(`Wrote public.json and private.json in ${folder}.\n`);
