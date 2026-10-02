/**
 * Affiliated keywords: the `#+NAME:`, `#+CAPTION:`, `#+ATTR_HTML:` (and other
 * `#+ATTR_*:`), `#+HEADER:` and `#+RESULTS:` lines that sit directly above a
 * paragraph, image, table or block and describe it. In real files they are
 * common (a caption and a width on nearly every figure, a name on nearly every
 * source block), and without this they showed up as raw `#+CAPTION: ...` text
 * glued to the paragraph beneath.
 *
 * This only READS them for display. The raw lines stay in the body text, which
 * remains what is saved, so nothing about round-tripping or editing changes.
 */

const AFFILIATED_RE = /^\s*#\+(NAME|CAPTION|ATTR_[A-Za-z0-9_-]+|HEADERS?|RESULTS)(?:\[[^\]]*\])?:[ \t]?(.*)$/i;

/** Splits the leading run of affiliated-keyword lines off `lines`.
 *  @returns {{ affiliated: { key: string, value: string, line: string }[], rest: string[] }} */
function splitAffiliated(lines) {
  const affiliated = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = AFFILIATED_RE.exec(lines[i]);
    if (!m) break;
    affiliated.push({ key: m[1].toUpperCase(), value: m[2].trim(), line: lines[i] });
  }
  return { affiliated, rest: lines.slice(i) };
}

/** `:width 300 :alt A cat :align center` -> { width: '300', alt: 'A cat', align: 'center' }.
 *  An option's value runs up to the next `:option`. */
function parseAttrOptions(value) {
  const options = {};
  const re = /(?:^|\s):([A-Za-z][\w-]*)(?=\s|$)/g;
  const marks = [];
  let m;
  while ((m = re.exec(value)) !== null) marks.push({ name: m[1].toLowerCase(), end: re.lastIndex, start: m.index });
  marks.forEach((mark, n) => {
    const stop = n + 1 < marks.length ? marks[n + 1].start : value.length;
    options[mark.name] = value.slice(mark.end, stop).trim();
  });
  return options;
}

/** A width or height a browser can use, or null: a bare number is pixels, and only
 *  plain lengths are accepted (never an arbitrary string put into a style). */
function cssLength(value) {
  if (value == null) return null;
  const m = /^(\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/.exec(String(value).trim());
  return m ? m[1] + (m[2] || 'px') : null;
}

/** The size and alignment for the image(s) in the paragraph below the keywords, from
 *  `#+ATTR_HTML:` (preferred) or `#+ATTR_ORG:`. */
function imageOptions(affiliated) {
  const lines = affiliated.filter((a) => a.key === 'ATTR_HTML').concat(affiliated.filter((a) => a.key === 'ATTR_ORG'));
  const merged = {};
  for (const a of lines.reverse()) Object.assign(merged, parseAttrOptions(a.value)); // ATTR_HTML wins over ATTR_ORG
  return { width: cssLength(merged.width), height: cssLength(merged.height), center: /^center$/i.test(merged.align || '') };
}

/** All `#+CAPTION:` lines joined, as org does. '' when there is none. */
function captionText(affiliated) {
  return affiliated.filter((a) => a.key === 'CAPTION').map((a) => a.value).filter(Boolean).join(' ');
}

export { splitAffiliated, parseAttrOptions, cssLength, imageOptions, captionText };
