// @ts-check
/**
 * The outline's folds, as text: which stretches of an org buffer the app's own fold flags (collapsed, bodyHidden, drawersHidden) hide, and
 * the display text with each hidden stretch drawn as `...`. What a startup value hides is held to Emacs 29.3 (Org 9.6) by
 * test/org-fold-oracle.test.js.
 */

/** A stretch of hidden text: from `a` (the end of a heading's line) up to `b` (the end of the last hidden line), `b` not hidden. @typedef {[number, number]} Range */
/** @typedef {{ start: number, eol: number, level: number, end: number }} TextHeading `end` is where the subtree's hidden text would stop */

/** The headings of the text, each with the end of its subtree. @param {string} text @returns {TextHeading[]} */
export function headings(text) {
  /** @type {TextHeading[]} */
  const found = [];
  const re = /^(\*+) .*$/gm;
  let m;
  while ((m = re.exec(text))) found.push({ start: m.index, eol: m.index + m[0].length, level: m[1].length, end: text.length });
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      if (found[j].level <= found[i].level) {
        found[i].end = found[j].start - 1;
        break;
      }
    }
  }
  return found;
}

/** Hides [a, b) among `hidden`, taking in what it overlaps. @param {Range[]} hidden @param {number} a @param {number} b @returns {Range[]} */
function hide(hidden, a, b) {
  if (b <= a) return hidden;
  let lo = a;
  let hi = b;
  /** @type {Range[]} */
  const out = [];
  for (const [x, y] of hidden) {
    if (y < lo || x > hi) out.push([x, y]);
    else {
      lo = Math.min(lo, x);
      hi = Math.max(hi, y);
    }
  }
  out.push([lo, hi]);
  return out.sort((p, q) => p[0] - q[0]);
}

/** Whether the character at `p` is hidden. @param {Range[]} hidden @param {number} p */
export const isHidden = (hidden, p) => hidden.some(([a, b]) => p >= a && p < b);

/** The drawers' insides: from the end of the line that opens each to the end of its `:END:` line. @param {string} text @returns {Range[]} */
export function drawerRanges(text) {
  /** @type {Range[]} */
  const out = [];
  const lines = text.split('\n');
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^[ \t]*:([A-Za-z0-9_-]+):[ \t]*$/.exec(lines[i]);
    if (open && open[1].toUpperCase() !== 'END') {
      let end = -1;
      let pos = at + lines[i].length + 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\*+ /.test(lines[j])) break;
        if (/^[ \t]*:END:[ \t]*$/i.test(lines[j])) {
          end = pos + lines[j].length;
          break;
        }
        pos += lines[j].length + 1;
      }
      if (end >= 0) out.push([at + lines[i].length, end]);
    }
    at += lines[i].length + 1;
  }
  return out;
}


/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

/** The headings of a parsed document in the order they stand in the text. @param {Doc} doc @returns {Heading[]} */
export function flatHeadings(doc) {
  /** @type {Heading[]} */
  const out = [];
  /** @param {Heading[]} list */
  const walk = (list) => {
    for (const h of list) {
      out.push(h);
      walk(h.children);
    }
  };
  walk(doc.children);
  return out;
}

/**
 * What the outline's folds hide in the text: a collapsed heading hides everything under its line, a heading whose body is hidden hides its
 * own text up to the next heading, and hidden drawers go from the end of the line that opens them to the end of their :END: line.
 * The headings of the document and of the text must be the same list, else nothing is hidden.
 * @param {string} text @param {Doc} doc @returns {Range[]}
 */
