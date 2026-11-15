/**
 * The category a file gives its entries when an entry names none of its own, as Org does (org-refresh-category-properties): the CATEGORY
 * of a property drawer at the very top of the file (only comment lines may come before it), else the last `#+CATEGORY:` keyword anywhere
 * in the file (not inside a source, example, export, comment or verse block), else the given default (the file name).
 */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

const OPAQUE_BLOCKS = /^(?:SRC|EXAMPLE|EXPORT|COMMENT|VERSE)$/i;

/** The `#+CATEGORY:` values of the lines, in order, skipping the inside of the blocks that hold no keywords. @param {string[]} lines @returns {string[]} */
function categoryKeywords(lines) {
  /** @type {string[]} */ const values = [];
  /** @type {RegExp | null} */ let end = null;
  for (const line of lines) {
    if (end) {
      if (end.test(line)) end = null;
      continue;
    }
    const begin = /^[ \t]*#\+BEGIN_(\S+)/i.exec(line);
    if (begin && OPAQUE_BLOCKS.test(begin[1])) {
      end = new RegExp(`^[ \\t]*#\\+END_${begin[1]}[ \\t]*$`, 'i');
      continue;
    }
    const kw = /^[ \t]*#\+CATEGORY:(.*)$/i.exec(line);
    if (kw) values.push(kw[1].trim());
  }
  return values;
}

/** The CATEGORY of the property drawer at the top of the file, or null. @param {Doc} doc @returns {string | null} */
function topDrawerCategory(doc) {
  const body = doc.bodyLines || [];
  const first = body.findIndex((line) => !/^[ \t]*#(?: |$)/.test(line));
  if (first < 0 || !/^[ \t]*:PROPERTIES:[ \t]*$/i.test(body[first])) return null;
  if ((doc.keywords || []).some((k) => !k.virtual && k.bodyLineIndex <= first)) return null; // a keyword line before the drawer: it is not at the top
  for (let i = first + 1; i < body.length && !/^[ \t]*:END:[ \t]*$/i.test(body[i]); i++) {
    const m = /^[ \t]*:CATEGORY:(?:[ \t]+(.*?))?[ \t]*$/i.exec(body[i]);
    if (m) return m[1] ?? '';
  }
  return null;
}

/**
 * @param {Doc} doc
 * @param {string} fallback the category when the file says none
 * @returns {string}
 */
function fileCategory(doc, fallback) {
  const top = topDrawerCategory(doc);
  if (top !== null) return top;
  /** @type {string[]} */ const lines = [];
  const real = (doc.keywords || []).filter((k) => !k.virtual);
  const body = doc.bodyLines || [];
  let next = 0;
  for (let i = 0; i <= body.length; i++) {
    while (next < real.length && real[next].bodyLineIndex <= i) lines.push(real[next++].raw ?? `#+${real[next - 1].key}: ${real[next - 1].value}`);
    if (i < body.length) lines.push(body[i]);
  }
  /** @param {Doc | Heading} node */
  const collect = (node) => {
    for (const child of node.children || []) {
      if (child.type !== 'heading') continue;
      lines.push(...(child.bodyLines || []));
      collect(child);
    }
  };
  collect(doc);
  const values = categoryKeywords(lines);
  return values.length ? values[values.length - 1] : fallback;
}

export { fileCategory };
