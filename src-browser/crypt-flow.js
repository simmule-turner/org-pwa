// @ts-check
// Org Crypt: org-encrypt-entry, org-decrypt-entry, org-encrypt-entries and org-decrypt-entries, the keys they use (Settings →
// Encryption keys), the passphrase prompt, and what happens to the copy kept on this device while entries are decrypted
// (org-crypt-disable-auto-save). The editing is src/org-crypt.js; the cipher is src/pgp.js.
import { lispStringValue } from '../src/export-defaults.js';
import { getUseTagInheritance } from '../src/local-variables.js';
import { decryptEntries, decryptEntry, encryptEntries, encryptEntry, encryptedEntryAt, encryptsBeforeSave, headingOffset } from '../src/org-crypt.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { makePgpCipher, mergeKeys, readKeyBlock } from '../src/pgp.js';
import { S } from './app-state.js';
import { confirmDialog, openMultiFieldPopup, openTextFieldPopup } from './dialogs.js';
import { replaceDocumentText, setStatus } from './editing.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { menuButton } from './ui-widgets.js';

/** @typedef {import('../src/pgp.js').KeyInfo} KeyInfo */
/** @typedef {import('../src/types.js').Heading} Heading */

const KEYRING_KEY = 'org-crypt:keyring';
/** How long a passphrase that was typed stays at hand: what gpg-agent keeps it for by default (default-cache-ttl, 600 seconds). */
const PASSPHRASE_TTL_MS = 600 * 1000;
/** The longest a passphrase stays, however often it is used: gpg-agent's max-cache-ttl, 7200 seconds. */
const PASSPHRASE_MAX_MS = 7200 * 1000;

/** The keys on this device. @returns {Promise<KeyInfo[]>} */
export async function loadKeyring() {
  if (S.cryptKeys) return S.cryptKeys;
  /** @type {unknown} */ let value;
  try {
    const stored = /** @type {unknown} */ (await kv.get(KEYRING_KEY));
    const raw = stored && typeof stored === 'object' && 'value' in stored ? /** @type {{ value: unknown }} */ (stored).value : stored;
    value = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    value = [];
  }
  S.cryptKeys = Array.isArray(value) ? /** @type {KeyInfo[]} */ (value) : [];
  return S.cryptKeys;
}

/** @param {KeyInfo[]} keys */
async function storeKeyring(keys) {
  S.cryptKeys = keys;
  await kv.set(KEYRING_KEY, JSON.stringify(keys));
}

/** Adds the keys in `text` (ASCII-armored public or secret keys) to the keyring. @param {string} text @returns {Promise<KeyInfo[]>} the keys that were read */
export async function importKeys(text) {
  const read = await readKeyBlock(text);
  await storeKeyring(mergeKeys(await loadKeyring(), read));
  return read;
}

/** @param {string} fingerprint */
export async function removeKey(fingerprint) {
  await storeKeyring((await loadKeyring()).filter((k) => k.fingerprint !== fingerprint));
}

/** The passphrases typed lately (ten minutes after the last use, two hours at most), by what they were for. Kept in memory only. @returns {Map<string, { value: string, until: number, since: number }>} */
function passphraseCache() {
  if (!S.cryptPassphrases) S.cryptPassphrases = new Map();
  return S.cryptPassphrases;
}

/**
 * The prompt for a passphrase (what pinentry is in Emacs). A passphrase that was typed lately is used again; the prompt after a wrong one
 * does not offer it. With `prompt` off (the copy kept on this device, made in the background) there is nobody to ask.
 * @param {import('../src/pgp.js').PassphraseRequest} request @param {boolean} prompt @returns {Promise<string>}
 */
function askPassphrase(request, prompt) {
  const slot = request.kind === 'key' ? 'key:' + request.label : 'message';
  const cache = passphraseCache();
  const have = cache.get(slot);
  if (request.retry) cache.delete(slot);
  else if (have && have.until > Date.now()) {
    have.until = Math.min(Date.now() + PASSPHRASE_TTL_MS, have.since + PASSPHRASE_MAX_MS);
    return Promise.resolve(have.value);
  }
  if (!prompt) return Promise.reject(new Error('the passphrase is asked for when an entry is encrypted'));
  return new Promise((resolve, reject) => {
    const asked = request.kind === 'new';
    openMultiFieldPopup({
      label: request.kind === 'key' ? `Passphrase for the key of ${request.label}` : asked ? 'Passphrase to encrypt with' : 'Passphrase of the entry',
      note: request.retry ? 'That was not the passphrase. Try again.' : asked ? 'Anyone with this passphrase can read the entry, in Emacs or with gpg. It is not saved; it is kept in memory for ten minutes.' : 'It is kept in memory for ten minutes, as gpg-agent keeps it.',
      fields: [
        { key: 'passphrase', label: 'Passphrase', type: 'password', value: '' },
        ...(asked ? [{ key: 'again', label: 'Passphrase again', type: 'password', value: '' }] : []),
      ],
      onSave: async (values) => {
        if (asked && values.passphrase !== values.again) return { keepOpen: true, error: 'The two passphrases differ.' };
        cache.set(slot, { value: values.passphrase, until: Date.now() + PASSPHRASE_TTL_MS, since: Date.now() });
        resolve(values.passphrase);
        return undefined;
      },
      onCancel: () => reject(new Error('Quit')),
    });
  });
}

