// @ts-check
// Passphrase encryption for stored logins: PBKDF2-SHA256 turns a passphrase into an AES-256-GCM key, and each secret is an
// envelope { format, v, iv, ct } (base64). The key derivation settings (salt, iterations) are stored once beside the switch that
// turns protection on, so the count can be raised later. Pure: it needs only Web Crypto, which browsers and Node both have.

export const SECRET_FORMAT = 'org-pwa-secret';
export const DEFAULT_ITERATIONS = 600000;
const MIN_ITERATIONS = 10000; // a stored value below this is refused, not trusted
const CHECK_TEXT = 'org-pwa connections';

/** @typedef {{ name: 'PBKDF2-SHA256', iter: number, salt: string }} Kdf */
/** @typedef {{ format: 'org-pwa-secret', v: 1, iv: string, ct: string }} SecretEnvelope */

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** @param {string} text */
function fromBase64(text) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Fresh key-derivation settings with a random salt.
 * @param {number} [iter]
 * @returns {Kdf} */
export function newKdf(iter = DEFAULT_ITERATIONS) {
  return { name: 'PBKDF2-SHA256', iter, salt: toBase64(globalThis.crypto.getRandomValues(new Uint8Array(16))) };
}

/** Whether a stored value looks like key-derivation settings this code can use.
 * @param {unknown} kdf
 * @returns {kdf is Kdf} */
export function isKdf(kdf) {
  const k = /** @type {Record<string, unknown>} */ (kdf);
  return !!k && k.name === 'PBKDF2-SHA256' && Number.isInteger(k.iter) && /** @type {number} */ (k.iter) >= MIN_ITERATIONS && typeof k.salt === 'string' && k.salt.length >= 16;
}

/** The AES-GCM key for a passphrase. It cannot be exported from the key object.
 * @param {string} passphrase
 * @param {Kdf} kdf
 * @returns {Promise<CryptoKey>} */
export async function deriveKey(passphrase, kdf) {
  if (!isKdf(kdf)) throw new Error('Unusable key settings.');
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(kdf.salt), iterations: kdf.iter }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** @param {unknown} value
 * @returns {value is SecretEnvelope} */
export function isEnvelope(value) {
  const e = /** @type {Record<string, unknown>} */ (value);
  return !!e && typeof e === 'object' && e.format === SECRET_FORMAT && e.v === 1 && typeof e.iv === 'string' && typeof e.ct === 'string';
}

/** @param {string} plain @param {CryptoKey} key @returns {Promise<SecretEnvelope>} */
export async function encryptText(plain, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return { format: SECRET_FORMAT, v: 1, iv: toBase64(iv), ct: toBase64(ct) };
}

/** The text of an envelope; throws when the key is wrong or the envelope was changed.
 * @param {SecretEnvelope} envelope @param {CryptoKey} key @returns {Promise<string>} */
export async function decryptText(envelope, key) {
  if (!isEnvelope(envelope)) throw new Error('Not an encrypted value.');
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ct));
  return new TextDecoder().decode(plain);
}

/** A known text encrypted under the key, stored with the switch to tell a wrong passphrase from damaged data.
 * @param {CryptoKey} key */
export function makeCheck(key) {
  return encryptText(CHECK_TEXT, key);
}

/** @param {unknown} check @param {CryptoKey} key @returns {Promise<boolean>} */
export async function verifyCheck(check, key) {
  if (!isEnvelope(check)) return false;
  try {
    return (await decryptText(check, key)) === CHECK_TEXT;
  } catch {
    return false;
  }
}
