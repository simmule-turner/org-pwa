// @ts-check
// App-wide defaults for HTML export (preamble, postamble, head) and for printed pages (page header, page footer).
// The HTML items are Org's own variables, set in the Global Variables; the page header and footer have their own text and an "apply" switch. Off unless set. A value written in the file
// itself (#+OPTIONS:, #+HTML_HEAD:) always wins over these.

/** @typedef {{ preamble?: string, postamble?: string | false, head?: string, pageHeader?: string, pageFooter?: string, sup?: string }} HtmlExportDefaults */

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

/** The LaTeX defaults from the Global Variables: `org-latex-default-class` and `org-latex-compiler`, each a quoted string; anything else is ignored.
 * @param {Record<string, string> | null | undefined} vars
 * @returns {{ cls?: string, compiler?: string, header?: string }} */
export function latexExportDefaults(vars) {
  const v = vars || {};
  const word = (/** @type {string} */ key, /** @type {string[]} */ allowed) => {
    const t = String(v[key] ?? '').trim().replace(/^"(.*)"$/s, '$1');
    return allowed.includes(t) ? t : undefined;
  };
  /** @type {{ cls?: string, compiler?: string, header?: string }} */ const out = {};
  const header = lispStringValue(v[LATEX_HEADER_KEY]);
  if (header !== null && header.trim() !== '') out.header = header;
  const cls = word('org-latex-default-class', LATEX_CLASSES);
  const compiler = word('org-latex-compiler', LATEX_COMPILERS);
  if (cls) out.cls = cls;
  if (compiler) out.compiler = compiler;
  return out;
}

export const LATEX_CLASSES = ['article', 'report', 'book'];
export const LATEX_COMPILERS = ['pdflatex', 'xelatex', 'lualatex'];

/** What "Add TOC with page numbers" puts in org-html-head: Paged.js splits the page into printed sheets in the browser, and the CSS gives
 *  each table-of-contents entry the number of the sheet its heading lands on. The text size (70%) is set here because the print dialog's
 *  Scale does not repaginate. */
export const PAGED_TOC_HEAD = `<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.min.js"></script>
<style>
#text-table-of-contents li { break-inside: auto; page-break-inside: auto }
@page { size: Letter; margin: 0.6in; @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt } }
html { font-size: 70% }
#text-table-of-contents a { display: flex; border-bottom: 1px dotted #999; margin-top: 2px; text-decoration: none; color: inherit }
#text-table-of-contents a::after { content: target-counter(attr(href url), page); margin-left: auto; padding-left: 1em }
#text-table-of-contents ul { list-style: none }
#table-of-contents { break-after: page }
</style>`;

/** Whether a head text already carries the page-number table of contents.
 * @param {string} head */
export function hasPagedToc(head) {
  return head.includes(PAGED_TOC_HEAD) || head.includes('paged.polyfill');
}

/** The head text with the page-number table of contents added or removed.
 * @param {string} head @param {boolean} on */
export function withPagedToc(head, on) {
  const bare = head.split(PAGED_TOC_HEAD).join('').replace(/\n{3,}/g, '\n\n').trim();
  return on ? (bare ? bare + '\n' : '') + PAGED_TOC_HEAD : bare;
}

/** The Global Variable that holds extra preamble lines for every LaTeX export (own; Org has no single variable for it). */
export const LATEX_HEADER_KEY = 'org-xx-latex-header';

/** What "Fix wide TOC numbers" adds: LaTeX's table of contents gives a section number a fixed box, so numbers such as 1.11 and 1.11.1
 *  run into the title. These widen the boxes (tocloft is part of TeX Live). */
export const LATEX_TOC_FIX_HEADER = `\\usepackage{tocloft}
\\setlength{\\cftsecnumwidth}{2.6em}
\\setlength{\\cftsubsecindent}{2.6em}
\\setlength{\\cftsubsecnumwidth}{3.4em}
\\setlength{\\cftsubsubsecindent}{6em}
\\setlength{\\cftsubsubsecnumwidth}{4.2em}`;

/** Whether a header text already carries the table-of-contents fix.
 * @param {string} header */
export function hasLatexTocFix(header) {
  return header.includes('\\cftsubsubsecnumwidth');
}

/** The header text with the table-of-contents fix added or removed.
 * @param {string} header @param {boolean} on */
export function withLatexTocFix(header, on) {
  const bare = header.split(LATEX_TOC_FIX_HEADER).join('').replace(/\n{3,}/g, '\n\n').trim();
  return on ? (bare ? bare + '\n' : '') + LATEX_TOC_FIX_HEADER : bare;
}
