// @ts-check
/**
 * A small reader for Emacs Lisp data, and an interpreter for the few forms people put in an init file to configure an exporter:
 * `(setq VAR VALUE ...)`, `(add-to-list 'VAR VALUE [APPEND])`, `(push VALUE VAR)`, and `progn` / `with-eval-after-load` around them.
 * A value is data (a quoted list, a string, a number, `t`, `nil`); anything that would need Emacs to evaluate it is left out.
 * The settings page keeps such an init text for the LaTeX export (see latex-config.js); nothing here runs code.
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

/** @param {Lisp} a @param {Lisp} b @returns {boolean} */
function same(a, b) {
  if (a.k !== b.k) return false;
  if (a.k === 'list' && b.k === 'list') return a.items.length === b.items.length && a.items.every((x, i) => same(x, b.items[i])) && (a.tail && b.tail ? same(a.tail, b.tail) : !a.tail && !b.tail);
  return /** @type {{ v: unknown }} */ (a).v === /** @type {{ v: unknown }} */ (b).v;
}

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

/** `(append A B ...)` of variables and quoted lists, the one computed value an init text commonly sets (`calendar-holidays`).
 * @param {Lisp} f @param {Map<string, Lisp>} vars @param {(name: string) => string} real @returns {Lisp | null} */
function appended(f, vars, real) {
  if (f.k !== 'list' || symbolName(f.items[0]) !== 'append') return null;
  /** @type {Lisp[]} */
  const items = [];
  for (const a of f.items.slice(1)) {
    const v = a.k === 'sym' && a.v !== 't' && a.v !== 'nil' ? vars.get(real(a.v)) : datum(a) || undefined;
    const l = v === undefined ? null : listItems(v);
    if (!l) return null;
    items.push(...l);
  }
  return { k: 'list', items };
}

/**
 * Plays the configuration forms of an init text on top of `vars` (variable name to value) and returns the result.
 * `setq` replaces a value, `add-to-list` puts a new item first (last with a third argument) unless it is already there, `push` puts it first.
 * @param {string} text
 * @param {Map<string, Lisp>} [initial]
 * @param {Record<string, string>} [aliases]  variables that are another variable under an old name
 * @returns {Map<string, Lisp>}
 */
export function runInit(text, initial, aliases = {}) {
  const vars = new Map(initial || []);
  const real = (/** @type {string} */ name) => aliases[name] || name;
  /** @param {Lisp} f */
  const run = (f) => {
    if (f.k !== 'list' || f.items.length === 0) return;
    const head = symbolName(f.items[0]);
    const args = f.items.slice(1);
    if (head === 'setq') {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const name = symbolName(args[i]);
        const value = datum(args[i + 1]) || appended(args[i + 1], vars, real);
        if (name && value) vars.set(real(name), value);
      }
    } else if (head === 'add-to-list' || head === 'push' || head === 'cl-pushnew') {
      const [varForm, valueForm, append] = head === 'add-to-list' ? [args[0], args[1], args[2]] : [args[1], args[0], undefined];
      const nameForm = head === 'add-to-list' ? datum(varForm || NIL) : varForm;
      const name = real(symbolName(nameForm || undefined) || '');
      const value = valueForm ? datum(valueForm) : null;
      if (name === '' || !value) return;
      const current = listItems(vars.get(name)) || [];
      if (head !== 'push' && current.some((x) => same(x, value))) return;
      vars.set(name, { k: 'list', items: append && !isNil(datum(append) || undefined) ? [...current, value] : [value, ...current] });
    } else if (head === 'progn' || head === 'with-eval-after-load' || head === 'eval-after-load' || head === 'when' || head === 'unless') {
      for (const inner of args.slice(head === 'progn' ? 0 : 1)) run(inner);
    }
  };
  for (const f of readLisp(text)) run(f);
  return vars;
}
