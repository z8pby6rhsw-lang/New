// Password-based encryption shared by the sync job and the dashboard page.
// gzip -> AES-256-GCM, key from PBKDF2-SHA256. The browser undoes it with WebCrypto.
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const ITERATIONS = 250000;

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

export async function encryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = gzipSync(Buffer.from(JSON.stringify(obj)));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
}

export async function decryptJson(box, password) {
  const key = await deriveKey(password, unb64(box.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
}

// Short secrets (the eBay refresh token) travel as a single "enc:..." string.
export async function encryptString(text, password) {
  return 'enc:' + Buffer.from(JSON.stringify(await encryptJson({ s: text }, password))).toString('base64');
}

export async function decryptString(value, password) {
  if (!value.startsWith('enc:')) return value;
  const box = JSON.parse(Buffer.from(value.slice(4), 'base64').toString('utf8'));
  return (await decryptJson(box, password)).s;
}
