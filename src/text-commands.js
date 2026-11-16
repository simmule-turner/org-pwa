// @ts-check
/**
 * Org commands that act on the text of a buffer and a position in it, as the Text view has them: `org-beginning-of-line` and
 * `org-end-of-line` (with `org-special-ctrl-a/e`), `org-toggle-heading`, `org-mark-subtree` and `org-next-link`. Positions are
 * 0-based offsets into the text.
 */

/** @typedef {'nil' | 't' | 'reversed'} SpecialCtrlAE */

/** The line a position is on. @param {string} text @param {number} pos @returns {{ start: number, end: number }} */
function lineAt(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return { start, end: nl === -1 ? text.length : nl };
}

/**
 * The parts of a heading line, as org-complex-heading-regexp has them: offsets into the line of the end of the stars, the keyword and the
 * priority, and where the tags start (null when there are none).
 * @param {string} line @param {string[]} keywords
 * @returns {{ stars: number, keyword: number | null, priority: number | null, tags: number | null } | null}
 */
function headingParts(line, keywords) {
  const kw = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const m = new RegExp(`^(\\*+)(?:[ \\t]+(${kw || '(?!)'})(?=[ \\t]|$))?(?:[ \\t]+(\\[#[A-Z0-9]\\])(?=[ \\t]|$))?(?:[ \\t]+(.*?))??(?:[ \\t]+(:[\\w@#%:]+:))?[ \\t]*$`).exec(line);
  if (!m) return null;
  const stars = m[1].length;
  const keyword = m[2] === undefined ? null : line.indexOf(m[2], stars) + m[2].length;
  const priority = m[3] === undefined ? null : line.indexOf(m[3], keyword ?? stars) + m[3].length;
  const tags = m[5] === undefined ? null : line.lastIndexOf(m[5]);
  return { stars, keyword, priority, tags };
}

/** The end of the bullet and checkbox of a list item line, as `org-list-full-item-re` has it; null for any other line. @param {string} line */
function afterBullet(line) {
  const m = /^[ \t]*((?:[-+*]|(?:[0-9]+|[A-Za-z])[.)])(?:[ \t]+|$))(?:\[@(?:start:)?(?:[0-9]+|[A-Za-z])\][ \t]*)?(?:(\[[ X-]\])(?:[ \t]+|$))?/.exec(line);
  if (!m) return null;
  if (m[2] === undefined) return m[0].length - (m[0].length - (/^[ \t]*/.exec(line)?.[0].length ?? 0) - m[1].length);
  const box = line.indexOf(m[2], m[0].length - m[2].length - (/[ \t]*$/.exec(m[0])?.[0].length ?? 0));
  const end = box + m[2].length;
  return line[end] === ' ' ? end + 1 : end;
}

/**
 * org-beginning-of-line: the start of the line, or, on a heading or a list item, the start of its text first. `repeated` is a second
 * press in a row, which matters for `reversed`.
 * @param {string} text @param {number} origin @param {SpecialCtrlAE} special @param {boolean} repeated @param {string[]} keywords
 */
export function orgBeginningOfLine(text, origin, special, repeated, keywords) {
  const { start, end } = lineAt(text, origin);
  if (special === 'nil') return start;
  const line = text.slice(start, end);
  const heading = headingParts(line, keywords);
  if (heading) {
    const ref = start + Math.min(1 + (heading.priority ?? heading.keyword ?? heading.stars), line.length);
    if (special === 'reversed') return origin === start && repeated ? ref : start;
    return origin > ref || origin <= start ? ref : start;
  }
  const bullet = afterBullet(line);
  if (bullet !== null) {
    const ref = start + bullet;
    if (special === 'reversed') return origin === start && repeated ? ref : start;
    return origin > ref || start >= origin ? ref : start;
  }
  return start;
}

/**
 * org-end-of-line: the end of the line, or, on a heading with tags, the end of its title first.
 * @param {string} text @param {number} origin @param {SpecialCtrlAE} special @param {boolean} repeated @param {string[]} keywords
 */
export function orgEndOfLine(text, origin, special, repeated, keywords) {
  const { start, end } = lineAt(text, origin);
  if (special === 'nil') return end;
  const heading = headingParts(text.slice(start, end), keywords);
  if (!heading || heading.tags === null) return end;
  let tags = start + heading.tags;
  while (tags > start && /[ \t]/.test(text[tags - 1])) tags--;
  if (special === 'reversed') return origin === end && repeated ? tags : end;
  return origin < tags || origin >= end ? tags : end;
}

