// What waits in the relay is sealed to a key only the owner's computer holds:
// the Worker has the public half, so the Cloudflare account alone cannot read
// it. Each event gets a fresh ECDH P-256 key; HKDF-SHA-256 derives an AES-GCM
// key from the shared secret. Web Crypto only, so the Worker and Node share it.

const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode('picode-whatsapp relay v1');
const b64 = (bytes) => {
  const view = new Uint8Array(bytes);
  let text = '';
  // In slices: a spread of a megabyte would pass too many arguments.
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
};
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function aesKey(privateKey, publicKey, salt, usage) {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function generateKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const [publicJwk, privateJwk] = await Promise.all([pair.publicKey, pair.privateKey].map(k => crypto.subtle.exportKey('jwk', k)));
  return { publicKey: JSON.stringify(publicJwk), privateKey: JSON.stringify(privateJwk) };
}

export async function seal(publicJwk, text) {
  const recipient = await crypto.subtle.importKey('jwk', JSON.parse(publicJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const epk = await crypto.subtle.exportKey('raw', eph.publicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(eph.privateKey, recipient, new Uint8Array(epk), 'encrypt');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return JSON.stringify({ v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) });
}

// Imports the owner's private key once; a bad one fails here, not per event.
export const privateKey = privateJwk => crypto.subtle.importKey('jwk', JSON.parse(privateJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);

export async function open(mine, sealed) {
  const box = JSON.parse(sealed);
  if (box?.v !== 1) throw new Error('unknown seal');
  const epkBytes = unb64(box.epk);
  const epk = await crypto.subtle.importKey('raw', epkBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await aesKey(mine, epk, epkBytes, 'decrypt');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}
