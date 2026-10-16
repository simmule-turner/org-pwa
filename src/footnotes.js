// Footnote commands, ported from Emacs 29.3's org-footnote.el: org-footnote-new inserts a reference (and, unless the
// definition is inline, starts its definition in the footnote section), and org-footnote-normalize turns every
// footnote into a numbered one with its definition in that section. Pure text in, text out; the browser side only
// supplies the text, the cursor and the label the person typed.
//
// A "footnote" here follows Org's syntax: [fn:label] (reference), [fn:label:text] or [fn::text] (inline), and a
// definition [fn:label] at the start of a line, which runs to the next definition or heading, or to two blank
// lines. References inside source/example/export/comment blocks, comments, fixed-width lines, keyword lines,
// property drawers, LaTeX environments, links and verbatim/code spans are not footnotes.

import { matchLatexFragmentAt } from './inline-markup.js';

const WORD = '[-_\\p{L}\\p{N}]';
const DEF_LINE_RE = new RegExp(`^\\[fn:(${WORD}+)\\]`, 'u');
const REF_START_RE = new RegExp(`\\[fn:(?:(${WORD}+)?(:)|(${WORD}+)\\])`, 'uy');
const FORBIDDEN_BLOCKS = new Set(['comment', 'example', 'export', 'src']);

/**
 * @typedef {{ section: string | null, defineInline: boolean }} FootnoteOptions
 * @typedef {{ label: string | null, begin: number, end: number, inline: boolean, contentsBegin: number, contentsEnd: number, top: boolean }} FootnoteRef
 */

/** @type {FootnoteOptions} */
export const footnoteDefaults = { section: 'Footnotes', defineInline: false };

// ---- a text with positions that follow edits (the markers of Emacs) ---------------------------------------------

class Buf {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    /** @type {{ at: number }[]} */
    this.marks = [];
  }

  /** @param {number} at */
  mark(at) {
    const m = { at };
    this.marks.push(m);
    return m;
  }

  /** Replaces [a, b) with `str`; a position at `a` stays, one inside the removed text moves to `a`, later ones shift.
   * @param {number} a @param {number} b @param {string} str */
  replace(a, b, str) {
    this.text = this.text.slice(0, a) + str + this.text.slice(b);
    const delta = str.length - (b - a);
    for (const m of this.marks) {
      if (m.at >= b) m.at += delta;
      else if (m.at > a) m.at = a;
    }
  }

  /** @param {number} at @param {string} str */
  insert(at, str) {
    this.replace(at, at, str);
  }
}

// ---- where footnotes may be ----------------------------------------------------------------------------------------

/** A property drawer belongs right after a heading (and its planning line), or at the top of the file.
 * @param {string[]} lines @param {number} i */
function propertyDrawerAllowed(lines, i) {
  let k = i - 1;
  if (k >= 0 && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[k])) k--;
  return k < 0 || /^\*+ /.test(lines[k]);
}

/** For each character, whether a footnote may not start there (protected lines, links, verbatim and code spans).
 * @param {string} text @returns {{ blocked: Uint8Array, lineStarts: number[], protectedLine: boolean[] }} */
