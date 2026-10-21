// @ts-check
// The passphrase for the stored connections (GitHub, WebDAV, CalDAV/CardDAV logins): turning it on and off, asking for it once
// per session, and refreshing what the app holds once it is entered. The key lives in connection-vault.js, in memory only.
import { isKdf, deriveKey, makeCheck, newKdf, verifyCheck } from '../src/secret-box.js';
import { hasEnvelopes, revealConnection, sealConnection } from '../src/connection-secrets.js';
import { S } from './app-state.js';
import { connectionsLocked, forState, vault } from './connection-vault.js';
import { confirmDialog, openMultiFieldPopup } from './dialogs.js';
import { setStatus } from './editing.js';
import { getCaldavConfig, getConnectionProtection, getGithubConfig, getWebdavConfig, setCaldavConfig, setConnectionProtection, setGithubConfig, setWebdavConfig } from './settings.js';
import { kv } from './singletons.js';

/** Reads whether protection is on, at start-up. The key stays empty until the passphrase is entered. */
export async function loadProtection() {
  const marker = await getConnectionProtection(kv);
  vault.protected = !!marker;
  vault.marker = marker && isKdf(marker.kdf) ? marker : null;
  vault.key = null;
}

/** Puts the connections the app holds (plain once unlocked, blank before) back in S. */
export async function refreshConnectionsInState() {
  S.githubConfig = forState('github', await getGithubConfig(kv));
  S.webdavConfig = forState('webdav', await getWebdavConfig(kv));
  S.caldavConfig = forState('caldav', await getCaldavConfig(kv));
}

/** @param {string} passphrase
 * @returns {Promise<boolean>} whether it was the passphrase */
export async function unlockConnections(passphrase) {
  const marker = vault.marker;
  if (!marker) return false;
  let key;
  try {
    key = await deriveKey(passphrase, marker.kdf);
  } catch {
    return false;
  }
  if (!(await verifyCheck(marker.check, key))) return false;
  vault.key = key;
  await refreshConnectionsInState();
  return true;
}

function promptUnlock() {
  return new Promise((resolve) => {
    openMultiFieldPopup({
      label: 'Unlock connections',
      note: 'Enter the passphrase for your GitHub, WebDAV and calendar logins. It is asked once, until the page is reloaded.',
      fields: [{ key: 'passphrase', label: 'Passphrase', type: 'password', value: '' }],
      onSave: async (values) => {
        if (await unlockConnections(values.passphrase)) {
          resolve(true);
          return undefined;
        }
        return { keepOpen: true, error: 'That is not the passphrase.' };
      },
      onCancel: () => resolve(false),
    });
  });
}

/** True when the connections can be used: not protected, already unlocked, or unlocked now by asking for the passphrase.
 *  Asked for once at a time; false when the person cancels. */
export async function ensureConnectionsUnlocked() {
  if (!connectionsLocked()) return true;
  if (!vault.pending) {
    vault.pending = /** @type {Promise<boolean>} */ (promptUnlock()).finally(() => {
      vault.pending = null;
    });
  }
  return vault.pending;
}

/** For work that runs by itself (a sync timer): true when unlocked, never asks.
 * @returns {boolean} */
export function connectionsReadyQuietly() {
  return !connectionsLocked();
}

/** The start of a calendar or contacts sync: true when the logins can be used. A person's own Sync asks for the passphrase; a run that
 *  starts by itself never asks and says once that it is waiting.
 * @param {boolean} manual
 * @param {(message: string) => void} report */
export async function unlockForSync(manual, report) {
  if (!connectionsLocked()) return true;
  if (manual) {
    if (await ensureConnectionsUnlocked()) return true;
    report('The connections are locked \u2014 enter the passphrase to sync.');
    return false;
  }
  if (!vault.noticed && S.caldavConfig && (S.caldavConfig.url || S.caldavConfig.contactsUrl)) {
    vault.noticed = true;
    report('Calendar and contacts sync wait for the passphrase (Sync asks for it).');
  }
  return false;
}

