// @ts-check
// The session's key for the protected connections (see src/connection-secrets.js). `vault.protected` says protection is switched on;
// `vault.key` is set once the passphrase has been entered and lives only in memory, so a full reload locks again. settings.js reads and
// writes the connections through here, so everything that loads a connection gets the plain values once unlocked and blank, `locked`
// ones before.
import { hasEnvelopes, lockedConnection, maskedConnection, revealConnection, sealConnection } from '../src/connection-secrets.js';
import { S } from './app-state.js';

/** @type {{ protected: boolean, key: CryptoKey | null, pending: Promise<boolean> | null, noticed: boolean, lease: { count: number, github: typeof S.githubConfig | null, webdav: typeof S.webdavConfig | null, caldav: typeof S.caldavConfig | null }, marker: { v: number, kdf: import('../src/secret-box.js').Kdf, check: import('../src/secret-box.js').SecretEnvelope } | null }} */
export const vault = { protected: false, key: null, pending: null, noticed: false, marker: null, lease: { count: 0, github: null, webdav: null, caldav: null } };

/** The connection as the app keeps it in state: masked while protection is on, so no plain login sits in memory between requests. A request
 *  borrows the plain one for its duration (leaseConnections in connection-protection.js).
 * @template {Record<string, any>} T
 * @param {import('../src/connection-secrets.js').ConnectionKind} kind
 * @param {T} config
 * @returns {T} */
export function forState(kind, config) {
  return vault.protected ? /** @type {T} */ (maskedConnection(kind, config)) : config;
}

/** What a request uses: the plain connection while one is leased, else the one in state. */
export function currentGithub() {
  return vault.lease.github || S.githubConfig;
}
export function currentWebdav() {
  return vault.lease.webdav || S.webdavConfig;
}
export function currentCaldav() {
  return vault.lease.caldav || S.caldavConfig;
}

/** Whether the connections are protected and not yet unlocked this session. */
export function connectionsLocked() {
  return vault.protected && !vault.key;
}

/** The connection the app uses, from its stored form.
 * @template {Record<string, any>} T
 * @param {import('../src/connection-secrets.js').ConnectionKind} kind
 * @param {T} stored
 * @returns {Promise<T>} */
export async function openConnection(kind, stored) {
  if (!hasEnvelopes(kind, stored)) return stored;
  if (!vault.key) return /** @type {T} */ (lockedConnection(kind, stored));
  try {
    return /** @type {T} */ (await revealConnection(kind, stored, vault.key));
  } catch {
    return /** @type {T} */ (lockedConnection(kind, stored));
  }
}

/** The form to store: sealed while protection is on. Throws while locked, so a blank locked view is never saved over the real thing.
 * @param {import('../src/connection-secrets.js').ConnectionKind} kind
 * @param {Record<string, any>} plain */
export async function sealForStore(kind, plain) {
  if (!vault.protected) return plain;
  if (!vault.key) throw new Error('The connections are locked. Enter the passphrase first.');
  return sealConnection(kind, plain, vault.key);
}
