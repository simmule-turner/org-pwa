// @ts-check
/**
 * The text-shaping helpers behind the ASCII exporter, written to give what Emacs gives: `fill-region` with its
 * defaults (the way ox-ascii calls it), `justify-current-line`, and the few string functions ox-ascii and
 * org-element use (`org-element-normalize-string`, `org-ascii--indent-string`, `org-ascii--justify-lines`).
 * test/export-ascii-emacs.test.js holds the exporter to Emacs's own output; the fill rules below were read off
 * Emacs 29.3 itself:
 *   - lines are at most `width` characters, broken only at blanks; one word longer than the line stays whole;
 *   - blanks collapse to one space, except after a sentence end (`.` `?` `!` `…` `‽`, then optional closing
 *     quotes and brackets) when the source had two or more blanks or a line break: that stays two spaces;
 *   - a line never ends in a period that is followed by a single space (Emacs would read it as a sentence end);
 *   - continuation lines start with the "fill prefix" Emacs infers from the paragraph (`> ` quoting, bullets, indentation).
 */

/** A hard newline (`\\` at the end of a line in Org) while the text is still being built; Emacs's is a newline with a property. */
export const HARD = '';

/** Is the code point displayed in two columns (Emacs `string-width`)? @param {number} c */
function isWide(c) {
  return (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) || (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) ||
    (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)
  );
}

/** Columns the text takes up: wide characters count 2, combining marks 0 (Emacs `string-width`). @param {string} s */
export function stringWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if ((c >= 0x300 && c <= 0x36f) || c === 0x200b || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    w += isWide(c) ? 2 : 1;
  }
  return w;
}

/** Ensures `s` ends with a single newline: `org-element-normalize-string`. @param {string} s */
export function normalizeString(s) {
  return s === '' ? '' : s.replace(/(?:\n[ \t]*)*$/, '\n');
}

/** `n` columns of indentation the way Emacs's `indent-to` writes it with tabs: tabs to the last stop, then spaces. @param {number} n */
export function indentTo(n) {
  return n <= 0 ? '' : '\t'.repeat(Math.floor(n / 8)) + ' '.repeat(n % 8);
}

/** Indents every line that has text by `n` spaces (`org-ascii--indent-string`). @param {string} s @param {number} n */
export function indentString(s, n) {
  return n > 0 ? s.replace(/^(?=[ \t]*[^ \t\n])/gm, ' '.repeat(n)) : s;
}

const PREFIX_RE = /^[-–!|#%;>*·•‣⁃◦ \t]*/;
const SENTENCE_END_RE = /[.?!…‽][\]"'”’)}»›]*$/;

/**
 * Fills one paragraph the way `fill-region` does: `lines` are the paragraph's source lines.
 * @param {string[]} lines
 * @param {number} width
 * @returns {string[]}
 */
function fillParagraph(lines, width) {
  if (lines.length === 0) return [];
  const first = lines[0];
  const firstPrefix = (PREFIX_RE.exec(first) || [''])[0];
  /** the prefix the continuation lines get: the second line's own, or blanks as wide as the first line's */
  let prefix;
  if (lines.length > 1) prefix = (PREFIX_RE.exec(lines[1]) || [''])[0];
  else prefix = ' '.repeat(stringWidth(firstPrefix));
  // the text, with the prefix taken off the lines after the first
  const rest = lines.slice(1).map((l) => (prefix && l.startsWith(prefix) ? l.slice(prefix.length) : l));
  const lead = (/^[ \t]*/.exec(first) || [''])[0];
  const text = [first.slice(lead.length), ...rest].join('\n');
  /** @type {{ word: string, gap: string }[]} */
  const tokens = [];
  const re = /([^ \t\n]+)([ \t\n]*)/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ word: m[1], gap: m[2] });
  if (tokens.length === 0) return [];
  // the space written after each word when the line goes on: two after a sentence end the source marked, else one
  const spaceAfter = tokens.map((t, i) => {
    if (i === tokens.length - 1) return '';
    if (SENTENCE_END_RE.test(t.word) && (t.gap.includes('\n') || t.gap.length >= 2)) return '  ';
    return ' ';
  });
  // a line must not end with a period that is followed by one space: Emacs would read it as a sentence end
  const canBreakAfter = tokens.map((t, i) => {
    if (i === tokens.length - 1) return true;
    return !(spaceAfter[i] === ' ' && t.word.endsWith('.'));
  });
  /** @type {string[]} */
  const out = [];
  let start = 0;
  let firstLine = true;
  while (start < tokens.length) {
    const indent = firstLine ? lead : prefix;
    let used = stringWidth(indent) + stringWidth(tokens[start].word);
    let end = start; // last token on the line
    let bestBreak = canBreakAfter[start] ? start : -1;
    for (let i = start + 1; i < tokens.length; i++) {
      const w = used + spaceAfter[i - 1].length + stringWidth(tokens[i].word);
      if (w > width) break;
      used = w;
      end = i;
      if (canBreakAfter[i]) bestBreak = i;
    }
    if (end < tokens.length - 1) {
      // the line is full: break at the last allowed place; if there is none, run on to the first allowed one
      if (bestBreak >= start) end = bestBreak;
      else {
        end = start;
        while (end < tokens.length - 1 && !canBreakAfter[end]) end++;
      }
    }
    let line = indent;
    for (let i = start; i <= end; i++) line += tokens[i].word + (i < end ? spaceAfter[i] : '');
    out.push(line);
    start = end + 1;
    firstLine = false;
  }
  return out;
}

