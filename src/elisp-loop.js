// @ts-check
/** `cl-loop`: the common clauses (`for`, `with`, `repeat`, `while`, `until`, accumulation, `if`/`unless`, `always`, `never`, `thereis`, `finally`) expanded into plain Lisp. */
import { Cons, NIL, Sym, T, intern, list, signal, toArray } from './elisp-data.js';
import { defSpecial, evalForm } from './elisp-core.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** @param {string} name */
const S = (name) => intern(name);
/** @param {...LObj} xs */
const L = (...xs) => list(xs);
/** @param {string} name */
const fresh = (name) => new Sym(name, false);
/** @param {LObj} x @param {string} word */
const isWord = (x, word) => x instanceof Sym && x.name === word;
const quote = (/** @type {LObj} */ x) => L(S('quote'), x);

/** The Lisp that assigns the parts of `value` to the variables in `pattern`. @param {LObj} pattern @param {LObj} value @returns {LObj[]} */
function assign(pattern, value) {
  if (pattern === NIL) return [];
  if (pattern instanceof Sym) return [L(S('setq'), pattern, value)];
  if (pattern instanceof Cons) {
    const tmp = fresh('--cl-var--');
    return [L(S('let'), L(L(tmp, value)), ...assign(pattern.car, L(S('car'), tmp)), ...assign(pattern.cdr, L(S('cdr'), tmp)))];
  }
  throw signal('error', ['Invalid cl-loop destructuring']);
}
/** @param {LObj} pattern @returns {Sym[]} */
function varsOf(pattern) {
  if (pattern instanceof Sym) return pattern === NIL ? [] : [pattern];
  if (pattern instanceof Cons) return [...varsOf(pattern.car), ...varsOf(pattern.cdr)];
  return [];
}

