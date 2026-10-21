// @ts-check
// Which fields of the stored connections are protected by the passphrase, and how a stored connection becomes the one the app uses
// (and back). A protected field holds an envelope (src/secret-box.js) while protection is on; an empty one stays empty.
import { decryptText, encryptText, isEnvelope } from './secret-box.js';

/** The protected fields of each connection. The addresses, repository and branch stay readable. */
export const PROTECTED_FIELDS = Object.freeze({
  github: ['token', 'owner'],
  webdav: ['username', 'password'],
  caldav: ['username', 'password'],
});

/** Shown in place of a protected value the app holds no plain copy of: the field is set, its value is not kept in memory. */
export const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';

/** @typedef {keyof typeof PROTECTED_FIELDS} ConnectionKind */
/** @typedef {Record<string, any>} StoredConnection */

/** Whether any protected field of a stored connection holds an envelope.
 * @param {ConnectionKind} kind @param {StoredConnection} stored */
export function hasEnvelopes(kind, stored) {
  return PROTECTED_FIELDS[kind].some((field) => isEnvelope(stored[field]));
}

/** The connection as it is stored under protection: each non-empty protected field becomes an envelope.
 * @param {ConnectionKind} kind @param {StoredConnection} config plain values @param {CryptoKey} key
 * @returns {Promise<StoredConnection>} */
export async function sealConnection(kind, config, key) {
  const out = { ...config };
  for (const field of PROTECTED_FIELDS[kind]) {
    const value = config[field];
    out[field] = typeof value === 'string' && value !== '' ? await encryptText(value, key) : typeof value === 'string' ? '' : value;
  }
  return out;
}

/** The plain connection from a stored one. A field that is not an envelope is taken as it is.
 * @param {ConnectionKind} kind @param {StoredConnection} stored @param {CryptoKey} key
 * @returns {Promise<StoredConnection>} */
export async function revealConnection(kind, stored, key) {
  const out = { ...stored };
  for (const field of PROTECTED_FIELDS[kind]) if (isEnvelope(stored[field])) out[field] = await decryptText(stored[field], key);
  return out;
}

/** What the app keeps in memory while protection is on: the readable fields, and a mask where a protected field has a value.
 * @param {ConnectionKind} kind @param {StoredConnection} config */
export function maskedConnection(kind, config) {
  const out = { ...config };
  for (const field of PROTECTED_FIELDS[kind]) if (typeof config[field] === 'string' && config[field] !== '') out[field] = MASK;
  return out;
}

/** What the app sees before the passphrase is entered: the readable fields, the protected ones masked, and `locked` set.
 * @param {ConnectionKind} kind @param {StoredConnection} stored */
export function lockedConnection(kind, stored) {
  /** @type {StoredConnection} */ const out = { ...stored, locked: true };
  for (const field of PROTECTED_FIELDS[kind]) if (isEnvelope(stored[field])) out[field] = MASK;
  return out;
}
