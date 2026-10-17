// @ts-check
// App-wide defaults for HTML export (preamble, postamble, head) and for printed pages (page header, page footer).
// The HTML items are Org's own variables, set in the Global Variables; the page header and footer have their own text and an "apply" switch. Off unless set. A value written in the file
// itself (#+OPTIONS:, #+HTML_HEAD:) always wins over these.

/** @typedef {{ preamble?: string, postamble?: string | false, head?: string, pageHeader?: string, pageFooter?: string }} HtmlExportDefaults */

/** The items, with the text offered before the person has typed anything. `key` is the Global Variable that holds the text.
 *  `lisp` items are Org's own variables (org-html-preamble, -postamble, -head): the value is a quoted string and being set
 *  means being on. The page header and footer have no Org variable: they keep their own text and a `key + '-on'` switch. */
export const EXPORT_DEFAULT_ITEMS = /** @type {const} */ ([
  { id: 'preamble', key: 'org-html-preamble', lisp: true, text: '%t : %s' },
  { id: 'postamble', key: 'org-html-postamble', lisp: true, text: 'Prepared by %a, %d' },
  { id: 'head', key: 'org-html-head', lisp: true, text: '<style>\n  body { max-width: 46rem; margin: 2rem auto; font-family: Georgia, serif; line-height: 1.5 }\n</style>' },
  { id: 'pageHeader', key: 'org-xx-page-header', lisp: false, text: 'Draft | | %d' },
  { id: 'pageFooter', key: 'org-xx-page-footer', lisp: false, text: '%a | | Page %p of %P' },
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

/** A text as the quoted Lisp string Org reads (a new line is \n, a quote or backslash is escaped).
 * @param {string} text */
export function encodeLispString(text) {
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** The text of one item and whether it is on. An Org variable is on when it holds a non-empty quoted string.
 * @param {Record<string, string> | null | undefined} vars
 * @param {typeof EXPORT_DEFAULT_ITEMS[number]} item */
export function exportItemState(vars, item) {
  const v = vars || {};
  if (item.lisp) {
    const text = lispStringValue(v[item.key]);
    const on = text !== null && text.trim() !== '';
    return { text: on ? /** @type {string} */ (text) : item.text, on, edited: on };
  }
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

/** The defaults to apply: the items that are on and not empty. `org-html-postamble` set to `nil` means no postamble.
 * @param {Record<string, string> | null | undefined} vars
 * @returns {HtmlExportDefaults} */
export function htmlExportDefaults(vars) {
  /** @type {HtmlExportDefaults} */ const out = {};
  for (const item of EXPORT_DEFAULT_ITEMS) {
    const s = exportItemState(vars, item);
    if (s.on && s.text.trim() !== '') /** @type {Record<string, string>} */ (out)[item.id] = s.text;
  }
  if (out.postamble === undefined && String((vars || {})['org-html-postamble'] ?? '').trim().toLowerCase() === 'nil') out.postamble = false;
  return out;
}

/** Moves the retired switch-and-text variables (org-xx-html-*, org-xx-babel-js) onto Org's own, once. Returns null when there is
 *  nothing to move. An Org variable that is already set is kept.
 * @param {Record<string, string>} vars
 * @returns {Record<string, string> | null} */
export function migrateRetiredVariables(vars) {
  const legacy = ['preamble', 'postamble', 'head'].map((id) => 'org-xx-html-' + id);
  if (![...legacy, 'org-xx-babel-js'].some((k) => k in vars || k + '-on' in vars)) return null;
  const out = { ...vars };
  for (const id of ['preamble', 'postamble', 'head']) {
    const old = 'org-xx-html-' + id;
    const item = EXPORT_DEFAULT_ITEMS.find((i) => i.id === id);
    if (item && isOn(out[old + '-on']) && out[item.key] === undefined) {
      const text = old in out ? decodeExportText(out[old]) : item.text;
      if (text.trim() !== '') out[item.key] = encodeLispString(text);
    }
    delete out[old];
    delete out[old + '-on'];
  }
  if ('org-xx-babel-js' in out) {
    if (/^(on|yes|t|true)$/i.test(String(out['org-xx-babel-js']).trim()) && out['org-babel-load-languages'] === undefined) out['org-babel-load-languages'] = '((emacs-lisp . t) (js . t))';
    delete out['org-xx-babel-js'];
  }
  return out;
}

/** How many items are switched on, for the "N set" count.
 * @param {Record<string, string> | null | undefined} vars
 * @param {string[]} ids */
export function countExportItemsOn(vars, ids) {
  return EXPORT_DEFAULT_ITEMS.filter((item) => ids.includes(item.id) && exportItemState(vars, item).on).length;
}
