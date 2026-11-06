// @ts-check
/**
 * What the "run code from this document?" answer is remembered against: the parts of a document that can run or change how
 * code runs. Edit a heading or a paragraph and the answer holds; change a source block, a `#+CALL:`, an `eval:` local variable,
 * a `%(form)`, an `#+INCLUDE:` or a header argument and the document is asked about again.
 */

/** The lines of `text` that can run code or change how it runs, in order. @param {string} text */
export function executableLines(text) {
  const lines = text.split('\n');
  /** @type {string[]} */ const out = [];
  let inBlock = false;
  let inLocals = false;
  for (const line of lines) {
    if (/^\s*#\+begin_src\b/i.test(line)) inBlock = true;
    if (/^\s*#\s*local variables:/i.test(line)) inLocals = true;
    if (
      inBlock ||
      (inLocals && /eval\s*:/i.test(line)) ||
      /^\s*#\+(call|header|include|property|setupfile|babel|name)\b/i.test(line) ||
      /\b(call|src)_[\w-]+/i.test(line) ||
      /%\(/.test(line) ||
      /-\*-.*\beval\s*:.*-\*-/i.test(line) ||
      /^\s*:header-args/i.test(line)
    ) out.push(line);
    if (/^\s*#\+end_src\b/i.test(line)) inBlock = false;
    if (/^\s*#\s*end:/i.test(line)) inLocals = false;
  }
  return out;
}

/** A SHA-256 digest of the executable lines. @param {string} text @returns {Promise<string>} */
export async function trustDigest(text) {
  const data = new TextEncoder().encode(executableLines(text).join('\n'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
