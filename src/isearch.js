// @ts-check
/**
 * Emacs's incremental search (isearch) as a pure state machine: C-s and C-r begin and repeat a search, characters and C-w add to the
 * string, DEL goes back one step, M-r and M-c and M-s w change how the string is read, RET leaves point at
 * the match and C-g goes back to where the search began. Held to Emacs 29.3 by test/isearch.test.js.
 */
import { emacsRegexToJs } from './elisp-regex.js';

/** @typedef {{ string: string, pos: number, other: number | null, barrier: number, success: boolean, forward: boolean, wrapped: boolean, regexp: boolean, word: boolean, fold: boolean | null }} Frame */
/** @typedef {{ text: string, origin: number, ring: string[], ringAt: number, regexpRing: string[], regexpRingAt: number, frame: Frame, stack: Frame[], done: boolean, quit: boolean, mark: number | null, error?: string }} ISearch */

/** `search-ring-max` and `regexp-search-ring-max` */
const RING_MAX = 16;

const WORD = '[\\p{L}\\p{N}]';

/** Whether a search for `f` ignores case: unless M-c said otherwise, when the string has no capital letter (a backslash pair in a regexp does not count), as in Emacs.
 *  @param {Frame} f */
export function folds(f) {
  if (f.fold !== null) return f.fold;
  const typed = f.regexp ? f.string.replace(/\\./gs, '') : f.string;
  return typed === typed.toLowerCase();
}

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The expression a frame searches for, or null for none; `invalid` when a regexp is not complete yet (the search then waits, as Emacs does), with what is wrong.
 *  @param {Frame} f @returns {{ re: RegExp | null, invalid: boolean, problem?: string }} */
export function compile(f, lax = true) {
  const flags = 'g' + (folds(f) ? 'i' : '');
  if (f.regexp) {
    if (f.string === '') return { re: null, invalid: false };
    try {
      return { re: emacsRegexToJs(f.string, flags), invalid: false };
    } catch (err) {
      return { re: null, invalid: true, problem: err instanceof Error ? err.message : String(err) };
    }
  }
  if (f.word) {
    const words = f.string.match(new RegExp(WORD + '+', 'gu')) || [];
    if (!words.length) return { re: null, invalid: false };
    const gap = `(?:(?!${WORD})[\\s\\S])+`;
    const lead = new RegExp(`^(?!${WORD})`, 'u').test(f.string) ? gap : `(?<!${WORD})`;
    const tail = new RegExp(`(?<!${WORD})$`, 'u').test(f.string) ? gap : lax ? '' : `(?!${WORD})`;
    return { re: new RegExp(lead + words.map(escape).join(gap) + tail, flags + 'u'), invalid: false };
  }
  if (f.string === '') return { re: null, invalid: false };
  // a run of spaces stands for any run of spaces and tabs (search-whitespace-regexp)
  return { re: new RegExp(f.string.split(/ +/).map(escape).join('[ \\t]+'), flags), invalid: false };
}

/** The match at or after `from` (forward), or the last one ending at or before it (backward), as [start, end].
 *  @param {string} text @param {RegExp} re @param {number} from @param {boolean} forward @returns {[number, number] | null} */
function find(text, re, from, forward) {
  if (forward) {
    const g = new RegExp(re.source, re.flags);
    g.lastIndex = from;
    const m = g.exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  }
  const y = new RegExp(re.source, re.flags.replace('g', '') + 'y');
  const head = text.slice(0, from);
  for (let s = from; s >= 0; s--) {
    y.lastIndex = s;
    const m = y.exec(head);
    if (!m) continue;
    // a match that ends where the text was cut must end there in the whole text too ($, \\b and the like look at what follows)
    if (m.index + m[0].length === from && from < text.length) {
      const exact = new RegExp(`(?:${re.source})(?=[\\s\\S]{${text.length - from}}$)`, re.flags.replace('g', '') + 'y');
      exact.lastIndex = s;
      if (!exact.test(text)) continue;
    }
    return [m.index, m.index + m[0].length];
  }
  return null;
}

/** Searches for the frame's string from `from` and returns the frame it leads to.
 *  @param {string} text @param {Frame} f @param {number} from @returns {Frame} */
