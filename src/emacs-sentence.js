// @ts-check
/**
 * Emacs's sentence motion, as Org binds it (`M-a` is `org-backward-sentence`, `M-e` is `org-forward-sentence`): `forward-sentence` and the
 * paragraph commands under it (`forward-paragraph`, `start-of-paragraph-text`, `end-of-paragraph-text`), on the text of a buffer with
 * Org's `paragraph-start` and `paragraph-separate`. Positions are 0-based offsets. Not modeled: the table field motion Org uses inside a table.
 */
import { Buffer, SEPARATOR_RE, elementAt, parseBuffer } from './org-lint-parse.js';
import { tableBeginningOfField, tableEndOfField } from './table-field.js';

/** `paragraph-start` and `paragraph-separate` of Org, which are the same expression, without its anchor. */
const PARA = SEPARATOR_RE.source.replace(/^\^/, '');
const LOOK = new RegExp(PARA, 'imuy');
/** `^[ \t]*\(?:parstart\|parsep\)`, the line `forward-paragraph` searches for. */
const LINE_START = new RegExp(`^[ \\t]*(?:${PARA})`, 'gimu');
const END = '([.?!…‽][\\]"\'”’)}»›]*($|[ \\u00a0]$|\\t|[ \\u00a0][ \\u00a0])|[。．？！]+)[ \\u00a0\\t\\n]*';
/** `(sentence-end)`, and the one `org-forward-sentence` binds: the end of a heading line ends a sentence too. */
const SENTENCE_END = new RegExp(END, 'gmu');
const SENTENCE_END_ORG = new RegExp(`${END}|^\\*+ .*$`, 'gmu');

