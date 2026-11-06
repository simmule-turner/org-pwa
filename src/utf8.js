// @ts-check
/**
 * Strict UTF-8 decoding for files read from storage. A file that is not valid UTF-8 (a Latin-1 or Windows-1252 file, say) would
 * decode with U+FFFD in place of its odd bytes, and saving it would write those replacement characters over the original, so
 * it is refused when it is read instead.
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