/** org-mark-subtree: the start and end of the subtree the position is in, or null before the first heading. @param {string} text @param {number} pos
 *  @returns {{ start: number, end: number } | null} */
export function markSubtree(text, pos) {
  const lines = text.split('\n');
  let offset = 0;
  /** @type {{ start: number, level: number }[]} */
  const headings = [];
  /** @type {number[]} */
  const starts = [];
  for (const line of lines) {
    starts.push(offset);
    const m = /^(\*+) /.exec(line);
    if (m) headings.push({ start: offset, level: m[1].length });
    offset += line.length + 1;
  }
  const current = [...headings].reverse().find((h) => h.start <= pos);
  if (!current) return null;
  const next = headings.find((h) => h.start > current.start && h.level <= current.level);
  return { start: current.start, end: next ? next.start : text.length };
}

const LINK_TYPES = 'https?|ftp|mailto|file|news|id|info|shell|elisp|doi|man|irc|help|tel|attachment|bbdb|docview|gnus|mhe|rmail|w3m|eww';
const BRACKET = String.raw`\[\[(?:[^\[\]\\]|\\[\[\]]|\\+[^\[\]])+\](?:\[(?:[^\[\]\\]|\\[\[\]]|\\+[^\[\]])+\])?\]`;
const ANGLE = `<(?:${LINK_TYPES}):[^>\\n]*>`;
const PLAIN = String.raw`\b(?:${LINK_TYPES}):[^\[\]\s()<>]+(?:\([\p{L}\p{N}_]+\)|[^\p{P}\s]|/)`;
/** org-link-any-re: a bracket link, an angle link or a plain one, in that order of preference. */
const anyLink = () => new RegExp(`${BRACKET}|${ANGLE}|${PLAIN}`, 'gu');

/** The links that are elements of the text (a plain link inside a bracket link is part of it), skipping comment lines and blocks of code.
 *  @param {string} text @returns {{ begin: number, end: number }[]} */
