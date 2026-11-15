// @ts-check
/**
 * org-fixup-indentation: the lines of one entry (everything under the headline line, up to the next headline) after the headline changed
 * level by `diff` stars, as `org-adapt-indentation` says: the planning line and the property and logbook drawers follow the new level
 * (`t` and `headline-data`), and with `t` the other lines shift by `diff` columns, unless that would change the structure.
 */

const PLANNING_RE = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const DRAWER_START_RE = /^[ \t]*:PROPERTIES:[ \t]*$/i;
const LOGBOOK_START_RE = /^[ \t]*:LOGBOOK:[ \t]*$/i;
const DRAWER_END_RE = /^[ \t]*:END:[ \t]*$/i;
const FOOTNOTE_RE = /^\[fn:[-_\p{L}\p{N}]+\]/iu;
const BLANK_RE = /^[ \t]*$/;
const PROPERTY_RE = /^[ \t]*:(\S+?):(?:[ \t]+(.*?))?[ \t]*$/;

/** @param {string} line */
const indentOf = (line) => /^[ \t]*/.exec(line)?.[0].length ?? 0;
/** @param {string} line @param {number} column */
const indentTo = (line, column) => ' '.repeat(Math.max(0, column)) + line.replace(/^[ \t]*/, '');

/** Where the footnote definition that starts at `i` ends: after two empty lines, or before the next definition. @param {string[]} lines @param {number} i */
function footnoteEnd(lines, i) {
  let j = i + 1;
  while (j < lines.length) {
    if (FOOTNOTE_RE.test(lines[j])) return j;
    if (BLANK_RE.test(lines[j]) && j + 1 < lines.length && BLANK_RE.test(lines[j + 1])) return j + 2;
    j++;
  }
  return lines.length;
}

/** @param {string} line */
const blockStart = (line) => /^[ \t]*#\+BEGIN_(EXAMPLE|SRC)\b/i.exec(line);

/**
 * The index of the line that ends the example or source block that starts at `i` when its indentation is meant to be kept, else -1.
 * @param {string[]} lines @param {number} i @param {boolean} preserveAll `org-src-preserve-indentation`
 */
function preservedBlockEnd(lines, i, preserveAll) {
  const m = blockStart(lines[i]);
  if (!m) return -1;
  const kind = m[1].toUpperCase();
  const preserve = preserveAll || /(?:^|\s)-i(?!\w)/.test(lines[i].replace(/^[ \t]*#\+BEGIN_\w+/i, ''));
  if (!preserve) return -1;
  for (let j = i + 1; j < lines.length; j++) if (new RegExp(`^[ \\t]*#\\+END_${kind}[ \\t]*$`, 'i').test(lines[j])) return j;
  return -1;
}

/** `:KEY:` padded as org-property-format ("%-10s %s") does. @param {string} line */
function alignProperty(line) {
  const m = PROPERTY_RE.exec(line);
  if (!m) return line;
  const key = `:${m[1]}:`;
  return m[2] ? `${key.padEnd(10)} ${m[2]}` : key;
}

/**
 * @param {string[]} lines  the entry's lines under the headline line
 * @param {number} diff  stars gained (positive) or lost (negative)
 * @param {number} level  the headline's level after the change
 * @param {'t' | 'headline-data'} adapt
 * @param {boolean} [preserveAll]  org-src-preserve-indentation
 * @returns {string[]}
 */
export function fixupIndentation(lines, diff, level, adapt, preserveAll = false) {
  const out = [...lines];
  const column = level + 1;
  let i = 0;
  if (i < out.length && PLANNING_RE.test(out[i])) {
    out[i] = indentTo(out[i], column);
    i++;
  }
  if (i < out.length && DRAWER_START_RE.test(out[i])) {
    let end = i + 1;
    while (end < out.length && !DRAWER_END_RE.test(out[end])) end++;
    if (end < out.length) {
      for (let j = i; j <= end; j++) {
        if (BLANK_RE.test(out[j])) continue;
        out[j] = j === i || j === end ? indentTo(out[j], column) : indentTo(alignProperty(out[j]), column);
      }
      i = end + 1;
    }
  }
  if (i < out.length && LOGBOOK_START_RE.test(out[i])) {
    let end = i + 1;
    while (end < out.length && !DRAWER_END_RE.test(out[end])) end++;
    if (end < out.length && indentOf(out[i]) + diff >= 0) {
      for (let j = i; j <= end; j++) out[j] = diff > 0 ? ' '.repeat(diff) + out[j] : out[j].slice(Math.min(-diff, out[j].length));
    }
    if (end < out.length) i = end + 1;
  }
  if (adapt !== 't' || diff === 0) return out;
  if (diff < 0) {
    const need = -diff;
    for (let j = i; j < out.length;) {
      if (BLANK_RE.test(out[j])) j++;
      else if (FOOTNOTE_RE.test(out[j])) j = footnoteEnd(out, j);
      else if (/^\*+ /.test(out[j])) j++;
      else {
        const ind = indentOf(out[j]);
        const rest = out[j].slice(ind);
        if (ind < need || (ind === need && (/^\*+ /.test(rest) || FOOTNOTE_RE.test(rest)))) return out;
        const end = preservedBlockEnd(out, j, preserveAll);
        j = end >= 0 ? end : j + 1;
      }
    }
  }
  for (let j = i; j < out.length;) {
    if (FOOTNOTE_RE.test(out[j])) j = footnoteEnd(out, j);
    else if (/^\*+ /.test(out[j]) || BLANK_RE.test(out[j])) j++;
    else {
      out[j] = indentTo(out[j], indentOf(out[j]) + diff);
      const end = preservedBlockEnd(out, j, preserveAll);
      j = end >= 0 ? end : j + 1;
    }
  }
  return out;
}