class Failure extends Error {
  /** @param {string} message @param {number} pos where the caret is left */
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

/** @param {string} t @param {number} p */
const bol = (t, p) => (p <= 0 ? 0 : t.lastIndexOf('\n', p - 1) + 1);
/** @param {string} t @param {number} p */
const eol = (t, p) => {
  const i = t.indexOf('\n', p);
  return i === -1 ? t.length : i;
};
/** `forward-line 1`. @param {string} t @param {number} p */
const nextLine = (t, p) => {
  const e = eol(t, p);
  return e >= t.length ? t.length : e + 1;
};
/** `looking-at` the paragraph expression. @param {string} t @param {number} p */
const lookingAt = (t, p) => {
  LOOK.lastIndex = p;
  return LOOK.test(t);
};

/**
 * `re-search-backward`: the match closest before `from` that starts at `bound` or later and ends by `from`, as [start, end] or null.
 * @param {string} t @param {RegExp} re @param {number} from @param {number} bound
 */
function searchBack(t, re, from, bound) {
  if (bound > from) throw new Failure('Invalid search bound (wrong side of point)', from);
  const flags = re.flags.replace('g', '');
  const head = t.slice(0, from);
  const y = new RegExp(re.source, `${flags}y`);
  for (let s = from; s >= bound; s -= 1) {
    y.lastIndex = s;
    const m = y.exec(head);
    if (!m) continue;
    const end = s + m[0].length;
    // a match that ends where the text was cut must end there in the whole text too
    if (end === from && from < t.length) {
      const exact = new RegExp(`(?:${re.source})(?=[\\s\\S]{${t.length - from}}(?![\\s\\S]))`, `${flags}y`);
      exact.lastIndex = s;
      if (!exact.test(t)) continue;
    }
    return [s, end];
  }
  return null;
}

/**
 * `re-search-forward` with a bound: the first match at `from` or later that ends by `bound` (the text is read as if it ended there, but `$` and the like still see what follows), as [start, end] or null.
 * @param {string} t @param {RegExp} re @param {number} from @param {number} bound
 */
function searchForward(t, re, from, bound) {
  const flags = re.flags.replace('g', '');
  const head = t.slice(0, bound);
  const y = new RegExp(re.source, `${flags}y`);
  for (let s = from; s <= bound; s += 1) {
    y.lastIndex = s;
    const m = y.exec(head);
    if (!m) continue;
    const end = s + m[0].length;
    if (end === bound && bound < t.length) {
      const exact = new RegExp(`(?:${re.source})(?=[\\s\\S]{${t.length - bound}}(?![\\s\\S]))`, `${flags}y`);
      exact.lastIndex = s;
      if (!exact.test(t)) continue;
    }
    return [s, end];
  }
  return null;
}

/** `forward-paragraph`; returns where the caret ends. @param {string} t @param {number} start @param {number} count */
function forwardParagraph(t, start, count) {
  let p = start;
  let arg = count;
  // eslint-disable-next-line no-useless-assignment -- mirrors the Lisp loop
  let startOfFound = 0;
  while (arg < 0 && p > 0) {
    let separated = false;
    if (!lookingAt(t, p) && p >= 1 && t[p - 1] === '\n' && (p === 1 || t[p - 2] === '\n')) {
      p -= 1;
      separated = lookingAt(t, p);
    }
    if (separated) {
      arg += 1;
      continue;
    }
    p = bol(t, p - 1);
    while (p > 0 && lookingAt(t, p)) p = bol(t, p - 1);
    if (p === 0) continue;
    arg += 1;
    p = eol(t, p);
    // eslint-disable-next-line no-useless-assignment -- mirrors the Lisp loop
    let found = false;
    for (;;) {
      const m = searchBack(t, LINE_START, p, 0);
      if (!m) {
        p = 0;
        found = false;
        break;
      }
      found = true;
      startOfFound = m[0];
      p = m[0];
      if (lookingAt(t, p)) break;
      // eslint-disable-next-line no-useless-assignment -- mirrors the Lisp loop
      found = false;
      p = startOfFound;
    }
    if (found) {
      while (p < t.length && lookingAt(t, p)) p = nextLine(t, p);
      // `end-of-line 0`: the end of the line before
      p = p === 0 || bol(t, p) === 0 ? eol(t, p) : eol(t, bol(t, p) - 1);
      if (p - bol(t, p) > 0) p += 1;
      else {
        while (p > 0 && /[ \t]/.test(t[p - 1])) p -= 1;
        if (p !== bol(t, p)) p = nextLine(t, p);
      }
    } else p = 0;
  }
  while (arg > 0 && p < t.length) {
    p = bol(t, p);
    while (p < t.length && lookingAt(t, p)) p = nextLine(t, p);
    if (p < t.length) arg -= 1;
    p = nextLine(t, p);
    let start2 = p;
    for (;;) {
      LINE_START.lastIndex = p;
      const m = LINE_START.exec(t);
      if (!m) {
        p = t.length;
        break;
      }
      start2 = m.index;
      p = start2;
      if (p >= t.length) break;
      if (lookingAt(t, p)) break;
      p += 1;
    }
    if (p < t.length) p = start2;
  }
  return p;
}

/** `start-of-paragraph-text`. @param {string} t @param {number} from */
function startOfParagraphText(t, from) {
  let p = forwardParagraph(t, from, -1);
  const np = p;
  while (p < t.length && /[ \t\n]/.test(t[p])) p += 1;
  if (p >= from && np < from) {
    p = np;
    if (np > 0) return startOfParagraphText(t, np);
  }
  return p;
}

/** `end-of-paragraph-text`. @param {string} t @param {number} from */
function endOfParagraphText(t, from) {
  let p = forwardParagraph(t, from, 1);
  if (t[p - 1] === '\n') p -= 1;
  if (p <= from) {
    if (p >= t.length) throw new Failure('End of buffer', from);
    p += 1;
    if (p < t.length) return endOfParagraphText(t, p);
  }
  return p;
}

/**
 * `forward-sentence` by `count` sentences (backward when negative) on `t`, from `from`.
 * @param {string} t @param {number} from @param {number} count @param {RegExp} end the sentence end
 */
function forwardSentence(t, from, count, end) {
  let p = from;
  let arg = count;
  while (arg < 0) {
    const pos = p;
    const parTextBegin = startOfParagraphText(t, pos);
    const parBegin = bol(t, parTextBegin);
    const first = searchBack(t, end, pos, parBegin);
    let target = null;
    if (first) {
      if (first[1] < pos) target = first[1];
      else {
        const second = searchBack(t, end, first[0], parBegin);
        if (second) target = second[1];
      }
    }
    p = target ?? parTextBegin;
    arg += 1;
  }
  while (arg > 0) {
    let parEnd;
    try {
      parEnd = endOfParagraphText(t, p);
    } catch (err) {
      if (err instanceof Failure) throw new Failure(err.message, p);
      throw err;
    }
    const m = searchForward(t, end, p, parEnd);
    if (m) {
      p = m[1];
      while (p > 0 && /[ \t\n]/.test(t[p - 1])) p -= 1;
    } else p = parEnd;
    arg -= 1;
  }
  return p;
}

/**
 * `org-forward-sentence` (`M-e`) by `n` sentences.
 * @param {string} text @param {number} pos @param {number} n @returns {{ pos: number, text?: string, error?: string }}
 */
export function orgForwardSentence(text, pos, n) {
  let p = pos;
  try {
    const inTable = headingWithText(text, pos) ? null : tableAround(new Buffer(text), pos);
    if (inTable) {
      if (inTable.ce === null) return { pos, error: 'Wrong type argument: number-or-marker-p, nil' };
      if (pos >= inTable.tcb && pos < inTable.ce) return tableMoved(tableEndOfField({ text, pos }, Math.max(1, n)), pos);
    }
    const start = bol(text, p);
    if (/^\*+ /.test(text.slice(start, eol(text, start)))) {
      while (p < text.length && /[ \t]/.test(text[p])) p += 1;
      if (p < eol(text, start)) {
        const stop = eol(text, start);
        try {
          return { pos: start + forwardSentence(text.slice(start, stop), p - start, n, SENTENCE_END) };
        } catch (err) {
          if (err instanceof Failure) throw new Failure(err.message, start + err.pos);
          throw err;
        }
      }
    }
    return { pos: forwardSentence(text, p, n, SENTENCE_END_ORG) };
  } catch (err) {
    if (err instanceof Failure) return { pos: err.pos, error: err.message };
    throw err;
  }
}


/**
 * The table the caret is in, as `org-element-at-point` and its lineage describe it: the table's contents from its first row to the end of
 * its last, and the element at the caret (a row, with its contents after the first bar to the end of the line, or a rule, which has none;
 * the table itself at its first position, on a `#+TBLFM:` line and on the blank lines after it). Null outside an Org table.
 * @param {Buffer} b @param {number} pos
 * @returns {{ tcb: number, tce: number, cb: number | null, ce: number | null } | null}
 */
function tableAround(b, pos) {
  const tree = parseBuffer(b, { todo: ['TODO', 'DONE'], footnoteSection: null });
  let el = elementAt(tree, pos);
  let line = b.lineOf(pos);
  if (!el.type.startsWith('table')) {
    // a #+TBLFM: line and the blank lines after a table are part of it
    let up = line;
    while (up >= 0 && b.blank(up)) up -= 1;
    while (up >= 0 && /^[ \t]*#\+TBLFM:/i.test(b.lines[up])) up -= 1;
    if (up >= 0 && up !== line) {
      const before = elementAt(tree, Math.max(b.pos(up), b.eol(up) - 1));
      if (before.type.startsWith('table')) el = before;
    }
  }
  if (!el.type.startsWith('table')) return null;
  /** @type {import('./org-lint-parse.js').Node} */
  const table = el.type === 'table' ? el : el.parent;
  if (!table || table.type !== 'table' || table.tableType !== 'org') return null;
  const tcb = b.pos(table.cbLine);
  const tce = table.ceLine >= b.lines.length ? b.text.length : b.pos(table.ceLine);
  line = b.lineOf(pos);
  // the first position of the table is the table itself; from there on, each line is a row
  if (line >= table.cbLine && line < table.ceLine && pos !== tcb) {
    const bar = b.pos(line) + b.lines[line].indexOf('|');
    if (/^[ \t]*\|-/.test(b.lines[line])) return { tcb, tce, cb: null, ce: null };
    return { tcb, tce, cb: bar + 1, ce: b.eol(line) };
  }
  return { tcb, tce, cb: tcb, ce: tce };
}

/** A heading with text after the stars, which `M-e` treats as a line of its own. @param {string} text @param {number} pos */
function headingWithText(text, pos) {
  const start = bol(text, pos);
  if (!/^\*+ /.test(text.slice(start, eol(text, start)))) return false;
  let p = pos;
  while (p < text.length && /[ \t]/.test(text[p])) p += 1;
  return p < eol(text, start);
}

/** @param {{ text: string, pos: number, error?: string }} m @param {number} _pos @returns {{ pos: number, text?: string, error?: string }} */
const tableMoved = (m, _pos) => m;

/** The parts of the tree that hold other elements between a first and a last line, such as a drawer. */
const CONTAINERS = new Set(['drawer', 'property-drawer', 'dynamic-block', 'quote-block', 'center-block', 'special-block', 'verse-block']);

/**
 * `org-element-at-point`'s `:contents-begin` and `:contents-end` for what `org-backward-sentence` narrows to: a paragraph's lines, or what
 * lies between the first and last line of a drawer or block. Null for an element without contents, and inside a table.
 * @param {Buffer} b @param {import('./org-lint-parse.js').Node} el @returns {[number, number] | null}
 */
function contentsOf(b, el) {
  if (el.type === 'paragraph') return typeof el.cbPos === 'number' && typeof el.cePos === 'number' ? [el.cbPos, Math.min(b.text.length, el.cePos + 1)] : null;
  if (!CONTAINERS.has(el.type)) return null;
  let last = b.lineOf(Math.max(el.begin, el.end - 1));
  while (last > 0 && b.blank(last)) last -= 1;
  const first = b.lineOf(el.begin) + 1;
  return first < last ? [b.pos(first), b.pos(last)] : null;
}

/**
 * `org-backward-sentence` (`M-a`) by `n` sentences: inside a paragraph or a drawer the search is held to its contents.
 * @param {string} text @param {number} pos @param {number} n @returns {{ pos: number, text?: string, error?: string }}
 */
export function orgBackwardSentence(text, pos, n) {
  try {
    const b = new Buffer(text);
    const tree = parseBuffer(b, { todo: ['TODO', 'DONE'], footnoteSection: null });
    let el = elementAt(tree, pos);
    // a blank line after a paragraph belongs to the paragraph (its post-blank), whatever the tree says
    const line = b.lineOf(pos);
    if (b.blank(line) && !el.type.startsWith('table')) {
      let prev = line - 1;
      while (prev >= 0 && b.blank(prev)) prev -= 1;
      if (prev >= 0) {
        const before = elementAt(tree, Math.max(b.pos(prev), b.eol(prev) - 1));
        if (before.type === 'paragraph') el = before;
      }
    }
    const around = tableAround(b, pos);
    if (around) {
      if (around.cb === null) return { pos, error: 'Wrong type argument: number-or-marker-p, nil' };
      if (pos > around.cb && pos <= around.tce) return tableMoved(tableBeginningOfField({ text, pos }, Math.max(1, n)), pos);
    }
    const inTable = el.type.startsWith('table');
    // past the table's last row (a #+TBLFM: line, blank lines after it) the search is held to the rows
    const range = around && around.ce !== null ? [around.cb ?? around.tcb, around.ce] : inTable ? null : contentsOf(b, el);
    if (range && range[0] > 0 && pos > range[0]) {
      const [begin, stop] = range;
      try {
        return { pos: begin + forwardSentence(text.slice(begin, stop), Math.min(pos, stop) - begin, -n, SENTENCE_END) };
      } catch (err) {
        if (err instanceof Failure) throw new Failure(err.message, begin + err.pos);
        throw err;
      }
    }
    return { pos: forwardSentence(text, pos, -n, SENTENCE_END) };
  } catch (err) {
    if (err instanceof Failure) return { pos: err.pos, error: err.message };
    throw err;
  }
}