/** Borrows the plain logins for one piece of work (a request, a sync run) and gives back a function that returns them: they are decrypted
 *  at that moment and dropped when the last borrower is done, so between requests the app holds only masked ones.
 * @returns {Promise<() => void>} */
export async function leaseConnections() {
  if (!vault.protected) return () => {};
  if (!vault.key) throw new Error('The connections are locked. Enter the passphrase to use them.');
  const lease = vault.lease;
  lease.count++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--lease.count === 0) {
      lease.github = null;
      lease.webdav = null;
      lease.caldav = null;
    }
  };
  try {
    if (!lease.github || !lease.webdav || !lease.caldav) {
      lease.github = await getGithubConfig(kv);
      lease.webdav = await getWebdavConfig(kv);
      lease.caldav = await getCaldavConfig(kv);
    }
  } catch (err) {
    release();
    throw err;
  }
  return release;
}

/** Runs a sync (or any work that uses the logins) with them leased; the work is skipped, quietly for an automatic run, when they are locked.
 * @param {boolean} manual
 * @param {(message: string) => void} report
 * @param {() => Promise<void>} work */
export async function withConnections(manual, report, work) {
  if (!(await unlockForSync(manual, report))) return;
  const release = await leaseConnections();
  try {
    await work();
  } finally {
    release();
  }
}

/** Switches protection on with this passphrase: the logins stored now are sealed and the key is kept for the session.
 * @param {string} passphrase */
export async function enableProtection(passphrase) {
  const plain = { github: await getGithubConfig(kv), webdav: await getWebdavConfig(kv), caldav: await getCaldavConfig(kv) };
  const kdf = newKdf();
  const key = await deriveKey(passphrase, kdf);
  const marker = { v: 1, kdf, check: await makeCheck(key) };
  await setConnectionProtection(kv, marker); // first: a stored plain login is still read as plain until it is sealed
  vault.protected = true;
  vault.marker = marker;
  vault.key = key;
  await setGithubConfig(kv, plain.github);
  await setWebdavConfig(kv, plain.webdav);
  await setCaldavConfig(kv, plain.caldav);
  await refreshConnectionsInState();
}

/** Switches protection off: the logins are written back as they are. Needs the connections unlocked. */
export async function disableProtection() {
  if (connectionsLocked()) throw new Error('Unlock the connections first.');
  const plain = { github: await getGithubConfig(kv), webdav: await getWebdavConfig(kv), caldav: await getCaldavConfig(kv) };
  vault.protected = false;
  vault.key = null;
  vault.marker = null;
  await setGithubConfig(kv, plain.github); // stored plain now
  await setWebdavConfig(kv, plain.webdav);
  await setCaldavConfig(kv, plain.caldav);
  await setConnectionProtection(kv, null);
  await refreshConnectionsInState();
}

/** The dialog that turns protection on: a passphrase twice, with what it means said plainly. */
export function openEnableProtectionDialog(/** @type {() => void} */ done) {
  openMultiFieldPopup({
    label: 'Protect connections with a passphrase',
    note:
      'Your GitHub token and owner, and the user names and passwords of WebDAV and the calendar, are stored encrypted. The passphrase is asked for the first time one is used, and again after the page is reloaded. It is not stored: if you forget it, enter the logins again. Other settings are not encrypted.',
    fields: [
      { key: 'passphrase', label: 'Passphrase', type: 'password', value: '' },
      { key: 'again', label: 'Passphrase again', type: 'password', value: '' },
    ],
    onSave: async (values) => {
      if (values.passphrase.length < 8) return { keepOpen: true, error: 'Use at least 8 characters.' };
      if (values.passphrase !== values.again) return { keepOpen: true, error: 'The two passphrases differ.' };
      await enableProtection(values.passphrase);
      setStatus('Connections are protected with your passphrase.');
      done();
      return undefined;
    },
  });
}

