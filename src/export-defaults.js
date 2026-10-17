// @ts-check
// App-wide defaults for HTML export (preamble, postamble, head) and for printed pages (page header, page footer).
// Each item has its text and an "apply" switch, both kept in the Global Variables. Off unless switched on. A value written in the file
// itself (#+OPTIONS:, #+HTML_HEAD:) always wins over these.

/** @typedef {{ preamble?: string, postamble?: string | false, head?: string, pageHeader?: string, pageFooter?: string }} HtmlExportDefaults */

/** The items, with the text offered before the person has typed anything. `key` is the Global Variable that holds the text; `key + '-on'` holds the switch. */
export const EXPORT_DEFAULT_ITEMS = /** @type {const} */ ([
  { id: 'preamble', key: 'org-xx-html-preamble', text: '%t : %s' },
  { id: 'postamble', key: 'org-xx-html-postamble', text: 'Prepared by %a, %d' },
  { id: 'head', key: 'org-xx-html-head', text: '<style>\n  body { max-width: 46rem; margin: 2rem auto; font-family: Georgia, serif; line-height: 1.5 }\n</style>' },
  { id: 'pageHeader', key: 'org-xx-page-header', text: 'Draft | | %d' },
  { id: 'pageFooter', key: 'org-xx-page-footer', text: '%a | | Page %p of %P' },
]);

/** A Global Variable value is one line, so a new line in the text is stored as \n.
 * @param {string} text */
export function encodeExportText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** @param {string} raw */
export function decodeExportText(raw) {
  return raw.replace(/\\(.)/g, (_m, c) => (c === 'n' ? '\n' : c));
}

/** @param {unknown} v */
function isOn(v) {
  return typeof v === 'string' && v.trim() === 't';
}

/** The text of one item and whether it is switched on.
 * @param {Record<string, string> | null | undefined} vars
 * @param {typeof EXPORT_DEFAULT_ITEMS[number]} item */
export function exportItemState(vars, item) {
  const v = vars || {};
  const raw = v[item.key];
  return { text: raw === undefined ? item.text : decodeExportText(raw), on: isOn(v[item.key + '-on']), edited: raw !== undefined };
}

/** The text of a quoted Lisp string value ("a\nb" is two lines), or null when the value is not a string (t, nil, auto).
 * @param {unknown} raw
 * @returns {string | null} */
function lispStringValue(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!/^".*"$/s.test(v)) return null;
  return v.slice(1, -1).replace(/\\(.)/gs, (_m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** The defaults to apply: the items switched on (and not empty), else Org's own variables when Global Variables set them:
 *  `org-html-head` and `org-html-preamble` as strings, `org-html-postamble` as a string or `nil`. An item switched on wins.
 * @param {Record<string, string> | null | undefined} vars
 * @returns {HtmlExportDefaults} */
export function htmlExportDefaults(vars) {
  /** @type {HtmlExportDefaults} */ const out = {};
  for (const item of EXPORT_DEFAULT_ITEMS) {
    const s = exportItemState(vars, item);
    if (s.on && s.text.trim() !== '') /** @type {Record<string, string>} */ (out)[item.id] = s.text;
  }
  const v = vars || {};
  const head = lispStringValue(v['org-html-head']);
  if (out.head === undefined && head !== null && head.trim() !== '') out.head = head;
  const preamble = lispStringValue(v['org-html-preamble']);
  if (out.preamble === undefined && preamble !== null && preamble.trim() !== '') out.preamble = preamble;
  if (out.postamble === undefined) {
    const postamble = lispStringValue(v['org-html-postamble']);
    if (postamble !== null) {
      if (postamble.trim() !== '') out.postamble = postamble;
    } else if (String(v['org-html-postamble'] ?? '').trim().toLowerCase() === 'nil') out.postamble = false;
  }
  return out;
}

/** How many items are switched on, for the "N set" count.
 * @param {Record<string, string> | null | undefined} vars
 * @param {string[]} ids */
export function countExportItemsOn(vars, ids) {
  return EXPORT_DEFAULT_ITEMS.filter((item) => ids.includes(item.id) && exportItemState(vars, item).on).length;
}
