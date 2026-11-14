// @ts-check
/**
 * Org Crypt (Emacs's org-crypt.el): the text of an entry between its properties and the end of its subtree is replaced by an
 * armored PGP message, and put back on decrypting. The cipher is passed in, so the editing is the same whatever encrypts
 * (OpenPGP.js in the app, a stand-in in test/crypt-oracle.test.js, which compares it with Emacs 29.3).
 */
import { parseOrg } from './org-parser.js';
import { searchDocumentsByMatchQuery } from './search.js';

/**
 * What encrypts and decrypts.
 * `listKeys(name)`: the keys whose identity matches `name`, as the strings `encrypt` takes back (no match: an empty array).
 * `encrypt(plain, recipients)`: an armored message for the recipients, or for a passphrase when `recipients` is null.
 * `decrypt(armored)`: the text inside a message.
 * @typedef {{
 *   listKeys: (name: string) => string[],
 *   encrypt: (plain: string, recipients: string[] | null) => Promise<string>,
 *   decrypt: (armored: string) => Promise<string>,
 * }} Cipher
 */

/**
 * What the commands read.
 * `key`: `org-crypt-key` (null: always a passphrase). `matcher`: `org-crypt-tag-matcher`.
 * `reuse`: decrypted text and key -> the message it came from, so text that did not change is not encrypted again.
 * `tagInheritance`: `org-use-tag-inheritance`.
 * @typedef {{ cipher: Cipher, key: string | null, matcher?: string, reuse?: Map<string, string>, tagInheritance?: import('./tag-inheritance.js').TagInheritance, notify?: (message: string) => void }} CryptOptions
 */

const BEGIN = /^[ \t]*-----BEGIN PGP MESSAGE-----$/;
const END = /^[ \t]*-----END PGP MESSAGE-----$/;
const HEADING = /^(\*+) /;
const PLANNING = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const CLOCK = /^[ \t]*CLOCK:/;

/** @param {string} t @param {number} p the start of the line after the one `p` is on */
const nextLine = (t, p) => {
  const i = t.indexOf('\n', p);
  return i < 0 ? t.length : i + 1;
};
/** @param {string} t @param {number} p */
const lineEnd = (t, p) => {
  const i = t.indexOf('\n', p);
  return i < 0 ? t.length : i;
};
/** @param {string} t @param {number} p */
const lineAt = (t, p) => t.slice(p, lineEnd(t, p));

/** The start of the line of every heading, in order. @param {string} t @returns {number[]} */
function headingStarts(t) {
  /** @type {number[]} */ const out = [];
  let p = 0;
  while (p < t.length) {
    if (HEADING.test(lineAt(t, p))) out.push(p);
    p = nextLine(t, p);
  }
  return out;
}

/** The line of the heading that holds `pos`. Throws before the first heading, as org-back-to-heading does. @param {string} t @param {number} pos */
function backToHeading(t, pos) {
  let best = -1;
  for (const s of headingStarts(t)) {
    if (s <= pos) best = s;
    else break;
  }
  if (best < 0) throw new Error('Before first headline');
  return best;
}

/** `org-end-of-meta-data 'standard`: past the planning line, the property drawer, clock lines, blank lines and the logbook drawer.
 *  @param {string} t @param {number} h the start of the heading's line @returns {number} */
