// @ts-check
/**
 * OpenPGP for org-crypt: reads keys, finds keys by name the way `gpg --list-keys NAME` does, and builds the cipher org-crypt.js
 * takes. Messages are ASCII armor, the same as `gpg --armor` writes, so entries encrypted here open in Emacs (and with gpg)
 * and the other way round. OpenPGP.js (src/vendor/openpgp, LGPL) is loaded when the first message or key is read.
 */

/** A key in the keyring. `privateArmored` is there when the secret key was imported too. @typedef {{ fingerprint: string, userIds: string[], publicArmored: string, privateArmored?: string }} KeyInfo */

/** @type {Promise<any> | null} */
let library = null;
/** The OpenPGP.js module, loaded on first use. */
export function openPgp() {
  if (!library) library = import('./vendor/openpgp/openpgp.min.mjs');
  return library;
}

/**
 * The keys in an armored block (several keys may follow each other), each with its secret part when the block has it.
 * @param {string} armored @returns {Promise<KeyInfo[]>}
 */
export async function readKeyBlock(armored) {
  const pgp = await openPgp();
  /** @type {KeyInfo[]} */ const out = [];
  const blocks = armored.match(/-----BEGIN PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----[\s\S]*?-----END PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----/g) || [];
  if (!blocks.length) throw new Error('No PGP key found in the text');
  for (const block of blocks) {
    const isPrivate = /BEGIN PGP PRIVATE/.test(block);
    const keys = await pgp.readKeys({ armoredKeys: block });
    for (const key of keys) {
      const publicKey = isPrivate ? key.toPublic() : key;
      out.push({
        fingerprint: key.getFingerprint().toUpperCase(),
        userIds: key.getUserIDs(),
        publicArmored: publicKey.armor(),
        ...(isPrivate ? { privateArmored: key.armor() } : {}),
      });
    }
  }
  return out;
}

/** Adds the keys of `incoming` to `ring`: a key already there is kept, with the secret part added when it comes now. @param {KeyInfo[]} ring @param {KeyInfo[]} incoming @returns {KeyInfo[]} */
export function mergeKeys(ring, incoming) {
  const out = ring.map((k) => ({ ...k }));
  for (const k of incoming) {
    const have = out.find((o) => o.fingerprint === k.fingerprint);
    if (!have) out.push({ ...k });
    else if (k.privateArmored && !have.privateArmored) have.privateArmored = k.privateArmored;
  }
  return out;
}

/**
 * Does the key match `name`, as `gpg --list-keys NAME` reads it? A key ID or fingerprint (`0x` and hex, 8 digits or more, the
 * end of the fingerprint), `=` and the whole user ID, `<` and an address, `@` and a domain, or else part of a user ID. Capitals do not matter.
 * @param {KeyInfo} key @param {string} name
 */
export function keyMatches(key, name) {
  const n = name.trim();
  if (!n) return false;
  const hex = /^(?:0x)?([0-9a-f]{8,40})$/i.exec(n.replace(/\s+/g, ''));
  if (hex && key.fingerprint.endsWith(hex[1].toUpperCase())) return true;
  const lower = n.toLowerCase();
  const ids = key.userIds.map((u) => u.toLowerCase());
  if (lower.startsWith('=')) return ids.includes(lower.slice(1));
  if (lower.startsWith('<') && lower.endsWith('>')) return ids.some((u) => u.endsWith(lower));
  if (lower.startsWith('@')) return ids.some((u) => u.replace(/>$/, '').endsWith(lower));
  return ids.some((u) => u.includes(lower));
}

/**
 * What the cipher asks the person for.
 * `kind`: 'new' (a passphrase to encrypt with), 'message' (the passphrase of a message), 'key' (the passphrase of a secret key, named in `label`).
 * `retry`: the last one was wrong.
 * @typedef {{ kind: 'new' | 'message' | 'key', label?: string, retry?: boolean }} PassphraseRequest
 */

/**
 * The cipher org-crypt.js takes.
 * @param {{ keyring: () => KeyInfo[], askPassphrase: (request: PassphraseRequest) => Promise<string> }} io
 * @returns {import('./org-crypt.js').Cipher}
 */
export function makePgpCipher(io) {
  return {
    listKeys: (name) => io.keyring().filter((k) => keyMatches(k, name)).map((k) => k.fingerprint),

    async encrypt(plain, recipients) {
      const pgp = await openPgp();
      const message = await pgp.createMessage({ text: plain });
      if (!recipients) {
        const passphrase = await io.askPassphrase({ kind: 'new' });
        return /** @type {string} */ (await pgp.encrypt({ message, passwords: [passphrase], format: 'armored' }));
      }
      const encryptionKeys = [];
      for (const fingerprint of recipients) {
        const key = io.keyring().find((k) => k.fingerprint === fingerprint);
        if (key) encryptionKeys.push(await pgp.readKey({ armoredKey: key.publicArmored }));
      }
      return /** @type {string} */ (await pgp.encrypt({ message, encryptionKeys, format: 'armored' }));
    },

    async decrypt(armored) {
      const pgp = await openPgp();
      const message = await pgp.readMessage({ armoredMessage: armored });
      const wanted = message.getEncryptionKeyIDs().map((/** @type {{ toHex: () => string }} */ id) => id.toHex());
      const symmetric = message.packets.filterByTag(pgp.enums.packet.symEncryptedSessionKey).length > 0;
      /** The secret keys of the ring that fit the message. */
      const mine = [];
      for (const k of io.keyring()) {
        if (!k.privateArmored) continue;
        const key = await pgp.readPrivateKey({ armoredKey: k.privateArmored });
        if (key.getKeyIDs().some((/** @type {{ toHex: () => string }} */ id) => wanted.includes(id.toHex()))) mine.push({ info: k, key });
      }
      if (mine.length) {
        const keys = [];
        for (const { info, key } of mine) keys.push(await unlockKey(pgp, key, info, io));
        const out = await pgp.decrypt({ message, decryptionKeys: keys, format: 'utf8' });
        return /** @type {string} */ (out.data);
      }
      if (!symmetric) throw new Error('No secret key for this message');
      for (let attempt = 0; attempt < 3; attempt++) {
        const passphrase = await io.askPassphrase({ kind: 'message', retry: attempt > 0 });
        try {
          const out = await pgp.decrypt({ message, passwords: [passphrase], format: 'utf8' });
          return /** @type {string} */ (out.data);
        } catch (err) {
          if (attempt === 2) throw new Error('Bad passphrase');
        }
      }
      throw new Error('Bad passphrase');
    },
  };
}

/** A secret key ready to decrypt with: asks for its passphrase (three tries) when it has one. @param {Awaited<ReturnType<typeof openPgp>>} pgp @param {{ isDecrypted: () => boolean }} key @param {KeyInfo} info @param {{ askPassphrase: (r: PassphraseRequest) => Promise<string> }} io */
async function unlockKey(pgp, key, info, io) {
  if (key.isDecrypted()) return key;
  const label = info.userIds[0] || info.fingerprint;
  for (let attempt = 0; attempt < 3; attempt++) {
    const passphrase = await io.askPassphrase({ kind: 'key', label, retry: attempt > 0 });
    try {
      return await pgp.decryptKey({ privateKey: key, passphrase });
    } catch {
      // asked again
    }
  }
  throw new Error('Bad passphrase');
}
