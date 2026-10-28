// @ts-check
/**
 * A small reader for Emacs Lisp data, in the shape the features that read the Lisp init expect (see lisp-init.js, which runs the init
 * itself). A value is data: a string, a number, a symbol or a list.
 */

/**
 * @typedef {{ k: 'str', v: string } | { k: 'sym', v: string } | { k: 'num', v: number } | { k: 'list', items: Lisp[], tail?: Lisp }} Lisp
 */

/** The empty list, which is `nil`. @type {Lisp} */
export const NIL = { k: 'list', items: [] };

const STRING_ESCAPES = /** @type {Record<string, string>} */ ({ n: '\n', t: '\t', r: '\r', e: '\x1b', a: '\x07', f: '\f', b: '\b', v: '\v' });

/**
 * Every top-level form in `text`. An unreadable tail (an unbalanced paren) ends the list of forms.
 * @param {string} text
 * @returns {Lisp[]}
 */
export function readLisp(text) {
  let at = 0;
  /** @returns {void} */
  const skipBlank = () => {
    for (;;) {
      while (at < text.length && /\s/.test(text[at])) at++;
      if (text[at] === ';') while (at < text.length && text[at] !== '\n') at++;
      else return;
    }
  };
  /** @returns {Lisp | null} */
  const form = () => {
    skipBlank();
    if (at >= text.length) return null;
    const c = text[at];
    if (c === ')') {
      at++;
      return form(); // a stray closing paren is skipped
    }
    if (c === '(' || c === '[') {
      at++;
      /** @type {Lisp[]} */
      const items = [];
      /** @type {Lisp | undefined} */
      let tail;
      for (;;) {
        skipBlank();
        if (at >= text.length) return { k: 'list', items, ...(tail ? { tail } : {}) };
        if (text[at] === ')' || text[at] === ']') {
          at++;
          return { k: 'list', items, ...(tail ? { tail } : {}) };
        }
        if (text[at] === '.' && /[\s()]/.test(text[at + 1] || ' ')) {
          at++;
          const t = form();
          if (t) tail = t;
          continue;
        }
        const item = form();
        if (!item) return { k: 'list', items, ...(tail ? { tail } : {}) };
        items.push(item);
      }
    }
    if (c === "'" || c === '`' || c === ',') {
      at++;
      if (c === ',' && text[at] === '@') at++;
      const inner = form();
      return inner ? { k: 'list', items: [{ k: 'sym', v: c === "'" ? 'quote' : c === '`' ? 'backquote' : 'comma' }, inner] } : null;
    }
    if (c === '"') {
      at++;
      let s = '';
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\') {
          at++;
          const e = text[at++] || '';
          if (e === '\n') continue; // a backslash before a line break joins the lines
          s += e in STRING_ESCAPES ? STRING_ESCAPES[e] : e;
        } else s += text[at++];
      }
      at++;
      return { k: 'str', v: s };
    }
    if (c === '?') {
      at += 2; // a character literal such as ?a
      return { k: 'num', v: (text.codePointAt(at - 1) || 0) };
    }
    const start = at;
    while (at < text.length && !/[\s()[\]";']/.test(text[at])) {
      if (text[at] === '\\') at++;
      at++;
    }
    const word = text.slice(start, at);
    if (word === '') {
      at++;
      return form();
    }
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(word)) return { k: 'num', v: Number(word) };
    return { k: 'sym', v: word.replace(/\\(.)/g, '$1') };
  };
  /** @type {Lisp[]} */
  const out = [];
  for (;;) {
    const f = form();
    if (!f) return out;
    out.push(f);
  }
}

/** The symbol's name, or null. @param {Lisp | undefined} f */
export const symbolName = (f) => (f && f.k === 'sym' ? f.v : null);

/** The string's text, or null. @param {Lisp | undefined} f */
export const stringValue = (f) => (f && f.k === 'str' ? f.v : null);

/** The items of a proper list (`nil` is empty), or null for anything else. @param {Lisp | undefined} f @returns {Lisp[] | null} */
export function listItems(f) {
  if (!f) return null;
  if (f.k === 'sym' && f.v === 'nil') return [];
  return f.k === 'list' && !f.tail ? f.items : null;
}

/** Is `f` the symbol `nil` or the empty list? @param {Lisp | undefined} f */
export const isNil = (f) => !f || (f.k === 'sym' && f.v === 'nil') || (f.k === 'list' && f.items.length === 0 && !f.tail);

/**
 * The value a form stands for when it is data: a quoted thing as itself, a string or number as itself, `t` and `nil`; `list` of such
 * values. Anything else (a function call, a variable) is null.
 * @param {Lisp} f
 * @returns {Lisp | null}
 */
export function datum(f) {
  if (f.k === 'str' || f.k === 'num') return f;
  if (f.k === 'sym') return f.v === 't' || f.v === 'nil' || f.v.startsWith(':') ? f : null;
  const head = symbolName(f.items[0]);
  if ((head === 'quote' || head === 'backquote') && f.items.length === 2) return f.items[1];
  if (head === 'list') {
    /** @type {Lisp[]} */
    const items = [];
    for (const x of f.items.slice(1)) {
      const d = datum(x);
      if (!d) return null;
      items.push(d);
    }
    return { k: 'list', items };
  }
  if (head === 'cons' && f.items.length === 3) {
    const a = datum(f.items[1]);
    const b = datum(f.items[2]);
    return a && b ? { k: 'list', items: [a], tail: b } : null;
  }
  return null;
}

/** Plays an init text; see lisp-init.js. */
export { runInit } from './lisp-init.js';