/** Turns protection off after asking (and after unlocking, if needed). */
export async function askDisableProtection(/** @type {() => void} */ done) {
  if (!(await ensureConnectionsUnlocked())) return;
  if (!(await confirmDialog('Store the logins without a passphrase again? They will be saved as plain text in this browser.', { confirmLabel: 'Turn off', danger: true }))) return;
  await disableProtection();
  setStatus('Connections are no longer protected by a passphrase.');
  done();
}

const KINDS = /** @type {const} */ (['github', 'webdav', 'caldav']);

/** Asks for the passphrase a backup file was protected with; resolves to its key, or null when cancelled.
 * @param {{ v: number, kdf: import('../src/secret-box.js').Kdf, check: import('../src/secret-box.js').SecretEnvelope }} marker
 * @returns {Promise<CryptoKey | null>} */
function askBackupKey(marker) {
  return new Promise((resolve) => {
    openMultiFieldPopup({
      label: 'Passphrase of this backup',
      note: 'The logins in this file are encrypted. Enter the passphrase they were protected with.',
      fields: [{ key: 'passphrase', label: 'Passphrase', type: 'password', value: '' }],
      onSave: async (values) => {
        try {
          const key = await deriveKey(values.passphrase, marker.kdf);
          if (await verifyCheck(marker.check, key)) {
            resolve(key);
            return undefined;
          }
        } catch {
          /* falls through to the error */
        }
        return { keepOpen: true, error: 'That is not the passphrase.' };
      },
      onCancel: () => resolve(null),
    });
  });
}

/** Gets a settings file ready to import, so a login is never stored in a form this device cannot read: on a protected device the
 *  logins in the file are sealed with this device's passphrase (asking for the file's own first when it has one); on an unprotected
 *  device a protected file brings its passphrase along. Resolves to the bundle to import, or null when the person cancels.
 * @param {{ settings?: Record<string, Record<string, unknown>> } | null} bundle
 * @returns {Promise<unknown>} */
export async function prepareImport(bundle) {
  const settings = bundle && typeof bundle === 'object' && bundle.settings && typeof bundle.settings === 'object' ? bundle.settings : null;
  if (!settings) return bundle;
  const fileMarker = /** @type {{ v: number, kdf: import('../src/secret-box.js').Kdf, check: import('../src/secret-box.js').SecretEnvelope }} */ (/** @type {unknown} */ (settings.connectionProtection));
  const fileProtected = !!fileMarker && isKdf(fileMarker.kdf);
  if (!vault.protected) {
    if (!fileProtected && fileMarker) delete settings.connectionProtection;
    return bundle;
  }
  if (!(await ensureConnectionsUnlocked()) || !vault.key) return null;
  let fileKey = null;
  if (fileProtected && KINDS.some((k) => settings[k])) {
    fileKey = await askBackupKey(fileMarker);
    if (!fileKey) return null;
  }
  delete settings.connectionProtection;
  for (const kind of KINDS) {
    if (!settings[kind]) continue;
    const plain = hasEnvelopes(kind, settings[kind]) && fileKey ? await revealConnection(kind, settings[kind], fileKey) : settings[kind];
    settings[kind] = await sealConnection(kind, plain, vault.key);
  }
  return bundle;
}

/** After an import: re-reads the protection and the connections, and asks for the passphrase when the file brought its own.
 * @param {string[]} imported */
export async function afterImport(imported) {
  if (imported.includes('connectionProtection')) {
    const wasLocked = connectionsLocked();
    if (!vault.key) await loadProtection();
    await refreshConnectionsInState();
    if (connectionsLocked() && !wasLocked) await ensureConnectionsUnlocked();
    return;
  }
  if (KINDS.some((k) => imported.includes(k))) await refreshConnectionsInState();
}
