// @ts-check
/** The Lisp reader (`read`, `read-from-string`): text to Lisp objects, with Emacs's syntax errors. */
import { Cons, Flt, NIL, intern, list, signal } from './elisp-data.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

const DELIMS = new Set(['(', ')', '[', ']', '"', "'", ';', '`', ',', '#']);
const isSpace = (/** @type {string} */ c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

const NAMED_CHARS = new Map([['a', 7], ['b', 8], ['t', 9], ['n', 10], ['v', 11], ['f', 12], ['r', 13], ['e', 27], ['s', 32], ['d', 127]]);

/** Reads Lisp objects one at a time from `text`. */
export class Reader {
  /** @param {string} text @param {number} [pos] */
  constructor(text, pos = 0) {
    this.text = text;
    this.pos = pos;
  }

  /** Skips blanks and comments; true while there is more text. */
  more() {
    const t = this.text;
    for (;;) {
      while (this.pos < t.length && isSpace(t[this.pos])) this.pos++;
      if (t[this.pos] === ';') {
        while (this.pos < t.length && t[this.pos] !== '\n') this.pos++;
        continue;
      }
      return this.pos < t.length;
    }
  }

  /** @returns {LObj} */
  read() {
    if (!this.more()) throw signal('end-of-file', []);
    const t = this.text;
    const c = t[this.pos];
    switch (c) {
      case '(':
        this.pos++;
        return this.readList(')');
      case '[': {
        this.pos++;
        const items = [];
        for (;;) {
          if (!this.more()) throw signal('end-of-file', []);
          if (t[this.pos] === ']') {
            this.pos++;
            return items;
          }
          if (t[this.pos] === '.' && (isSpace(t[this.pos + 1] ?? ' ') || DELIMS.has(t[this.pos + 1]))) throw signal('invalid-read-syntax', ['.']);
          items.push(this.read());
        }
      }
      case ')':
        this.pos++;
        throw signal('invalid-read-syntax', [')']);
      case ']':
        this.pos++;
        throw signal('invalid-read-syntax', [']']);
      case "'":
        this.pos++;
        return list([intern('quote'), this.read()]);
      case '`':
        this.pos++;
        return list([intern('`'), this.read()]);
      case ',':
        this.pos++;
        if (t[this.pos] === '@') {
          this.pos++;
          return list([intern(',@'), this.read()]);
        }
        return list([intern(','), this.read()]);
      case '"':
        this.pos++;
        return this.readString();
      case '?': {
        this.pos++;
        const ch = this.readChar();
        const next = t[this.pos];
        if (next !== undefined && !isSpace(next) && !'"\';()[]#?`,.'.includes(next)) throw signal('invalid-read-syntax', ['?']);
        return ch;
      }
      case '#': {
        if (t[this.pos + 1] === "'") {
          this.pos += 2;
          return list([intern('function'), this.read()]);
        }
        if (t[this.pos + 1] === '#') {
          this.pos += 2;
          return intern('');
        }
        if (t[this.pos + 1] === ':') {
          this.pos += 2;
          const name = this.readToken();
          return intern(name.text);
        }
        if (t[this.pos + 1] === '_') {
          this.pos += 2;
          return this.read();
        }
        if (t[this.pos + 1] === '!') {
          while (this.pos < t.length && t[this.pos] !== '\n') this.pos++;
          return this.read();
        }
        const rad = /^#(\d+)r/.exec(t.slice(this.pos, this.pos + 6));
        if (rad) {
          const radix = Number(rad[1]);
          if (radix < 2 || radix > 36) throw signal('invalid-read-syntax', ['integer, radix ' + radix]);
          this.pos += rad[0].length;
          const tok = this.readToken().text;
          if (!tok || ![...tok.replace(/^[-+]/, '')].every((d) => parseInt(d, 36) < radix)) throw signal('invalid-read-syntax', ['integer, radix ' + radix]);
          const big = [...tok.replace(/^[-+]/, '')].reduce((a, d) => a * BigInt(radix) + BigInt(parseInt(d, 36)), 0n);
          const v = tok.startsWith('-') ? -big : big;
          return Number.isSafeInteger(Number(v)) ? Number(v) : v;
        }
        if (/[xXoObB]/.test(t[this.pos + 1] || '')) {
          const radix = { x: 16, o: 8, b: 2 }[/** @type {'x'|'o'|'b'} */ (t[this.pos + 1].toLowerCase())];
          this.pos += 2;
          const tok = this.readToken().text;
          const n = parseInt(tok, radix);
          if (Number.isNaN(n)) throw signal('invalid-read-syntax', ['integer, radix ' + radix]);
          return n;
        }
        throw signal('invalid-read-syntax', ['#']);
      }
      default:
        return this.readAtom();
    }
  }

  /** @param {string} close @returns {LObj} */
  readList(close) {
    const t = this.text;
    /** @type {LObj[]} */
    const items = [];
    /** @type {LObj} */
    let tail = NIL;
    for (;;) {
      if (!this.more()) throw signal('end-of-file', []);
      const c = t[this.pos];
      if (c === close) {
        this.pos++;
        return list(items, tail);
      }
      if (c === '.' && (isSpace(t[this.pos + 1] ?? ' ') || DELIMS.has(t[this.pos + 1]))) {
        if (!items.length) throw signal('invalid-read-syntax', ['.']);
        this.pos++;
        if (!this.more()) throw signal('end-of-file', []);
        if (t[this.pos] === close) throw signal('invalid-read-syntax', [close]);
        tail = this.read();
        if (!this.more()) throw signal('end-of-file', []);
        if (t[this.pos] !== close) throw signal('invalid-read-syntax', ['expected )']);
        this.pos++;
        return list(items, tail);
      }
      if (c === ']' || c === ')') throw signal('invalid-read-syntax', [c]);
      items.push(this.read());
    }
  }

  readString() {
    const t = this.text;
    let out = '';
    for (;;) {
      if (this.pos >= t.length) throw signal('end-of-file', []);
      const c = t[this.pos++];
      if (c === '"') return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = t[this.pos++];
      if (e === '\n' || e === ' ') continue;
      if (e === 's' && t[this.pos] !== '-') { out += ' '; continue; }
      if (e === 'C' && t[this.pos] === '-') {
        this.pos++;
        const base = String(t[this.pos++] ?? '').codePointAt(0) ?? 0;
        out += String.fromCodePoint(base === 63 ? 127 : base & 0x1f);
        continue;
      }
      if (e === '^') {
        const base = String(t[this.pos++] ?? '').codePointAt(0) ?? 0;
        out += String.fromCodePoint(base === 63 ? 127 : base & 0x1f);
        continue;
      }
      if (e === 'x') {
        let h = '';
        while (/[0-9a-fA-F]/.test(t[this.pos] || '')) h += t[this.pos++];
        out += String.fromCodePoint(parseInt(h || '0', 16));
      } else if (e === 'u' || e === 'U') {
        const n = e === 'u' ? 4 : 8;
        out += String.fromCodePoint(parseInt(t.slice(this.pos, this.pos + n), 16));
        this.pos += n;
      } else if (/[0-7]/.test(e)) {
        let o = e;
        while (o.length < 3 && /[0-7]/.test(t[this.pos] || '')) o += t[this.pos++];
        out += String.fromCharCode(parseInt(o, 8));
      } else if (NAMED_CHARS.has(e) && e !== 's' && e !== 'e' && e !== 'd') out += String.fromCharCode(/** @type {number} */ (NAMED_CHARS.get(e)));
      else if (e === 'e') out += '\x1b';
      else if (e === 'd') out += '\x7f';
      else out += e;
    }
  }

  /** The character after a `?`. @returns {number} */
  readChar() {
    const t = this.text;
    if (this.pos >= t.length) throw signal('end-of-file', []);
    let c = String.fromCodePoint(/** @type {number} */ (t.codePointAt(this.pos)));
    this.pos += c.length;
    if (c !== '\\') return /** @type {number} */ (c.codePointAt(0));
    c = t[this.pos++];
    if (c === 'x') {
      let h = '';
      while (/[0-9a-fA-F]/.test(t[this.pos] || '')) h += t[this.pos++];
      return parseInt(h || '0', 16);
    }
    if (c === 'u' || c === 'U') {
      const n = c === 'u' ? 4 : 8;
      const v = parseInt(t.slice(this.pos, this.pos + n), 16);
      this.pos += n;
      return v;
    }
    if (/[0-7]/.test(c)) {
      let o = c;
      while (o.length < 3 && /[0-7]/.test(t[this.pos] || '')) o += t[this.pos++];
      return parseInt(o, 8);
    }
    if (c === 'C' && t[this.pos] === '-') {
      this.pos++;
      const base = /** @type {number} */ (this.readChar());
      return base === 63 ? 127 : base & 0x1f;
    }
    if (c === '^') {
      const base = /** @type {number} */ (this.readChar());
      return base === 63 ? 127 : base & 0x1f;
    }
    if (c === 'M' && t[this.pos] === '-') {
      this.pos++;
      return /** @type {number} */ (this.readChar()) | 0x8000000;
    }
    const named = NAMED_CHARS.get(c);
    return named ?? /** @type {number} */ (c.codePointAt(0));
  }

  /** A run of symbol/number characters, honouring `\` escapes. @returns {{ text: string, escaped: boolean }} */
  readToken() {
    const t = this.text;
    let text = '';
    let escaped = false;
    while (this.pos < t.length) {
      const c = t[this.pos];
      if (isSpace(c) || DELIMS.has(c)) break;
      if (c === '\\') {
        escaped = true;
        this.pos++;
        text += t[this.pos++] ?? '';
        continue;
      }
      text += c;
      this.pos++;
    }
    return { text, escaped };
  }

  /** @returns {LObj} */
  readAtom() {
    const { text, escaped } = this.readToken();
    if (!escaped) {
      if (/^[-+]?\d+\.?$/.test(text)) {
        const digits = text.replace(/\.$/, '').replace(/^\+/, '');
        const n = Number(digits);
        return Number.isSafeInteger(n) ? n : BigInt(digits);
      }
      if (/^[-+]?(\d+\.\d+|\.\d+|\d+(\.\d*)?e[-+]?\d+|\d*\.\d+e[-+]?\d+)$/i.test(text) && /\d/.test(text)) return new Flt(Number(text));
      const special = /^([-+]?)(\d+\.\d+)e\+(INF|NaN)$/.exec(text);
      if (special) {
        if (special[3] === 'INF') return new Flt(special[1] === '-' ? -Infinity : Infinity);
        const nan = new Flt(NaN);
        nan.pos = special[1] !== '-';
        return nan;
      }
    }
    return intern(text);
  }
}

/** Reads the first object of `text`; returns it with the position after it. @param {string} text @param {number} [start] */
export function readFromString(text, start = 0) {
  const r = new Reader(text, start);
  const obj = r.read();
  return { obj, pos: r.pos };
}

/** Reads every top-level form of `text`. @param {string} text */
export function readAll(text) {
  const r = new Reader(text);
  /** @type {LObj[]} */
  const out = [];
  while (r.more()) out.push(r.read());
  return out;
}

export { Cons };
