// @ts-check
// `format-spec` of Emacs 29.3 (format-spec.el): `%t`, `%-10t`, `%<5t`, `%^t`, `%%` in a format string, each replaced by the value
// of its letter. An unknown letter is an error, as in Emacs.
import { charWidth } from './elisp-lib.js';

/** The error `format-spec` signals; the message is Emacs's. */
export class FormatSpecError extends Error {}

/** The columns a character takes, and a string. */
const cols = (/** @type {string} */ c) => charWidth(/** @type {number} */ (c.codePointAt(0)));
const width = (/** @type {string} */ s) => [...s].reduce((n, c) => n + cols(c), 0);

/** The first characters of `s` that fit `n` columns (`(format "%.Ns" s)`). @param {string} s @param {number} n */
function take(s, n) {
  let out = '';
  let w = 0;
  for (const c of s) {
    if (w + cols(c) > n) break;
    out += c;
    w += cols(c);
  }
  return out;
}

/** The last characters of `s` that fit `n` columns (`truncate-string-to-width` from the column `width - n`). @param {string} s @param {number} n */
function takeEnd(s, n) {
  let out = '';
  let w = 0;
  for (const c of [...s].reverse()) {
    if (w + cols(c) > n) break;
    out = c + out;
    w += cols(c);
  }
  return out;
}

/**
 * @param {string} str @param {string} flags @param {number | null} wide @param {number | null} trunc
 */
function doFlags(str, flags, wide, trunc) {
  let strWidth = null;
  if (trunc !== null) {
    strWidth = width(str);
    const diff = strWidth - trunc;
    if (diff > 0) {
      str = flags.includes('<') ? takeEnd(str, trunc) : take(str, trunc);
      strWidth = trunc;
    }
  }
  if (wide !== null) {
    strWidth = strWidth ?? width(str);
    const diff = wide - strWidth;
    if (diff > 0) {
      const pad = (flags.includes('0') ? '0' : ' ').repeat(diff);
      str = flags.includes('-') ? str + pad : pad + str;
    } else if (diff < 0) {
      if (flags.includes('<')) str = takeEnd(str, strWidth + diff);
      else if (flags.includes('>')) str = take(str, wide);
    }
  }
  if (flags.includes('^')) return str.toUpperCase();
  if (flags.includes('_')) return str.toLowerCase();
  return str;
}

/**
 * @param {string} format
 * @param {Record<string, string>} specification  letter to its text
 * @returns {string}
 */
export function formatSpec(format, specification) {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const at = format.indexOf('%', i);
    if (at < 0) {
      out += format.slice(i);
      break;
    }
    out += format.slice(i, at);
    if (format[at + 1] === '%') {
      out += '%';
      i = at + 2;
      continue;
    }
    const m = /^([ 0<>^_-]+)?(\d+)?(\.\d+)?(\p{L})/u.exec(format.slice(at + 1));
    if (!m) throw new FormatSpecError('Invalid format string');
    const text = Object.hasOwn(specification, m[4]) ? specification[m[4]] : undefined;
    if (text === undefined) throw new FormatSpecError(`Invalid format character: \`%${m[4]}'`);
    out += doFlags(text, m[1] || '', m[2] ? Number(m[2]) : null, m[3] ? Number(m[3].slice(1)) : null);
    i = at + 1 + m[0].length;
  }
  return out;
}
