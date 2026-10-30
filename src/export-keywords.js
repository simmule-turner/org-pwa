// @ts-check
/**
 * Keywords that apply to the whole file wherever they stand. Org reads `#+TITLE:`, `#+OPTIONS:`, `#+MACRO:`, `#+LINK:`, the
 * export back ends' own settings and the like from the entire buffer, not only from the lines above the first headline; the
 * app keeps the ones below a headline in that headline's body, so an export first adds them to the document's keywords.
 */

import { expandAbbreviation, linkAbbreviations } from './link-abbrev.js';
import { parseBody } from './body-parser.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

const GLOBAL_KEYS = /^(?:TITLE|SUBTITLE|AUTHOR|DATE|EMAIL|OPTIONS|LANGUAGE|CREATOR|DESCRIPTION|KEYWORDS|SELECT_TAGS|EXCLUDE_TAGS|MACRO|LINK|(?:HTML|LATEX|ODT|BEAMER|ICALENDAR|TEXINFO|MAN)_[A-Z_]+)$/i;
const BLOCK_OPEN = /^[ \t]*#\+begin_(\S+)/i;

/**
 * The document with the global keywords found in headings' text added, after the ones it already has (as virtual keywords, which
 * writing the document back ignores). The document itself when there are none.
 * @param {Doc} doc
 * @param {boolean} [links]  false when the back end handles links itself (the Org back end keeps them as written)
 * @returns {Doc}
 */
export function withBufferKeywords(doc, links = true) {
  /** @type {{ key: string, value: string, bodyLineIndex: number, virtual: boolean }[]} */
  const found = [];
  /** @param {Heading[]} headings */
  const walk = (headings) => {
    for (const h of headings) {
      let block = '';
      for (const line of h.bodyLines || []) {
        if (block) {
          if (new RegExp(`^[ \\t]*#\\+end_${block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(line)) block = '';
          continue;
        }
        const open = BLOCK_OPEN.exec(line);
        if (open) {
          block = open[1];
          continue;
        }
        const m = /^[ \t]*#\+([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/.exec(line);
        if (m && GLOBAL_KEYS.test(m[1])) found.push({ key: m[1], value: m[2], bodyLineIndex: 0, virtual: true });
      }
      walk(h.children || []);
    }
  };
  walk(doc.children || []);
  const all = found.length ? { ...doc, keywords: [...(doc.keywords || []), ...found] } : doc;
  return links ? expandLinks(all) : all;
}

const BLOCK_FENCE = /^\s*#\+(begin|end)_(src|example|export|comment)\b/i;

/**
 * The document with `#+LINK:` abbreviations in its links expanded and `doi:` links written as the address they stand for
 * (`doi:10.1/x` is `https://doi.org/10.1/x`), as Org's export does before any back end reads a link.
 * @param {Doc} doc @returns {Doc}
 */
function expandLinks(doc) {
  const map = linkAbbreviations(doc);
  const clocks = (doc.keywords || []).some((k) => String(k.key).toUpperCase() === 'OPTIONS' && /(?:^|\s)c:(?!nil)\S/.test(k.value));
  /** @param {string} text */
  const fix = (text) => text.includes('[[') ? text.replace(/\[\[((?:\\.|[^\][\\])+)(\]\[[^\]]*)?\]\]/g, (whole, raw, desc) => {
    const target = expandAbbreviation(raw, map);
    const out = target.startsWith('doi:') ? 'https://doi.org/' + target.slice(4) : target;
    return out === raw ? whole : `[[${out}${desc || ''}]]`;
  }) : text;
  /** @param {string[]} input */
  const lines = (input) => {
    let inBlock = false;
    /** @type {string[]} */
    const out = [];
    let dropped = false;
    for (const line of input) {
      if (dropped && !line.trim()) continue; // the blank lines after a clock line go with it
      dropped = false;
      const fence = BLOCK_FENCE.exec(line);
      if (fence) inBlock = fence[1].toLowerCase() === 'begin';
      if (fence || inBlock) out.push(line);
      else if (clocks || !/^[ \t]*CLOCK:[ \t]*\[/.test(line)) out.push(fix(line));
      else dropped = true; // clock lines are not exported unless `c:t`
    }
    return out;
  };
  let changed = false;
  /** @param {Heading} h @returns {Heading} */
  const walk = (h) => {
    const title = fix(h.title);
    const bodyLines = lines(h.bodyLines || []);
    const children = (h.children || []).map(walk);
    if (title === h.title && bodyLines.length === (h.bodyLines || []).length && bodyLines.every((l, i) => l === (h.bodyLines || [])[i]) && children.every((c, i) => c === (h.children || [])[i])) return h;
    changed = true;
    const hadClock = !clocks && (h.bodyLines || []).some((l) => /^[ \t]*CLOCK:[ \t]*\[/.test(l));
    return { ...h, title, bodyLines, body: parseBody(bodyLines), children, ...(hadClock ? { hadClock: true } : {}) }; // a heading with only a clock line still has a section
  };
  const bodyLines = lines(doc.bodyLines || []);
  const children = (doc.children || []).map(walk);
  if (!changed && bodyLines.length === (doc.bodyLines || []).length && bodyLines.every((l, i) => l === (doc.bodyLines || [])[i])) return doc;
  return { ...doc, bodyLines, body: parseBody(bodyLines), children };
}