function linkElements(text) {
  /** @type {boolean[]} */
  const blocked = [];
  let inBlock = false;
  const lines = text.split('\n');
  for (const line of lines) {
    if (/^[ \t]*#\+begin_(src|example|comment|export)/i.test(line)) inBlock = true;
    blocked.push(inBlock || /^[ \t]*#( |$)/.test(line));
    if (/^[ \t]*#\+end_(src|example|comment|export)/i.test(line)) inBlock = false;
  }
  /** @type {{ begin: number, end: number }[]} */
  const found = [];
  let offset = 0;
  lines.forEach((line, i) => {
    if (!blocked[i]) {
      for (const m of line.matchAll(anyLink())) {
        const begin = offset + (m.index ?? 0);
        const end = begin + m[0].length;
        if (!found.some((f) => begin >= f.begin && begin < f.end)) found.push({ begin, end });
      }
    }
    offset += line.length + 1;
  });
  return found;
}

/**
 * org-next-link: where point goes. `wrapped` is a search that failed last time and is repeated: it starts over at the top of the text.
 * Returns the new position and what Emacs says in the echo area.
 * @param {string} text @param {number} point @param {boolean} wrap
 * @returns {{ pos: number, failed: boolean, message: string | null }}
 */
export function nextLink(text, point, wrap) {
  const elements = linkElements(text);
  let from = point;
  let message = null;
  if (wrap) {
    from = 0;
    message = 'Link search wrapped back to beginning of buffer';
  } else {
    const at = anyLink();
    at.lastIndex = point;
    const here = at.exec(text);
    if (here && here.index === point) from = point + here[0].length;
  }
  const search = anyLink();
  search.lastIndex = from;
  for (let m = search.exec(text); m; m = search.exec(text)) {
    const link = elements.find((e) => m.index + m[0].length - 1 >= e.begin && m.index + m[0].length - 1 < e.end);
    if (link) return { pos: link.begin, failed: false, message };
  }
  return { pos: point, failed: true, message: 'No further link found' };
}

/** The text of a list item as the heading Org turns it into: a checkbox becomes a keyword, a `term ::` tag loses its colons. @param {string} text */
function itemToHeadingText(text) {
  let rest = text;
  let keyword = '';
  const box = /^\[([ X-])\](?:[ \t]+|$)/.exec(rest);
  if (box) {
    keyword = box[1] === 'X' ? 'DONE ' : 'TODO ';
    rest = rest.slice(box[0].length);
  }
  const term = /^(.*?)[ \t]+::(?:[ \t]+|$)/.exec(rest);
  if (term) rest = ` ${term[1]} ${rest.slice(term[0].length)}`;
  return keyword + rest;
}

/**
 * org-toggle-heading on the lines from `from` to `to` (0-based line numbers, inclusive; the same line for none): a heading loses its stars, a plain
 * line or a list item becomes a heading one level below the entry it is in. Returns the new text, or null when nothing could change.
 * @param {string} text @param {number} from @param {number} to
 * @returns {string | null}
 */
export function toggleHeading(text, from, to) {
  const lines = text.split('\n');
  let first = from;
  while (first <= to && first < lines.length && /^[ \t]*(#( .*)?)?$/.test(lines[first])) first++;
  if (first > to || first >= lines.length) return null;
  const level = (/** @type {number} */ at) => {
    for (let i = at; i >= 0; i--) {
      const m = /^(\*+) /.exec(lines[i]);
      if (m) return m[1].length;
    }
    return 0;
  };
  const isHeading = (/** @type {string} */ line) => /^\*+ /.test(line);
  const itemOf = (/** @type {string} */ line) => /^([ \t]*)(?:[-+*]|(?:[0-9]+|[A-Za-z])[.)])(?:[ \t]+(.*)|$)/.exec(line);
  const isItem = (/** @type {string} */ line) => !isHeading(line) && itemOf(line) !== null;
  const isComment = (/** @type {string} */ line) => /^[ \t]*#( |$)/.test(line);
  let toggled = false;
  if (isHeading(lines[first])) {
    for (let i = first; i <= to && i < lines.length; i++) {
      if (isHeading(lines[i])) {
        lines[i] = lines[i].replace(/^\*+ /, '');
        toggled = true;
      }
    }
  } else if (isItem(lines[first])) {
    const base = level(first) + 1;
    /** @type {number[]} */
    const indents = [];
    let content = 0; // the columns an item's own lines are indented by
    let cutShort = false;
    /** @type {number | null} */
    let firstIndent = null;
    for (let i = first; i <= to && i < lines.length; i++) {
      const m = isItem(lines[i]) ? itemOf(lines[i]) : null;
      if (!m) {
        if (cutShort) continue;
        lines[i] = lines[i].replace(new RegExp(`^[ \\t]{0,${content}}`), '');
        continue;
      }
      const indent = m[1].length;
      content = lines[i].length - (m[2] ?? '').length;
      if (firstIndent === null) firstIndent = indent;
      cutShort = indent < firstIndent; // the items of a list after the first keep their own lines as they are
      while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
      lines[i] = `${'*'.repeat(base + indents.length)} ${itemToHeadingText(m[2] ?? '')}`;
      indents.push(indent);
      toggled = true;
    }
  } else {
    const stars = '*'.repeat(level(first) + 1);
    for (let i = first; i <= to && i < lines.length; i++) {
      if (!isHeading(lines[i]) && !isItem(lines[i]) && !isComment(lines[i]) && /^[ \t]*\S/.test(lines[i])) {
        lines[i] = `${stars} ${lines[i].replace(/^[ \t]*/, '')}`;
        toggled = true;
      }
    }
  }
  return toggled ? lines.join('\n') : null;
}

/**
 * `org-special-ctrl-a/e`: nil, t, reversed, or a pair `(C-a . C-e)` of those.
 * @param {string | undefined} raw @returns {{ a: SpecialCtrlAE, e: SpecialCtrlAE }}
 */
export function readSpecialCtrlAE(raw) {
  const symbol = (/** @type {string} */ s) => {
    const v = s.trim().replace(/^'/, '');
    return v === 't' ? 't' : v === 'reversed' ? 'reversed' : 'nil';
  };
  if (raw === undefined) return { a: 'nil', e: 'nil' };
  const pair = /^'?\(\s*(\S+)\s+\.\s+(\S+?)\s*\)$/.exec(raw.trim());
  return pair ? { a: symbol(pair[1]), e: symbol(pair[2]) } : { a: symbol(raw), e: symbol(raw) };
}