function analyze(text) {
  const lines = text.split('\n');
  const lineStarts = [];
  const protectedLine = [];
  let offset = 0;
  /** @type {string | null} */
  let block = null;
  let blockForbidden = false;
  /** @type {string | null} */
  let latexEnv = null;
  let propertyDrawer = false;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
    let prot = false;
    let m;
    if (block !== null) {
      prot = blockForbidden;
      const end = /^[ \t]*#\+end_(\S+)/i.exec(line);
      if (end && end[1].toLowerCase() === block) block = null;
    } else if ((m = /^[ \t]*#\+begin_(\S+)/i.exec(line))) {
      block = m[1].toLowerCase();
      blockForbidden = FORBIDDEN_BLOCKS.has(block);
      prot = blockForbidden;
    } else if (latexEnv !== null) {
      prot = true;
      if (line.includes('\\end{' + latexEnv + '}')) latexEnv = null;
    } else if ((m = /^[ \t]*\\begin\{([A-Za-z0-9*]+)\}/.exec(line))) {
      prot = true;
      if (!line.includes('\\end{' + m[1] + '}')) latexEnv = m[1];
    } else if (propertyDrawer) {
      prot = true;
      if (/^[ \t]*:END:[ \t]*$/i.test(line)) propertyDrawer = false;
    } else if (/^[ \t]*:PROPERTIES:[ \t]*$/i.test(line) && propertyDrawerAllowed(lines, protectedLine.length)) {
      prot = true;
      propertyDrawer = true;
    } else if (/^[ \t]*#(?: |$)/.test(line) || /^[ \t]*:(?: |$)/.test(line) || /^[ \t]*#\+[A-Za-z_]+(?:\[[^\]]*\])?:/.test(line)) {
      prot = true;
    }
    protectedLine.push(prot);
  }
  const blocked = new Uint8Array(text.length + 1);
  for (let i = 0; i < lines.length; i++) {
    const start = lineStarts[i];
    const line = lines[i];
    if (protectedLine[i]) {
      blocked.fill(1, start, start + line.length + 1);
      continue;
    }
    for (const link of line.matchAll(/\[\[(?:[^[\]\\]|\\.)+\](?:\[.+?\])?\]/g)) blocked.fill(1, start + link.index, start + link.index + link[0].length);
    for (const obj of line.matchAll(/<\d{4}-\d{2}-\d{2}[^>\n]*>|\[\d{4}-\d{2}-\d{2}[^\]\n]*\]|\{\{\{.*?\}\}\}|\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Omega|to|rightarrow|leftarrow|ge|le|ne|pm|times|deg|nbsp|ldots|dots|copy|rarr|larr|infty|sum|int)(?![A-Za-z])/g)) blocked.fill(1, start + obj.index, start + obj.index + obj[0].length);
    for (let k = 0; k < line.length; k++) {
      if (line[k] !== '$' && line[k] !== '\\') continue;
      const frag = matchLatexFragmentAt(text, start + k);
      if (frag && frag.length > 1) {
        blocked.fill(1, start + k, start + k + frag.length);
        k += frag.length - 1;
      }
    }
    for (const span of line.matchAll(/(^|[\s\-({'"])([=~])(?!\s)(.+?)(?<!\s)\2(?=$|[\s\-.,;:!?'")\]}[\\])/g)) {
      const from = start + span.index + span[1].length;
      blocked.fill(1, from, from + span[0].length - span[1].length);
    }
  }
  return { blocked, lineStarts, protectedLine };
}

/** The line index holding `pos`. @param {number[]} lineStarts @param {number} pos */
function lineOf(lineStarts, pos) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where the footnote definition starting on line `i` ends: at the next heading or definition, or after two blank lines.
 * @param {string[]} lines @param {number[]} lineStarts @param {number} i @param {number} textLength */
function definitionEnd(lines, lineStarts, i, textLength) {
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^\*+ /.test(line) || DEF_LINE_RE.test(line)) return lineStarts[j];
    if (/^[ \t]*$/.test(line) && j + 1 < lines.length && /^[ \t]*$/.test(lines[j + 1]) && j + 1 < lines.length - 1) return lineStarts[j];
  }
  return textLength;
}

/** The definitions (a label at the start of a line) in `text`, each with the span of its element.
 * @param {string} text */
function findDefinitionElements(text) {
  const { lineStarts, protectedLine } = analyze(text);
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (protectedLine[i]) continue;
    const m = DEF_LINE_RE.exec(lines[i]);
    if (!m) continue;
    out.push({ label: m[1], begin: lineStarts[i], end: definitionEnd(lines, lineStarts, i, text.length), line: i });
  }
  return { elements: out, lines, lineStarts };
}

/** The footnote reference starting at `pos`, or null. Inline text may span lines but not a blank line.
 * @param {string} text @param {number} pos @returns {Omit<FootnoteRef, 'top'> | null} */
function referenceAt(text, pos) {
  REF_START_RE.lastIndex = pos;
  const m = REF_START_RE.exec(text);
  if (!m) return null;
  if (m[3] !== undefined) return { label: m[3], begin: pos, end: pos + m[0].length, inline: false, contentsBegin: -1, contentsEnd: -1 };
  const contentsBegin = pos + m[0].length;
  let depth = 0;
  for (let i = contentsBegin; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 80))) return null;
    if (c === '[') depth++;
    else if (c === ']') {
      if (depth === 0) return { label: m[1] === undefined ? null : m[1], begin: pos, end: i + 1, inline: true, contentsBegin, contentsEnd: i };
      depth--;
    }
  }
  return null;
}