/** The value of a symbol setting (`ask`, `t`, `nil`, `encrypt`). @param {string | undefined} raw @param {string} fallback */
function symbolSetting(raw, fallback) {
  const v = (raw ?? '').trim().replace(/^'/, '');
  return v || fallback;
}

/**
 * The settings org-crypt reads, with the cipher.
 * @param {{ prompt?: boolean }} [how] `prompt: false`: never ask for a passphrase
 * @returns {import('../src/org-crypt.js').CryptOptions}
 */
function cryptOptions(how = {}) {
  const vars = S.state.localVariables || {};
  const keyRaw = vars['org-crypt-key'];
  const key = keyRaw === undefined ? '' : (lispStringValue(keyRaw) ?? (keyRaw.trim() === 'nil' ? null : ''));
  const id = String(S.state.documentId);
  if (!S.cryptReuse) S.cryptReuse = new Map();
  if (!S.cryptReuse.has(id)) S.cryptReuse.set(id, new Map());
  return {
    cipher: makePgpCipher({ keyring: () => S.cryptKeys || [], askPassphrase: (request) => askPassphrase(request, how.prompt !== false) }),
    key,
    matcher: lispStringValue(vars['org-crypt-tag-matcher']) ?? 'crypt',
    tagInheritance: getUseTagInheritance(vars),
    reuse: /** @type {Map<string, string>} */ (S.cryptReuse.get(id)),
    notify: (message) => setStatus(message),
  };
}

/** The number of the heading in the order of the file. @param {Heading} heading @returns {number} */
function ordinalOf(heading) {
  let n = 0;
  let found = -1;
  /** @param {Heading[]} nodes */
  const walk = (nodes) => {
    for (const h of nodes) {
      if (h.type !== 'heading') continue;
      if (h === heading) found = n;
      n++;
      walk(h.children || []);
    }
  };
  walk(S.state.doc.children);
  return found;
}

/** `org-crypt-check-auto-save`, called when an entry is decrypted: what to do about the copy of the file kept on this device, which is written after every edit. @returns {Promise<void>} */
async function checkAutoSave() {
  const id = String(S.state.documentId);
  if (!S.cryptDecrypted) S.cryptDecrypted = new Map();
  const mode = symbolSetting((S.state.localVariables || {})['org-crypt-disable-auto-save'], 'ask');
  const name = id.split('/').pop() || id;
  if (mode === 't' || (mode === 'ask' && (await confirmDialog('org-decrypt: auto-save may cause leakage. Disable it for current buffer?', { confirmLabel: 'Yes', cancelLabel: 'No', danger: false })))) {
    S.cryptDecrypted.set(id, 'off');
    setStatus(`org-decrypt: Disabling auto-save for ${name}`);
  } else if (mode === 'encrypt') {
    S.cryptDecrypted.set(id, 'encrypt');
    setStatus('org-decrypt: Enabling re-encryption on auto-save.');
  } else {
    S.cryptDecrypted.set(id, 'on');
    setStatus('org-decrypt: Decrypting entry with auto-save-mode enabled. This may cause leakage.');
  }
}

/**
 * The document to write to the copy kept on this device after an edit: the document itself, or null when nothing is written while
 * entries are decrypted (org-crypt-disable-auto-save t), or the document with its entries encrypted (encrypt).
 * @param {import('../src/types.js').Doc} doc @returns {Promise<import('../src/types.js').Doc | null>}
 */
export async function cryptPersistDoc(doc) {
  const mode = S.cryptDecrypted && S.cryptDecrypted.get(String(S.state.documentId));
  if (!mode || mode === 'on') return doc;
  if (mode === 'off') return null;
  try {
    return parseOrg(await encryptEntries(serializeOrg(doc), cryptOptions({ prompt: false })));
  } catch (err) {
    setStatus('org-crypt: this edit was not kept on this device: ' + /** @type {Error} */ (err).message);
    return null;
  }
}

/** Is the undo history kept on this device? Not while entries are decrypted, unless `org-crypt-disable-auto-save` is nil. */
export function cryptKeepsHistory() {
  const mode = S.cryptDecrypted && S.cryptDecrypted.get(String(S.state.documentId));
  return !mode || mode === 'on';
}

/** The file is saved: with `(org-crypt-use-before-save-magic)` in the init, its entries are encrypted first, as `before-save-hook` does in Emacs. @returns {Promise<boolean>} false when that failed or was cancelled, so the file is not saved */
export async function cryptBeforeSave() {
  if (!S.state.doc || !encryptsBeforeSave((S.state.localVariables || {})['before-save-hook'])) return true;
  try {
    await loadKeyring();
    const text = serializeOrg(S.state.doc);
    const out = await encryptEntries(text, cryptOptions());
    if (out !== text) replaceDocumentText(out, 'Encrypted entries before saving');
    return true;
  } catch (err) {
    setStatus('org-crypt: not saved: ' + /** @type {Error} */ (err).message);
    return false;
  }
}

/**
 * Runs one of the four commands on the document on screen.
 * @param {'encrypt-entry' | 'decrypt-entry' | 'encrypt-entries' | 'decrypt-entries'} kind
 */
export async function runCrypt(kind) {
  if (!S.state.doc) return;
  try {
    await loadKeyring();
    const text = serializeOrg(S.state.doc);
    const options = cryptOptions();
    const single = kind.endsWith('-entry');
    let at = 0;
    if (single) {
      if (!S.keyboardFocusedHeading) throw new Error('Before first headline');
      at = headingOffset(text, ordinalOf(S.keyboardFocusedHeading)) ?? 0;
    }
    const decrypting = kind.startsWith('decrypt');
    if (decrypting && (!single || encryptedEntryAt(text, at))) await checkAutoSave();
    const out = await (kind === 'encrypt-entry' ? encryptEntry(text, at, options) : kind === 'decrypt-entry' ? decryptEntry(text, at, options) : kind === 'encrypt-entries' ? encryptEntries(text, options) : decryptEntries(text, options));
    if (out === text) {
      setStatus(single ? (decrypting ? 'This entry is not encrypted.' : 'This entry is already encrypted.') : 'No entries to ' + (decrypting ? 'decrypt.' : 'encrypt.'));
      return;
    }
    replaceDocumentText(out, decrypting ? 'Decrypted entries' : 'Encrypted entries');
    setStatus(decrypting ? 'Decrypted.' : 'Encrypted.');
    render();
  } catch (err) {
    const message = /** @type {Error} */ (err).message;
    setStatus(message === 'Quit' ? 'Quit' : 'org-crypt: ' + message);
  }
}

/** Settings → Encryption keys: the keys org-crypt uses, and a way to add and remove them. @returns {HTMLElement} */
export function buildEncryptionCard() {
  const section = document.createElement('div');
  section.className = 'settings-section';
  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'Encryption keys';
  section.appendChild(title);
  const list = document.createElement('div');
  list.setAttribute('data-crypt-keys', '');
  section.appendChild(list);
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;opacity:.6;margin:2px 0 6px;';
  hint.textContent =
    'The PGP keys that entries with the crypt tag are encrypted to (org-crypt-key names one by its ID or part of its name or address), and the secret keys that open them. Without a key, an entry is encrypted with a passphrase. Keys stay on this device; export one from gpg with --armor.';
  section.appendChild(hint);

  async function fill() {
    list.textContent = '';
    for (const key of await loadKeyring()) {
      const row = document.createElement('div');
      row.className = 'panel-row';
      row.style.alignItems = 'center';
      const label = document.createElement('div');
      label.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px;';
      label.textContent = `${key.userIds[0] || '(no name)'}  ${key.fingerprint.slice(-16)}${key.privateArmored ? '  · secret key' : ''}`;
      row.appendChild(label);
      row.appendChild(
        menuButton('Remove', async () => {
          if (await confirmDialog(`Remove the key of ${key.userIds[0] || key.fingerprint}?${key.privateArmored ? ' Entries encrypted to it can no longer be opened here.' : ''}`, { confirmLabel: 'Remove' })) {
            await removeKey(key.fingerprint);
            await fill();
          }
        })
      );
      list.appendChild(row);
    }
    if (!list.children.length) {
      const none = document.createElement('div');
      none.style.cssText = 'font-size:13px;opacity:.7;padding:4px 0;';
      none.textContent = 'No keys. Entries are encrypted with a passphrase.';
      list.appendChild(none);
    }
  }
  void fill();

  /** @param {string} text */
  async function add(text) {
    try {
      const read = await importKeys(text);
      setStatus(`Imported ${read.length === 1 ? 'the key of ' + (read[0].userIds[0] || read[0].fingerprint) : read.length + ' keys'}.`);
      await fill();
    } catch (err) {
      setStatus('Key not imported: ' + /** @type {Error} */ (err).message);
    }
  }
  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(menuButton('Paste a key…', () => openTextFieldPopup({ label: 'Paste an ASCII-armored PGP key', value: '', onSave: (/** @type {string} */ text) => add(text) })));
  row.appendChild(
    menuButton('Import a file…', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.asc,.pgp,.txt,text/plain,application/pgp-keys';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (file) await add(await file.text());
      };
      input.click();
    })
  );
  section.appendChild(row);
  return section;
}