function searched(text, f, from) {
  const { re, invalid } = compile(f);
  if (invalid || !re) return { ...f, success: true, pos: from === f.barrier ? f.pos : f.pos, barrier: f.barrier };
  const m = find(text, re, from, f.forward);
  if (!m) return { ...f, success: false };
  return { ...f, success: true, pos: f.forward ? m[1] : m[0], other: f.forward ? m[0] : m[1] };
}

/** Begins a search at `pos`.
 *  @param {string} text @param {number} pos @param {boolean} forward @param {string[]} [ring] earlier search strings, newest first @param {boolean} [regexp]
 *  @param {string[]} [regexpRing] earlier regexp search strings, newest first
 *  @returns {ISearch} */
export function isearchStart(text, pos, forward, ring = [], regexp = false, regexpRing = []) {
  const frame = { string: '', pos, other: null, barrier: pos, success: true, forward, wrapped: false, regexp, word: false, fold: null };
  return { text, origin: pos, ring, ringAt: -1, regexpRing, regexpRingAt: -1, frame, stack: [], done: false, quit: false, mark: null };
}

/** The search's string changes (typed or yanked): the search begins again from where this one did.
 *  @param {ISearch} st @param {Partial<Frame>} change @param {{ ahead?: number }} [how] @returns {ISearch} */
function changed(st, change, how = {}) {
  const next = { ...st.frame, ...change };
  const start = next.barrier + (next.forward ? 0 : how.ahead ?? 0);
  const stack = [...st.stack, st.frame];
  // after a failure only a regexp may succeed again (it may have been incomplete); anything else stays failing until DEL
  if (!st.frame.success && !next.regexp) return { ...st, stack, frame: { ...next, success: false } };
  const moved = searched(st.text, next, Math.min(st.text.length, start));
  return { ...st, stack, frame: moved.success || !next.regexp ? moved : { ...moved, pos: st.frame.pos } };
}

/** M-r, M-c and M-s w change how the string is read without searching again: the search stays where it is, and the next key goes on from there.
 *  @param {ISearch} st @param {Partial<Frame>} change @returns {ISearch} */
function toggled(st, change) {
  return { ...st, frame: { ...st.frame, ...change, success: true } };
}

/** C-s and C-r inside a search.
 *  @param {ISearch} st @param {boolean} forward @returns {ISearch} */
function repeat(st, forward) {
  let { frame } = st;
  const ring = st.frame.regexp ? st.regexpRing : st.ring;
  const stack = [...st.stack, frame];
  if (frame.string === '') {
    if (!ring.length) return { ...st, frame: { ...frame, forward } };
    frame = { ...frame, string: ring[0], forward };
  } else frame = { ...frame, forward };
  /** a repeat of an empty match steps over it, so that it does not stay where it is */
  let from = frame.pos;
  let wrapped = frame.wrapped;
  if (!st.frame.success && forward === st.frame.forward) {
    wrapped = true;
    from = forward ? 0 : st.text.length;
  } else if (frame.other === frame.pos && forward === st.frame.forward && frame.string === st.frame.string) from += forward ? 1 : -1;
  if (from < 0 || from > st.text.length) return { ...st, stack, frame: { ...frame, success: false } };
  const moved = searched(st.text, { ...frame, barrier: from, wrapped }, from);
  return { ...st, stack, frame: moved };
}

/** Where C-w takes its text from, and how far: the rest of the word at point, or one character when point is not at a word. @param {ISearch} st @returns {string} */
function yankText(st) {
  const { text, frame } = st;
  const from = frame.forward || frame.other === null ? frame.pos : frame.other;
  const isWord = (/** @type {number} */ i) => i >= 0 && i < text.length && new RegExp(WORD, 'u').test(text[i]);
  if (!isWord(from) && !isWord(from + 1)) return text.slice(from, from + 1);
  let i = from;
  while (i < text.length && !isWord(i)) i++;
  while (i < text.length && isWord(i)) i++;
  return text.slice(from, i);
}

/** Leaves the search: point stays, and the mark is left where the search began if point moved.
 *  @param {ISearch} st @returns {ISearch} */