/** Every footnote reference in buffer order. A [fn:label] at the start of a line is a definition, not a reference.
 * @param {string} text @returns {FootnoteRef[]} */
function scanReferences(text) {
  const { blocked } = analyze(text);
  const { elements } = findDefinitionElements(text);
  const refs = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('[fn:', from);
    if (at < 0) break;
    from = at + 1;
    if (blocked[at]) continue;
    const ref = referenceAt(text, at);
    if (!ref) continue;
    if (!ref.inline && (at === 0 || text[at - 1] === '\n')) continue; // a definition
    const top = !elements.some((d) => at >= d.begin && at < d.end);
    refs.push({ ...ref, top });
  }
  return refs;
}

/** Every label in use, by reference or definition.
 * @param {string} text */
function allLabels(text) {
  /** @type {Set<string>} */
  const labels = new Set();
  for (const r of scanReferences(text)) if (r.label !== null) labels.add(r.label);
  for (const d of findDefinitionElements(text).elements) labels.add(d.label);
  return labels;
}

/** The first number not used as a label yet (org-footnote-unique-label).
 * @param {string} text */
export function uniqueFootnoteLabel(text) {
  const used = allLabels(text);
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** @param {string} text */
export function footnoteLabels(text) {
  return [...allLabels(text)];
}

// ---- collecting, in the order Org does ---------------------------------------------------------------------------

/** Labelled references (and anonymous ones when asked) in deep-reading order: a definition's own references follow
 * the reference to it. @param {string} text @param {boolean} anonymous */
function collectReferences(text, anonymous) {
  const all = scanReferences(text).filter((r) => anonymous || r.label !== null);
  const { elements } = findDefinitionElements(text);
  /** @type {Map<string | null, (string | null)[]>} */
  const nested = new Map();
  for (const r of all) {
    const d = elements.find((e) => r.begin >= e.begin && r.begin < e.end);
    if (!d) continue;
    const list = nested.get(d.label) || [];
    list.push(r.label);
    nested.set(d.label, list);
  }
  /** @param {string | null} label */
  const lastWith = (label) => {
    for (let i = all.length - 1; i >= 0; i--) if (all[i].label === label) return all[i];
    return null;
  };
  /** @type {FootnoteRef[]} */
  const ordered = [];
  /** @param {FootnoteRef} ref @param {boolean} allowNested */
  const add = (ref, allowNested) => {
    if (!allowNested && !ref.top) return;
    ordered.push(ref);
    const labels = ref.label === null ? [] : nested.get(ref.label) || [];
    for (const l of labels) {
      const r = lastWith(l);
      if (r) add(r, true);
    }
  };
  for (const r of all) add(r, false);
  return ordered;
}

/** Removes the definitions (the first of each label) and returns them, newest first like Org's list.
 * @param {Buf} buf @returns {{ label: string, def: string }[]} */
function takeDefinitions(buf) {
  /** @type {{ label: string, def: string }[]} */
  const found = [];
  const seen = new Set();
  let searchFrom = 0;
  for (;;) {
    const { elements } = findDefinitionElements(buf.text);
    const el = elements.find((e) => e.begin >= searchFrom && !seen.has(e.label));
    if (!el) {
      const dup = elements.find((e) => e.begin >= searchFrom);
      if (!dup) break;
      searchFrom = dup.end;
      continue;
    }
    seen.add(el.label);
    const text = buf.text;
    // from the line after the text before it, to the line after its last text
    let beg = el.begin;
    let b = beg;
    while (b > 0 && /[ \r\t\n]/.test(text[b - 1])) b--;
    if (b === 0) beg = 0;
    else {
      const nl0 = text.indexOf('\n', b);
      beg = nl0 < 0 ? text.length : nl0 + 1;
    }
    let e = el.end;
    while (e > 0 && /[ \r\t\n]/.test(text[e - 1])) e--;
    const nl = text.indexOf('\n', e);
    const end = nl < 0 ? text.length : nl + 1;
    found.unshift({ label: el.label, def: text.slice(beg, end).trim() });
    buf.replace(beg, end, '');
    searchFrom = beg;
  }
  return found;
}

// ---- the footnote section -------------------------------------------------------------------------------------------

/** @param {string} section */
function sectionHeadingRe(section) {
  return new RegExp('^\\*+ +' + section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'im');
}

/** Removes every footnote section and starts a new one at the end of the text; returns where its entries go.
 * @param {Buf} buf @param {string} section @returns {number} */
function clearFootnoteSection(buf, section) {
  const re = sectionHeadingRe(section);
  for (;;) {
    const m = re.exec(buf.text);
    if (!m) break;
    const level = /^\*+/.exec(m[0])?.[0].length || 1;
    // the subtree ends at the next heading of its level or higher
    const nextRe = new RegExp('\\n(\\*{1,' + level + '} )', 'g');
    nextRe.lastIndex = m.index + m[0].length;
    const n = nextRe.exec(buf.text);
    buf.replace(m.index, n ? n.index + 1 : buf.text.length, '');
  }
  const kept = buf.text.replace(/[ \r\t\n]+$/, '').length;
  buf.replace(kept, buf.text.length, kept === 0 ? '\n' : '\n\n');
  buf.insert(buf.text.length, '* ' + section + '\n');
  return buf.text.length;
}

/** Where a section's entries start when it exists: after its heading and any planning line, properties, clock lines,
 * drawers and blank lines (org-end-of-meta-data).
 * @param {string} text @param {string} section @returns {number | null} */
function existingSectionStart(text, section) {
  const m = sectionHeadingRe(section).exec(text);
  if (!m) return null;
  const nl0 = text.indexOf('\n', m.index + m[0].length);
  if (nl0 < 0) return text.length;
  const lines = text.slice(nl0 + 1).split('\n');
  let pos = nl0 + 1;
  let i = 0;
  /** @param {number} k */
  const eat = (k) => {
    while (i < k && i < lines.length) pos += lines[i++].length + 1;
  };
  if (i < lines.length && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[i])) eat(i + 1);
  if (i < lines.length && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[i])) {
    let j = i + 1;
    while (j < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[j])) j++;
    if (j < lines.length) eat(j + 1);
  }
  while (i < lines.length && !(i === lines.length - 1 && lines[i] === '')) {
    const line = lines[i];
    if (/^\*+ /.test(line)) break;
    if (/^[ \t]*$/.test(line) || /^[ \t]*CLOCK:/.test(line)) eat(i + 1);
    else if (/^[ \t]*:(?:\w|[-_])+:[ \t]*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[j])) j++;
      if (j >= lines.length) break;
      eat(j + 1);
    } else break;
  }
  return Math.min(pos, text.length);
}