function endOfMetaData(t, h) {
  let p = nextLine(t, h);
  if (PLANNING.test(lineAt(t, p))) p = nextLine(t, p);
  if (/^[ \t]*:PROPERTIES:[ \t]*$/.test(lineAt(t, p))) {
    let q = nextLine(t, p);
    while (q < t.length && !/^[ \t]*:END:[ \t]*$/.test(lineAt(t, q)) && /^[ \t]*:\S+:([ \t].*)?[ \t]*$/.test(lineAt(t, q))) q = nextLine(t, q);
    if (q < t.length && /^[ \t]*:END:[ \t]*$/.test(lineAt(t, q))) p = nextLine(t, q);
  }
  if (p < t.length && !HEADING.test(lineAt(t, p))) {
    const heading = headingStarts(t).find((s) => s >= p);
    const limit = heading === undefined ? t.length : heading;
    while (p < t.length) {
      const line = lineAt(t, p);
      if (/^[ \t]*$/.test(line) || CLOCK.test(line)) p = nextLine(t, p);
      else if (/^[ \t]*:LOGBOOK:[ \t]*$/.test(line)) {
        let q = nextLine(t, p);
        let found = -1;
        while (q < limit) {
          if (/^[ \t]*:END:[ \t]*$/.test(lineAt(t, q))) { found = q; break; }
          q = nextLine(t, q);
        }
        if (found < 0) break;
        p = nextLine(t, found);
      } else break;
    }
  }
  return p;
}

/** The end of the subtree of the heading at `h`: the start of the next heading of the same or a higher level. @param {string} t @param {number} h */
function endOfSubtree(t, h) {
  const level = /** @type {RegExpExecArray} */ (HEADING.exec(lineAt(t, h)))[1].length;
  for (const s of headingStarts(t)) {
    if (s <= h) continue;
    if (/** @type {RegExpExecArray} */ (HEADING.exec(lineAt(t, s)))[1].length <= level) return s;
  }
  return t.length;
}

/** `org-back-over-empty-lines`: to the line after the last line that has something on it. @param {string} t @param {number} pos */
function backOverEmptyLines(t, pos) {
  let p = pos;
  while (p > 0 && /[ \t\n\r]/.test(t[p - 1])) p--;
  return Math.min(nextLine(t, p), pos);
}

/**
 * Is the entry at the heading that holds `pos` encrypted? `org-at-encrypted-entry-p`: the message starts right after the
 * properties, and ends after its END line (a heading in between: not a message).
 * @param {string} t @param {number} pos @returns {{ start: number, end: number } | null}
 */
export function encryptedEntryAt(t, pos) {
  let h;
  try {
    h = backToHeading(t, pos);
  } catch {
    return null;
  }
  const start = endOfMetaData(t, h);
  if (start >= t.length || !BEGIN.test(lineAt(t, start))) return null;
  let p = nextLine(t, start);
  while (p < t.length) {
    const line = lineAt(t, p);
    if (END.test(line)) return { start, end: nextLine(t, p) };
    if (HEADING.test(line)) return null;
    p = nextLine(t, p);
  }
  return null;
}