/**
 * `justify-current-line` for one filled line: `center` and `right` indent with tabs and spaces, as Emacs does.
 * @param {string} line @param {number} width @param {'left' | 'center' | 'right' | 'full'} how
 */
function justifyLine(line, width, how) {
  if (how === 'left' || how === 'full') return line;
  const text = line.replace(/^[ \t]+|[ \t]+$/g, '');
  if (!text) return '';
  const room = width - stringWidth(text);
  if (room <= 0) return text;
  return indentTo(how === 'center' ? Math.floor(room / 2) : room) + text;
}

/**
 * `org-ascii--fill-string`: fills `s` to `width`. A hard newline (HARD) ends a paragraph of its own; soft newlines are joined.
 * The text keeps a final newline if it had one.
 * @param {string} s @param {number} width @param {'left' | 'center' | 'right' | 'full'} [how] @param {boolean} [preserveBreaks]
 */
export function fillString(s, width, how = 'left', preserveBreaks = false) {
  if (preserveBreaks) s = s.replace(/\n/g, HARD);
  const trailing = s.endsWith('\n');
  const body = trailing ? s.slice(0, -1) : s;
  const filled = body.split(HARD).map((segment) => {
    const lines = fillParagraph(segment.split('\n'), width).map((l) => justifyLine(l, width, how));
    return lines.join('\n');
  });
  return filled.join('\n') + (trailing ? '\n' : '');
}

/**
 * `org-ascii--justify-lines`: justifies each line of `s` on its own, with spaces (never tabs).
 * @param {string} s @param {number} width @param {'left' | 'center' | 'right'} how
 */
export function justifyLines(s, width, how) {
  return s
    .split('\n')
    .map((line) => {
      if (how === 'left') return line;
      const text = line.replace(/^[ \t]+|[ \t]+$/g, '');
      if (!text) return '';
      const room = width - stringWidth(text);
      if (room <= 0) return text;
      return ' '.repeat(how === 'center' ? Math.floor(room / 2) : room) + text;
    })
    .join('\n');
}

/**
 * `org-ascii--justify-element` for anything that is not a paragraph: the lines move as a block, by the widest line.
 * @param {string} contents @param {number} width @param {'left' | 'center' | 'right' | 'full'} how
 */
export function justifyBlock(contents, width, how) {
  if (!/\S/.test(contents) || how === 'left' || how === 'full') return contents;
  let max = 0;
  for (const line of contents.split('\n')) {
    if (!/\S/.test(line)) continue;
    const w = stringWidth(line.replace(/\t/g, '        '));
    if (w >= width) return contents;
    if (w > max) max = w;
  }
  const offset = Math.floor((width - max) / (how === 'right' ? 1 : 2));
  if (offset === 0) return contents;
  return contents
    .split('\n')
    .map((line) => (/\S/.test(line) ? indentTo(offset) + line : line))
    .join('\n');
}