/** @param {LObj[]} clauses @returns {LObj} */
export function expandLoop(clauses) {
  let i = 0;
  /** @type {LObj} */
  let name = NIL;
  /** @type {LObj[][]} */
  const bindings = [];
  /** @type {LObj[]} */ const initially = [];
  /** @type {LObj[]} */ const prologue = [];
  /** @type {LObj[]} */ const body = [];
  /** @type {LObj[]} */ const steps = [];
  /** @type {LObj[]} */ const finallyForms = [];
  /** @type {LObj | null} */ let finalValue = null;
  const accum = fresh('--cl-var--');
  let accumKind = '';
  /** @type {LObj} */ let accumInit = NIL;
  let accumUsed = false;
  /** @type {LObj} */ let defaultResult = NIL;
  const end = () => L(S('throw'), quote(S('--cl-loop-end--')), NIL);
  const peek = () => clauses[i];
  const next = () => clauses[i++];
  /** @param {LObj} v */
  /** @param {LObj} v @param {LObj} [init] */
  const bind = (v, init = NIL) => { for (const s of varsOf(v)) bindings.push([s, init]); };

  /** One body clause as a form. @returns {LObj} */
  function parseBodyClause() {
    const w = next();
    const word = w instanceof Sym ? w.name : '';
    if (word === 'do' || word === 'doing') {
      const forms = [];
      while (i < clauses.length && clauses[i] instanceof Cons) forms.push(next());
      return L(S('progn'), ...forms);
    }
    if (word === 'if' || word === 'when' || word === 'unless') {
      const cond = next();
      const thenForms = [parseBodyClause()];
      while (isWord(peek(), 'and')) { next(); thenForms.push(parseBodyClause()); }
      /** @type {LObj[]} */ let elseForms = [];
      if (isWord(peek(), 'else')) {
        next();
        elseForms = [parseBodyClause()];
        while (isWord(peek(), 'and')) { next(); elseForms.push(parseBodyClause()); }
      }
      if (isWord(peek(), 'end')) next();
      const test = word === 'unless' ? L(S('not'), cond) : cond;
      return L(S('if'), test, L(S('progn'), ...thenForms), ...elseForms);
    }
    if (word === 'while') return L(S('unless'), next(), end());
    if (word === 'until') return L(S('when'), next(), end());
    if (word === 'always') { defaultResult = T; return L(S('unless'), next(), L(S('cl-return-from'), name, NIL)); }
    if (word === 'never') { defaultResult = T; return L(S('when'), next(), L(S('cl-return-from'), name, NIL)); }
    if (word === 'thereis') { const v = fresh('--cl-var--'); return L(S('let'), L(L(v, next())), L(S('when'), v, L(S('cl-return-from'), name, v))); }
    if (word === 'return') return L(S('cl-return-from'), name, next());
    const kinds = ['collect', 'collecting', 'append', 'appending', 'nconc', 'nconcing', 'concat', 'vconcat', 'sum', 'summing', 'count', 'counting', 'maximize', 'maximizing', 'minimize', 'minimizing'];
    if (kinds.includes(word)) {
      const kind = word.replace(/(ing)$/, '').replace(/^(summ|collect|append|nconc|count|maximiz|minimiz)$/, (m) => ({ summ: 'sum', maximiz: 'maximize', minimiz: 'minimize' }[/** @type {'summ'} */ (m)] ?? m));
      const expr = next();
      /** @type {LObj} */ let target = accum;
      if (isWord(peek(), 'into')) { next(); target = next(); bind(target, kind === 'sum' || kind === 'count' ? 0 : kind === 'concat' ? '' : NIL); } else {
        accumUsed = true;
        accumKind = kind;
        accumInit = kind === 'sum' || kind === 'count' ? 0 : kind === 'concat' ? '' : NIL;
      }
      const into = target !== accum;
      switch (kind) {
        case 'collect': return into ? L(S('setq'), target, L(S('nconc'), target, L(S('list'), expr))) : L(S('push'), expr, accum);
        case 'append': return L(S('setq'), target, L(S('append'), target, expr));
        case 'nconc': return L(S('setq'), target, L(S('nconc'), target, expr));
        case 'concat': return L(S('setq'), target, L(S('concat'), target, expr));
        case 'vconcat': return L(S('setq'), target, L(S('vconcat'), target, expr));
        case 'sum': return L(S('setq'), target, L(S('+'), target, expr));
        case 'count': return L(S('when'), expr, L(S('setq'), target, L(S('1+'), target)));
        case 'maximize': { const v = fresh('--cl-var--'); return L(S('let'), L(L(v, expr)), L(S('setq'), target, L(S('if'), target, L(S('max'), target, v), v))); }
        default: { const v = fresh('--cl-var--'); return L(S('let'), L(L(v, expr)), L(S('setq'), target, L(S('if'), target, L(S('min'), target, v), v))); }
      }
    }
    throw signal('error', [`Unknown cl-loop clause: ${w instanceof Sym ? w.name : '?'}`]);
  }

  /** A `for` / `as` clause. */
  function parseFor() {
    const v = next();
    const w = next();
    const word = w instanceof Sym ? w.name : '';
    if (word === 'in' || word === 'on' || word === 'in-ref') {
      const tail = fresh('--cl-var--');
      bindings.push([tail, next()]);
      bind(v);
      /** @type {LObj} */ let by = L(S('cdr'), tail);
      if (isWord(peek(), 'by')) { next(); by = L(S('funcall'), next(), tail); }
      prologue.push(L(S('unless'), L(S('consp'), tail), end()));
      prologue.push(...assign(v, word === 'on' ? tail : L(S('car'), tail)));
      steps.push(L(S('setq'), tail, by));
      return;
    }
    if (word === 'across') {
      const vec = fresh('--cl-var--');
      const idx = fresh('--cl-var--');
      bindings.push([vec, next()], [idx, -1]);
      bind(v);
      prologue.push(L(S('setq'), idx, L(S('1+'), idx)));
      prologue.push(L(S('unless'), L(S('<'), idx, L(S('length'), vec)), end()));
      prologue.push(...assign(v, L(S('aref'), vec, idx)));
      return;
    }
    if (word === '=') {
      const init = next();
      bind(v);
      if (isWord(peek(), 'then')) {
        next();
        const then = next();
        const first = fresh('--cl-var--');
        bindings.push([first, T]);
        prologue.push(L(S('if'), first, L(S('setq'), first, NIL), L(S('progn'), ...assign(v, then))));
        prologue.push(...assign(v, L(S('if'), L(S('not'), first), v, init)));
        // evaluate the first value once, on the first pass
        prologue.splice(prologue.length - 2, 2,
          L(S('if'), first, L(S('progn'), L(S('setq'), first, NIL), ...assign(v, init)), L(S('progn'), ...assign(v, then))));
      } else prologue.push(...assign(v, init));
      return;
    }
    if (word === 'being') {
      if (isWord(peek(), 'the') || isWord(peek(), 'each')) next();
      const what = /** @type {Sym} */ (next()).name;
      if (isWord(peek(), 'of') || isWord(peek(), 'in')) next();
      const table = next();
      /** @type {LObj} */ let other = NIL;
      if (isWord(peek(), 'using')) { next(); const u = /** @type {Cons} */ (next()); other = toArray(u)[1]; }
      const keys = what.startsWith('hash-key');
      if (!keys && !what.startsWith('hash-value')) throw signal('error', [`Unsupported cl-loop clause: being ${what}`]);
      const tail = fresh('--cl-var--');
      const k = fresh('--cl-var--');
      const val = fresh('--cl-var--');
      bindings.push([tail, L(S('let'), L(L(S('--r--'), NIL)), L(S('maphash'), L(S('lambda'), L(k, val), L(S('push'), L(S('cons'), k, val), S('--r--'))), table), L(S('nreverse'), S('--r--')))]);
      bind(v);
      if (other !== NIL) bind(other);
      prologue.push(L(S('unless'), L(S('consp'), tail), end()));
      prologue.push(...assign(v, L(keys ? S('car') : S('cdr'), L(S('car'), tail))));
      if (other !== NIL) prologue.push(...assign(other, L(keys ? S('cdr') : S('car'), L(S('car'), tail))));
      steps.push(L(S('setq'), tail, L(S('cdr'), tail)));
      return;
    }
    // numeric: from/upfrom/downfrom/to/upto/downto/below/above/by
    let startForm = /** @type {LObj} */ (0);
    /** @type {LObj} */ let limit = NIL;
    let cmp = '';
    /** @type {LObj} */ let by = 1;
    let down = false;
    let w2 = word;
    let first = true;
    for (;;) {
      if (!first) { const p = peek(); if (!(p instanceof Sym)) break; w2 = p.name; if (!['from', 'upfrom', 'downfrom', 'to', 'upto', 'downto', 'below', 'above', 'by'].includes(w2)) break; next(); }
      first = false;
      if (w2 === 'from' || w2 === 'upfrom') startForm = next();
      else if (w2 === 'downfrom') { startForm = next(); down = true; }
      else if (w2 === 'to' || w2 === 'upto') { limit = next(); cmp = down ? '>=' : '<='; }
      else if (w2 === 'downto') { limit = next(); cmp = '>='; down = true; }
      else if (w2 === 'below') { limit = next(); cmp = '<'; }
      else if (w2 === 'above') { limit = next(); cmp = '>'; down = true; }
      else if (w2 === 'by') by = next();
      else throw signal('error', [`Unknown cl-loop for clause: ${word}`]);
    }
    const lim = fresh('--cl-var--');
    const stepv = fresh('--cl-var--');
    bindings.push([v, startForm]);
    if (limit !== NIL) bindings.push([lim, limit]);
    bindings.push([stepv, by]);
    if (limit !== NIL) prologue.push(L(S('unless'), L(S(cmp), v, lim), end()));
    steps.push(L(S('setq'), v, L(down ? S('-') : S('+'), v, stepv)));
  }

  while (i < clauses.length) {
    const w = peek();
    const word = w instanceof Sym ? w.name : '';
    if (word === 'named') { next(); name = next(); } else if (word === 'for' || word === 'as') { next(); parseFor(); while (isWord(peek(), 'and')) { next(); parseFor(); } } else if (word === 'with') {
      next();
      const v = next();
      /** @type {LObj} */ let init = NIL;
      if (isWord(peek(), '=')) { next(); init = next(); }
      bind(v);
      if (init !== NIL) bindings.push([fresh('--cl-var--'), L(S('progn'), ...assign(v, init))]);
    } else if (word === 'repeat') {
      next();
      const n = fresh('--cl-var--');
      bindings.push([n, next()]);
      prologue.push(L(S('if'), L(S('>'), n, 0), L(S('setq'), n, L(S('1-'), n)), end()));
    } else if (word === 'initially') { next(); if (isWord(peek(), 'do')) next(); while (i < clauses.length && clauses[i] instanceof Cons) initially.push(next()); } else if (word === 'finally') {
      next();
      if (isWord(peek(), 'return')) { next(); finalValue = next(); } else {
        if (isWord(peek(), 'do') || isWord(peek(), 'doing')) next();
        while (i < clauses.length && clauses[i] instanceof Cons) finallyForms.push(next());
      }
    } else if (clauses[i] instanceof Cons) body.push(next());
    else body.push(parseBodyClause());
  }
  if (accumUsed) bindings.push([accum, accumInit]);
  let result;
  if (finalValue !== null) result = finalValue;
  else if (accumUsed) result = accumKind === 'collect' ? L(S('nreverse'), accum) : accum;
  else result = defaultResult;
  return L(S('cl-block'), name,
    L(S('let*'), list(bindings.map((b) => (b[1] === NIL ? b[0] : L(b[0], b[1])))),
      ...initially,
      L(S('catch'), quote(S('--cl-loop-end--')), L(S('while'), T, ...prologue, ...body, ...steps)),
      ...finallyForms,
      result));
}

defSpecial('cl-loop', (args, scope) => evalForm(expandLoop(toArray(args)), scope));