/** The value of a property in the entry's own drawer. @param {string} t @param {number} h @param {string} name @returns {string | null} */
function ownProperty(t, h, name) {
  let p = nextLine(t, h);
  if (PLANNING.test(lineAt(t, p))) p = nextLine(t, p);
  if (!/^[ \t]*:PROPERTIES:[ \t]*$/.test(lineAt(t, p))) return null;
  for (p = nextLine(t, p); p < t.length; p = nextLine(t, p)) {
    const line = lineAt(t, p);
    if (/^[ \t]*:END:[ \t]*$/.test(line)) return null;
    const m = /^[ \t]*:(\S+):(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (m && m[1].toUpperCase() === name.toUpperCase()) return m[2] ?? '';
  }
  return null;
}

/** `org-crypt-key-for-heading`: the recipients (null: a passphrase). @param {string} t @param {number} h @param {CryptOptions} options @returns {string[] | null} */
function keysFor(t, h, options) {
  if (options.key === null) return null;
  const property = ownProperty(t, h, 'CRYPTKEY');
  const name = property === 'nil' ? '' : (property ?? options.key ?? '');
  const keys = options.cipher.listKeys(name);
  if (keys.length) return keys;
  (options.notify || (() => {}))('No crypt key set, using symmetric encryption.');
  return null;
}

/**
 * `org-encrypt-entry`: the text of the entry that holds `pos`, from after its properties to the end of its subtree (the
 * sub-headings with it), becomes a message. Nothing happens when it already is one.
 * @param {string} t @param {number} pos @param {CryptOptions} options @returns {Promise<string>} the new text
 */
export async function encryptEntry(t, pos, options) {
  if (encryptedEntryAt(t, pos)) return t;
  const h = backToHeading(t, pos);
  const recipients = keysFor(t, h, options);
  const beg = endOfMetaData(t, h);
  const end = backOverEmptyLines(t, endOfSubtree(t, h));
  const from = Math.min(beg, end);
  const to = Math.max(beg, end);
  const contents = t.slice(from, to);
  const reuseKey = (recipients ? recipients.join('\n') : '') + '\0' + contents;
  const message = options.reuse?.get(reuseKey) ?? (await options.cipher.encrypt(contents, recipients));
  return t.slice(0, from) + message + t.slice(to);
}

/**
 * `org-decrypt-entry`: the message of the entry that holds `pos` is replaced by the text in it.
 * @param {string} t @param {number} pos @param {CryptOptions} options @returns {Promise<string>} the new text
 */
export async function decryptEntry(t, pos, options) {
  const found = encryptedEntryAt(t, pos);
  if (!found) return t;
  const h = backToHeading(t, pos);
  const message = t.slice(found.start, found.end).replace(/^[ \t]*/gm, ''); // the indentation is not part of the message
  const plain = await options.cipher.decrypt(message);
  if (options.reuse) options.reuse.set((keysFor(t, h, options)?.join('\n') ?? '') + '\0' + plain, message);
  return t.slice(0, found.start) + plain + t.slice(found.end);
}

/** The line of every heading that matches `org-crypt-tag-matcher`, in order. @param {string} t @param {CryptOptions} options @returns {number[]} */
function matchingHeadings(t, options) {
  const doc = parseOrg(t);
  const order = new Map();
  /** @param {import('./types.js').Heading[]} nodes */
  const number = (nodes) => { for (const n of nodes) if (n.type === 'heading') { order.set(n, order.size); number(n.children || []); } };
  number(doc.children);
  const hits = searchDocumentsByMatchQuery([{ documentId: '', doc }], options.matcher || 'crypt', { useTagInheritance: options.tagInheritance ?? true });
  return hits.map((r) => order.get(r.heading)).filter((n) => n !== undefined).sort((a, b) => a - b);
}

/** @param {(t: string, pos: number, options: CryptOptions) => Promise<string>} action @param {string} t @param {CryptOptions} options */
async function scan(action, t, options) {
  let text = t;
  let cursor = 0;
  for (;;) {
    const ordinal = matchingHeadings(text, options).find((n) => n >= cursor);
    if (ordinal === undefined) return text;
    const at = headingStarts(text)[ordinal];
    text = await action(text, at, options);
    cursor = ordinal + 1;
  }
}

/** `org-encrypt-entries`: every entry that matches `org-crypt-tag-matcher`. @param {string} t @param {CryptOptions} options */
export const encryptEntries = (t, options) => scan(encryptEntry, t, options);
/** `org-decrypt-entries`: every entry that matches `org-crypt-tag-matcher`. @param {string} t @param {CryptOptions} options */
export const decryptEntries = (t, options) => scan(decryptEntry, t, options);

/** The start of the line of the heading with this number (counting from 0, in the order of the file), for a command that starts at a heading. @param {string} t @param {number} ordinal @returns {number | null} */
export function headingOffset(t, ordinal) {
  return headingStarts(t)[ordinal] ?? null;
}

/** The number of the heading that holds `pos`, or null before the first heading. @param {string} t @param {number} pos @returns {number | null} */
export function headingOrdinalAt(t, pos) {
  let n = null;
  headingStarts(t).forEach((s, i) => { if (s <= pos) n = i; });
  return n;
}

/** Does `before-save-hook` (as the setting holds it) have `org-encrypt-entries`, as `(org-crypt-use-before-save-magic)` puts it there? @param {string | undefined} hook */
export function encryptsBeforeSave(hook) {
  return /(^|[\s(])org-encrypt-entries([\s)]|$)/.test(hook || '');
}