export function hiddenRanges(text, doc) {
  const flat = flatHeadings(doc);
  const lines = headings(text);
  if (flat.length !== lines.length) return [];
  const drawers = drawerRanges(text);
  /** @type {Range[]} */
  let hidden = [];
  lines.forEach((h, i) => {
    const f = flat[i];
    if (f.collapsed) {
      if (h.end - h.eol === 1 && h.end === text.length) return; // the newline that ends the buffer is not hidden alone
      hidden = hide(hidden, h.eol, h.end);
      return;
    }
    const next = i + 1 < lines.length ? lines[i + 1].start - 1 : text.length;
    if (f.bodyHidden) {
      if (!(next - h.eol === 1 && next === text.length)) hidden = hide(hidden, h.eol, next);
    } else if (f.drawersHidden) {
      for (const [a, b] of drawers) if (a >= h.eol && b <= next) hidden = hide(hidden, a, b);
    }
  });
  return hidden;
}
/**
 * The reverse of hiddenRanges: gives the headings of `doc` the folds that the hidden stretches of the text amount to, so that what an edit
 * showed or hid is what the next fold command starts from. Drawers keep the flag they had.
 * @param {string} text @param {Doc} doc @param {Range[]} hidden
 */
export function syncFlags(text, doc, hidden) {
  const flat = flatHeadings(doc);
  const lines = headings(text);
  if (flat.length !== lines.length) return;
  /** @param {number} a @param {number} b */
  const covered = (a, b) => b <= a || hidden.some(([x, y]) => x <= a && y >= b);
  lines.forEach((h, i) => {
    const next = i + 1 < lines.length ? lines[i + 1].start - 1 : text.length;
    const lone = (/** @type {number} */ end) => end - h.eol === 1 && end === text.length; // the newline that ends the buffer is not hidden alone
    flat[i].collapsed = h.end > h.eol && !lone(h.end) && covered(h.eol, h.end);
    flat[i].bodyHidden = !flat[i].collapsed && next > h.eol && !lone(next) && covered(h.eol, next);
  });
}

/** Keeps the stretches whose heading line, or drawer line, is still one after an edit: Org lets go of a fold when the heading it hung from stops being one.
 * @param {string} text @param {Range[]} hidden @returns {Range[]} */
export function settleHidden(text, hidden) {
  return hidden.filter(([a]) => {
    const start = a <= 0 ? 0 : text.lastIndexOf('\n', a - 1) + 1;
    const line = text.slice(start, a);
    return /^\*+ /.test(line) || /^[ \t]*:[A-Za-z0-9_-]+:[ \t]*$/.test(line);
  });
}

/** The hidden stretches after an edit: text inserted or removed moves them, and an edit that reaches into one shows it again.
 * @param {Range[]} hidden @param {number} from @param {number} removed how many characters left @param {number} inserted how many came @returns {Range[]} */
export function adjustHidden(hidden, from, removed, inserted) {
  /** @type {Range[]} */
  const out = [];
  const to = from + removed;
  for (const [a, b] of hidden) {
    if (to <= a) out.push([a - removed + inserted, b - removed + inserted]);
    else if (from >= b) out.push([a, b]);
    // any other edit reaches into the stretch: it is shown
  }
  return out;
}

/**
 * What the textarea shows: the text with each hidden stretch drawn as `...`, and how positions pass between that and the buffer.
 * @param {string} text @param {Range[]} hidden
 */
export function foldView(text, hidden, ellipsis = '...') {
  let display = '';
  let at = 0;
  /** @type {Array<{ a: number, b: number, d: number }>} */
  const marks = [];
  for (const [a, b] of hidden) {
    display += text.slice(at, a);
    marks.push({ a, b, d: display.length });
    display += ellipsis;
    at = b;
  }
  display += text.slice(at);
  return {
    display,
    /** The caret's place in the display for a buffer position: hidden text shows its caret after the dots. @param {number} p */
    toDisplay(p) {
      let shift = 0;
      for (const m of marks) {
        if (p <= m.a) break;
        if (p < m.b) return m.d + ellipsis.length;
        shift += m.b - m.a - ellipsis.length;
      }
      return p - shift;
    },
    /** The buffer position for a place in the display: on the dots it is the end of the heading's line. @param {number} d */
    toBuffer(d) {
      let shift = 0;
      for (const m of marks) {
        if (d <= m.d) break;
        if (d < m.d + ellipsis.length) return m.a;
        if (d === m.d + ellipsis.length) return m.b;
        shift += m.b - m.a - ellipsis.length;
      }
      return d + shift;
    },
    marks,
  };
}