/** Moves back over blank lines to the start of the first one (org-back-over-empty-lines): where that is, and how many
 * lines it passed. @param {string} text @param {number} at */
function backOverEmptyLines(text, at) {
  let b = at;
  while (b > 0 && /[ \t\n\r]/.test(text[b - 1])) b--;
  const nl = text.indexOf('\n', b);
  const target = nl < 0 ? text.length : nl + 1;
  const pos = Math.min(target, at);
  let count = (text.slice(pos, at).match(/\n/g) || []).length;
  if (at > pos && text[at - 1] !== '\n') count++;
  return { pos, count };
}

/** The point at the end of the section containing `pos`, before the next heading (org-footnote--goto-local-insertion-point).
 * @param {Buf} buf @param {number} pos */
function localInsertionPoint(buf, pos) {
  const m = /\n\*+ /g;
  m.lastIndex = pos;
  const next = m.exec(buf.text);
  let at = next ? next.index + 1 : buf.text.length;
  while (at > 0 && /[ \t\n]/.test(buf.text[at - 1])) at--;
  if (at > 0) {
    const nl = buf.text.indexOf('\n', at);
    at = nl < 0 ? buf.text.length : nl + 1;
  }
  if (at > 0 && buf.text[at - 1] !== '\n') {
    buf.insert(at, '\n');
    at++;
  }
  return at;
}

