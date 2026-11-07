// @ts-check
/**
 * UTF-8 decoding for files read from storage. A file that is not valid UTF-8 (a Latin-1 or Windows-1252 file, say) decodes with
 * U+FFFD in place of its odd bytes, and saving it would write those replacement characters over the original. So such a file
 * is opened read-only, its original bytes are kept here, and a save of it is refused until the person converts it: the bytes
 * are decoded again with the encoding they name, and the next save writes UTF-8.
 */

/** @param {string} name  the file's name, for the message */
export function notUtf8Error(name) {
  return new Error(`"${name}" is not valid UTF-8, so it was not opened: saving it would damage the file. Convert it to UTF-8 and open it again.`);
}

/** Decodes `bytes` as UTF-8 (a leading byte-order mark is dropped, as before) or throws for a file that is not valid UTF-8.
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {string} [name]  the file's name, for the message */
export function decodeUtf8Strict(bytes, name = 'This file') {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw notUtf8Error(name);
  }
}

/** @typedef {{ bytes: Uint8Array, converted: boolean }} NonUtf8Entry */
/** The files read in this session that were not valid UTF-8, by file id, with their original bytes. */
const nonUtf8 = new Map();

export const NOT_UTF8_STATUS = 'Not valid UTF-8: opened read-only so it is not damaged.';

/** Encodings offered by Convert to UTF-8 (TextDecoder labels); any other label the browser knows can be typed too. */
export const ENCODING_CHOICES = [
  { label: 'windows-1252', text: 'Latin-1 / windows-1252' },
  { label: 'utf-16le', text: 'UTF-16 (little-endian)' },
  { label: 'utf-16be', text: 'UTF-16 (big-endian)' },
  { label: 'iso-8859-15', text: 'Latin-9 (iso-8859-15)' },
  { label: 'windows-1251', text: 'Cyrillic (windows-1251)' },
  { label: 'shift_jis', text: 'Japanese (Shift_JIS)' },
];

/** @param {ArrayBufferLike | Uint8Array} bytes */
function toBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** The text of a file read from storage. Valid UTF-8 is decoded as it is (a leading byte-order mark is dropped). Anything else is
 * decoded with U+FFFD for the bytes that are not UTF-8, and the file is remembered as read-only until it is converted.
 * @param {ArrayBufferLike | Uint8Array} bytes
 * @param {string} [id]  the file's id, as the adapter knows it */
export function decodeText(bytes, id = '') {
  const raw = toBytes(bytes);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    nonUtf8.delete(id);
    return text;
  } catch {
    const before = nonUtf8.get(id);
    const same = !!before && before.bytes.length === raw.length && before.bytes.every((/** @type {number} */ b, /** @type {number} */ i) => b === raw[i]);
    nonUtf8.set(id, { bytes: raw.slice(), converted: same && !!before && before.converted });
    return new TextDecoder('utf-8').decode(raw);
  }
}

/** Whether this file was not valid UTF-8 and has not been converted: it must not be saved.
 * @param {string | null | undefined} id */
export function isNonUtf8(id) {
  const entry = id ? nonUtf8.get(id) : undefined;
  return !!entry && !entry.converted;
}

/** The files whose "not valid UTF-8" banner was dismissed since they were last opened. */
const dismissedBanners = new Set();

/**
 * Whether the "Convert to UTF-8" banner shows: for a file that is not valid UTF-8 and has not been converted, until it is dismissed.
 * @param {{ documentId: string | null | undefined, notUtf8: boolean, dismissed: ReadonlySet<string> }} state
 */
export function nonUtf8BannerVisible({ documentId, notUtf8, dismissed }) {
  return !!documentId && notUtf8 && !dismissed.has(documentId);
}

/** @param {string | null | undefined} id */
export function shouldShowNonUtf8Banner(id) {
  return nonUtf8BannerVisible({ documentId: id, notUtf8: isNonUtf8(id), dismissed: dismissedBanners });
}

/** The banner is hidden for this file until it is opened again. @param {string} id */
export function dismissNonUtf8Banner(id) {
  dismissedBanners.add(id);
}

/** The file was opened (again): its banner can show. @param {string | null | undefined} id */
export function reopenNonUtf8Banner(id) {
  if (id) dismissedBanners.delete(id);
}

/** Throws if a save of this file would write the U+FFFD text over its original bytes.
 * @param {string} id */
export function refuseNonUtf8Write(id) {
  if (isNonUtf8(id)) {
    throw new Error(`"${id}" is not valid UTF-8 and is open read-only, so it was not saved. Use Convert to UTF-8\u2026 to edit it.`);
  }
}

/** A save went through: the file on storage is UTF-8 now.
 * @param {string} id */
export function forgetNonUtf8(id) {
  nonUtf8.delete(id);
}

/** The original bytes of a file waiting to be converted, decoded with `label` (nothing changes). Throws for a label the browser does
 * not know, or a file that is not waiting to be converted.
 * @param {string} id
 * @param {string} label  a TextDecoder label such as `windows-1252` or `utf-16le` */
export function decodeNonUtf8(id, label) {
  const entry = nonUtf8.get(id);
  if (!entry || entry.converted) throw new Error(`"${id}" is not waiting to be converted.`);
  let decoder;
  try {
    decoder = new TextDecoder(label.trim());
  } catch {
    throw new Error(`"${label}" is not an encoding this browser knows. Try windows-1252, utf-16le or shift_jis.`);
  }
  return decoder.decode(entry.bytes);
}

/** The file may be saved now (as UTF-8). @param {string} id */
export function markConverted(id) {
  const entry = nonUtf8.get(id);
  if (entry) entry.converted = true;
}

/** `decodeNonUtf8`, and the file made writable. @param {string} id @param {string} label */
export function convertNonUtf8(id, label) {
  const text = decodeNonUtf8(id, label);
  markConverted(id);
  return text;
}
