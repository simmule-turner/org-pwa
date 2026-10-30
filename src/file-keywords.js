// @ts-check
/**
 * The values of a keyword that Org reads from the whole buffer (`#+STARTUP:`, `#+OPTIONS:`): the document's own keywords, then the
 * lines of the body text that are the keyword too -- below a heading, indented, or (for STARTUP) with no blank after the colon --
 * leaving out source, example, export and comment blocks.
 */

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

const FENCE = /^[ \t]*#\+(begin|end)_(src|example|export|comment)\b/i;

/**
 * @param {Doc} doc
 * @param {string} name  the keyword, e.g. 'STARTUP'
 * @param {boolean} [blankless]  accept `#+NAME:value` too
 * @returns {string[]}  the values, in file order (the keywords above the first heading first)
 */
export function bufferKeywordValues(doc, name, blankless = false) {
  const want = name.toUpperCase();
  /** @type {string[]} */
  const values = [];
  for (const kw of doc.keywords || []) if (kw.key.toUpperCase() === want) values.push(kw.value);
  const line = new RegExp(`^[ \\t]*#\\+${name}:${blankless ? '[ \\t]*' : '[ \\t]+'}(.*)$|^[ \\t]*#\\+${name}:[ \\t]*$`, 'i');
  /** @param {string[]} lines */
  const scan = (lines) => {
    let inBlock = false;
    for (const l of lines) {
      const fence = FENCE.exec(l);
      if (fence) {
        inBlock = fence[1].toLowerCase() === 'begin';
        continue;
      }
      if (inBlock) continue;
      const m = line.exec(l);
      if (m) values.push((m[1] ?? '').trim());
    }
  };
  scan(doc.bodyLines || []);
  /** @param {Heading[]} headings */
  const walk = (headings) => headings.forEach((h) => { scan(h.bodyLines || []); walk(h.children || []); });
  walk(doc.children || []);
  return values;
}