// ---- org-footnote-normalize --------------------------------------------------------------------------------------

/** Turns every footnote into a numbered one: references numbered in reading order, inline footnotes made into
 * definitions, and all definitions placed in the footnote section (or at the end of the section holding each reference
 * when there is none).
 * @param {string} text @param {Partial<FootnoteOptions>} [options] @returns {string} */
export function normalizeFootnotes(text, options) {
  const opt = { ...footnoteDefaults, ...options };
  const refs = collectReferences(text, true);
  /** @type {Map<FootnoteRef, string>} */
  const newLabel = new Map();
  /** @type {Map<string, string>} */
  const translations = new Map();
  /** @type {Set<FootnoteRef>} */
  const anonymousRefs = new Set();
  let n = 0;
  for (const r of refs) {
    if (r.label === null) {
      newLabel.set(r, String(++n));
      anonymousRefs.add(r);
    } else {
      let t = translations.get(r.label);
      if (t === undefined) {
        t = String(++n);
        translations.set(r.label, t);
      }
      newLabel.set(r, t);
    }
  }
  const buf = new Buf(text);
  const marks = new Map(refs.map((r) => [r, buf.mark(r.begin)]));
  /** @type {Map<FootnoteRef, { key: string, def: string, anonymous: boolean }>} */
  const extracted = new Map();
  // rewrite the references in reading order, as Org does: the label first, then an inline footnote's text moves out
  for (const r of refs) {
    const m = /** @type {{ at: number }} */ (marks.get(r));
    const label = /** @type {string} */ (newLabel.get(r));
    let point = m.at + 4;
    const ch = buf.text[point];
    if (ch === ':') {
      buf.insert(point, label);
      point += label.length;
    } else {
      const word = new RegExp(`^${WORD}+`, 'u').exec(buf.text.slice(point));
      if (word) {
        buf.replace(point, point + word[0].length, label);
        point += label.length;
      }
    }
    if (r.inline) {
      const size = r.contentsEnd - r.contentsBegin;
      const taken = buf.text.slice(point, point + size + 1);
      buf.replace(point, point + size + 1, '');
      extracted.set(r, { key: anonymousRefs.has(r) ? label : /** @type {string} */ (r.label), def: `[fn:${label}] ${taken.slice(1).trim()}`, anonymous: anonymousRefs.has(r) });
    }
  }
  // Org pushes each inline definition as it handles the references in order: the last one handled comes first
  /** @type {{ key: string, def: string, anonymous: boolean }[]} */
  const definitions = [];
  for (const r of refs) {
    const d = extracted.get(r);
    if (d) definitions.unshift(d);
  }
  for (const d of takeDefinitions(buf)) definitions.push({ key: d.label, def: d.def, anonymous: false });
  const point = buf.mark(opt.section ? clearFootnoteSection(buf, opt.section) : 0);
  /** @param {{ key: string, anonymous: boolean }} d */
  const idOf = (d) => (d.anonymous ? '\u0000' : '') + d.key;
  const inserted = new Set();
  /** @param {string} entry */
  const put = (entry) => {
    const at = point.at;
    buf.insert(at, '\n' + entry + '\n');
    point.at = at + entry.length + 2;
  };
  for (const r of refs) {
    const anonymous = anonymousRefs.has(r);
    const nl = /** @type {string} */ (newLabel.get(r));
    const key = anonymous ? '\u0000' + nl : /** @type {string} */ (r.label);
    if (!opt.section && r.top) point.at = localInsertionPoint(buf, /** @type {{ at: number }} */ (marks.get(r)).at);
    if (inserted.has(key)) continue;
    inserted.add(key);
    const stored = definitions.find((d) => idOf(d) === (anonymous ? key : key));
    if (!stored) put(`[fn:${nl}] DEFINITION NOT FOUND.`);
    else if (anonymous) put(stored.def);
    else put(stored.def.replace(/^\[fn:(.*?)\]/, `[fn:${nl}]`));
  }
  // definitions nobody refers to go last, numbered on
  for (const d of definitions) {
    if (inserted.has(idOf(d))) continue;
    put(d.def.replace(/^\[fn:[^\]]*\]/, `[fn:${++n}]`));
  }
  return buf.text;
}

