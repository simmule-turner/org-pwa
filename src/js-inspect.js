// @ts-check
/**
 * How Node writes a value, for the parts of Babel that show one the way Emacs does: `util.inspect` on one line (what ob-js
 * wraps around a block's return value) and `console.log`'s `util.format`.  Plain data only (numbers, strings, booleans,
 * null, undefined, arrays, objects): the sandbox turns anything else into those before it gets here.
 *
 * Not reproduced: Node wraps a long array or object over several lines (and groups an array of more than six numbers in
 * columns) in `console.log`; here it always stays on one line.
 */

const ESCAPES = /** @type {Record<string, string>} */ ({ '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '\\': '\\\\' });

/** A string as Node quotes it: single quotes, or double, or backticks when the text has the quote. @param {string} s */
export function quoteString(s) {
  let quote = "'";
  if (s.includes("'")) {
    if (!s.includes('"')) quote = '"';
    else if (!s.includes('`') && !s.includes('${')) quote = '`';
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === quote) out += '\\' + ch;
    else if (ESCAPES[ch]) out += ESCAPES[ch];
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += '\\x' + code.toString(16).toUpperCase().padStart(2, '0');
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      out += ch + s[i + 1];
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) out += '\\u' + code.toString(16).toUpperCase();
    else out += ch;
  }
  return quote + out + quote;
}

/** @param {string} key */
const formatKey = (key) => (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(key) ? key : quoteString(key));

/**
 * `util.inspect(value)` with `compact: true` and an unlimited line width.
 * @param {unknown} value
 * @param {number} [depth] levels shown before `[Object]` / `[Array]` (Node's default is 2)
 * @param {number} [level]
 * @returns {string}
 */
export function inspect(value, depth = 2, level = 0) {
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (value === null || value === undefined || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (level > depth) return '[Array]';
    return '[ ' + value.map((v) => inspect(v, depth, level + 1)).join(', ') + ' ]';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    if (level > depth) return '[Object]';
    const record = /** @type {Record<string, unknown>} */ (value);
    return '{ ' + keys.map((k) => `${formatKey(k)}: ${inspect(record[k], depth, level + 1)}`).join(', ') + ' }';
  }
  return String(value);
}

/**
 * `console.log(...args)`: `util.format`.  A leading string may hold `%s %d %i %f %j %o %O %%`; the other arguments follow after
 * a space, strings as they are and the rest as `util.inspect` shows them.
 * @param {unknown[]} args
 */
export function formatLog(args) {
  if (args.length === 0) return '';
  const rest = args.slice();
  /** @type {string} */ let first;
  const head = rest.shift();
  if (typeof head === 'string') {
    first = head.replace(/%([sdifjoO%])/g, (all, spec) => {
      if (spec === '%') return '%';
      if (rest.length === 0) return all;
      const arg = rest.shift();
      switch (spec) {
        case 's':
          return typeof arg === 'string' ? arg : typeof arg === 'object' && arg !== null ? inspect(arg, 0) : typeof arg === 'number' && Object.is(arg, -0) ? '-0' : String(arg);
        case 'd':
          return typeof arg === 'object' && arg !== null ? 'NaN' : typeof arg === 'number' && Object.is(arg, -0) ? '-0' : String(Number(arg));
        case 'i':
          return typeof arg === 'object' && arg !== null ? 'NaN' : String(Number.parseInt(String(arg), 10));
        case 'f':
          return String(Number.parseFloat(String(arg)));
        case 'j':
          return JSON.stringify(arg);
        default:
          return inspect(arg, spec === 'o' ? 4 : 0);
      }
    });
  } else first = inspect(head);
  return [first, ...rest.map((a) => (typeof a === 'string' ? a : inspect(a)))].join(' ');
}