function finish(st) {
  const s = st.frame.string;
  const regexp = st.frame.regexp;
  const old = regexp ? st.regexpRing : st.ring;
  // `isearch-update-ring`: the string goes first and an earlier copy of it goes
  const ring = s ? [s, ...old.filter((x) => x !== s)].slice(0, RING_MAX) : old;
  return { ...st, ...(regexp ? { regexpRing: ring } : { ring }), done: true, mark: st.frame.pos !== st.origin ? st.origin : null };
}

/** M-p (`isearch-ring-retreat`) and M-n (`isearch-ring-advance`): the search string becomes an earlier or later one of the ring, and is searched for again from where the search began.
 *  @param {ISearch} st @param {boolean} advance @returns {ISearch} */
function history(st, advance) {
  const regexp = st.frame.regexp;
  const ring = regexp ? st.regexpRing : st.ring;
  if (!ring.length) return st;
  const at = regexp ? st.regexpRingAt : st.ringAt;
  const index = (((at < 0 ? (advance ? 0 : -1) : at) + (advance ? -1 : 1)) % ring.length + ring.length) % ring.length;
  const next = { ...st.frame, string: ring[index] };
  const moved = searched(st.text, next, Math.min(st.text.length, next.barrier));
  const frame = moved.success || !next.regexp ? moved : { ...moved, pos: st.frame.pos };
  return { ...st, ...(regexp ? { regexpRingAt: index } : { ringAt: index }), stack: [...st.stack, st.frame], frame };
}

/**
 * One key of the search. Keys are written as in Emacs: `C-s`, `C-r`, `C-M-s`, `C-M-r`, `DEL`, `RET`, `C-g`, `C-w`, `M-r`, `M-c`, `M-p`, `M-n`, `M-s w`, or one typed character.
 * @param {ISearch} st @param {string} key @returns {ISearch}
 */
export function isearchKey(st, key) {
  if (st.done) return st;
  const f = st.frame;
  switch (key) {
    case 'C-s': return repeat(st, true);
    case 'C-r': return repeat(st, false);
    case 'C-M-s': return repeat({ ...st, frame: { ...f, regexp: true, word: false } }, true);
    case 'C-M-r': return repeat({ ...st, frame: { ...f, regexp: true, word: false } }, false);
    case 'RET': return finish(st);
    case 'DEL': {
      if (!st.stack.length) return st;
      return { ...st, frame: /** @type {Frame} */ (st.stack[st.stack.length - 1]), stack: st.stack.slice(0, -1) };
    }
    case 'C-g': {
      if (f.success) return { ...st, done: true, quit: true, frame: { ...f, pos: st.origin } };
      let { frame, stack } = st;
      while (!frame.success && stack.length) {
        frame = /** @type {Frame} */ (stack[stack.length - 1]);
        stack = stack.slice(0, -1);
      }
      return { ...st, frame, stack };
    }
    case 'M-r': return toggled(st, { regexp: !f.regexp, word: false });
    case 'M-s w': return toggled(st, { word: !f.word, regexp: false });
    case 'M-c': return toggled(st, { fold: !folds(f) });
    case 'M-p': return history(st, false);
    case 'M-n': return history(st, true);
    case 'C-w': {
      const taken = yankText(st);
      if (taken === '') return { ...finish(st), error: 'End of buffer' };
      const yanked = folds(f) ? taken.toLowerCase() : taken;
      return changed(st, { string: f.string + yanked }, { ahead: f.string.length + yanked.length }); // backward, the text taken from after point is searched for over point
    }
    default:
      return key.length === 1 ? changed(st, { string: f.string + key }) : st;
  }
}

/** Runs a list of keys. @param {ISearch} st @param {string[]} keys @returns {ISearch} */
export function isearchKeys(st, keys) {
  return keys.reduce((s, k) => isearchKey(s, k), st);
}

/** Every match of a search string in the text, as [start, end] ranges, for shading them (empty matches are left out).
 *  @param {string} text @param {Frame} f @returns {Array<[number, number]>} */
export function isearchMatches(text, f) {
  const { re } = compile(f);
  if (!re) return [];
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const m of text.matchAll(re)) if (m[0].length > 0) out.push([m.index, m.index + m[0].length]);
  return out;
}