// ---- org-footnote-new --------------------------------------------------------------------------------------------

/** Whether a footnote reference can be typed at `pos` (org-footnote--allow-reference-p).
 * @param {string} text @param {number} pos */
export function canInsertFootnoteAt(text, pos) {
  if (pos <= 0 || pos > text.length || text[pos - 1] === '\n') return false;
  const { blocked, lineStarts, protectedLine } = analyze(text);
  const li = lineOf(lineStarts, pos);
  if (protectedLine[li] || blocked[pos - 1] && blocked[pos]) return false;
  const lines = text.split('\n');
  const line = lines[li];
  const col = pos - lineStarts[li];
  for (const r of scanReferences(text)) {
    if (pos > r.begin && pos < r.end && (!r.inline || pos < r.contentsBegin || pos > r.contentsEnd)) return false; // inside a footnote
  }
  if (/^[ \t]*(?::(?:\w|[-_])+:[ \t]*$|#\+(?:begin|end)_|(?:SCHEDULED|DEADLINE|CLOSED):)/i.test(line)) return false; // drawer, block and planning lines
  const head = /^(\*+ +(?:(?:TODO|DONE|[A-Z]{3,}) +)?(?:\[#[A-Z0-9]+\] +)?)/.exec(line);
  if (/^\*+ /.test(line)) {
    if (!head || col < head[1].length) return false;
    const tags = /[ \t]+:[\w@#%:]+:[ \t]*$/.exec(line);
    return !(tags && col > tags.index);
  }
  const bullet = /^([ \t]*)(?:[-+*]|\d+[.)])(?=[ \t]|$)/.exec(line);
  if (bullet && col <= bullet[0].length) return false;
  if (/^[ \t]*\|/.test(line)) {
    // only inside a cell, not before the row or after its last bar, and not in a rule row
    if (/^[ \t]*\|-/.test(line)) return false;
    const first = line.indexOf('|');
    const last = line.trimEnd().endsWith('|') ? line.trimEnd().length - 1 : line.length;
    return col > first && col <= last;
  }
  const def = DEF_LINE_RE.exec(line);
  if (def && col < def[0].length) return false;
  if (def && col === def[0].length) return /[ \t]/.test(line[col] || '');
  return true;
}

/** Inserts a new footnote at `pos`. `label` is null for an anonymous one, the name of an existing footnote for another
 * reference to it, or a new label for a footnote with a definition. Returns the new text and where the cursor goes (in the
 * definition when there is one to write), or null where a footnote can't go.
 * @param {string} text @param {number} pos @param {string | null} label @param {Partial<FootnoteOptions>} [options]
 * @returns {{ text: string, cursor: number, existing: boolean } | null} */
export function insertFootnote(text, pos, label, options) {
  const opt = { ...footnoteDefaults, ...options };
  if (!canInsertFootnoteAt(text, pos)) return null;
  const used = allLabels(text);
  const buf = new Buf(text);
  if (label === null) {
    buf.insert(pos, '[fn::]');
    return { text: buf.text, cursor: pos + 5, existing: false };
  }
  if (used.has(label)) {
    buf.insert(pos, `[fn:${label}]`);
    return { text: buf.text, cursor: pos + label.length + 5, existing: true };
  }
  if (opt.defineInline) {
    buf.insert(pos, `[fn:${label}:]`);
    return { text: buf.text, cursor: pos + label.length + 5, existing: false };
  }
  buf.insert(pos, `[fn:${label}]`);
  const entry = `[fn:${label}] `;
  /** @type {number} */
  let at;
  if (!opt.section) {
    at = localInsertionPoint(buf, pos);
  } else {
    const start = existingSectionStart(buf.text, opt.section);
    if (start === null) at = clearFootnoteSection(buf, opt.section);
    else {
      at = start;
      if (at > 0 && buf.text[at - 1] !== '\n') {
        buf.insert(at, '\n');
        at++;
      }
    }
  }
  const back = backOverEmptyLines(buf.text, at);
  at = back.pos;
  if (back.count === 0) {
    buf.insert(at, '\n');
    at++;
  }
  buf.insert(at, entry + '\n');
  return { text: buf.text, cursor: at + entry.length, existing: false };
}
