// Cases of test/oracle-export.test.js where an exporter differs from Emacs 29.3, each with the reason. The test fails when a listed case
// starts to match, so the list only ever shrinks.
/** @type {{ id: string, reason: string, matches: (c: { backend: string, name: string }) => boolean }[]} */
export const KNOWN_DEVIATIONS = [
  {
    id: 'org-empty-block-corrupt',
    reason: 'Emacs 29.3 writes "nil" in front of the closing line of an empty drawer, quote block or dynamic block (a defect); the app writes the closing line alone',
    matches: ({ backend, name }) => backend === 'orgx' && ['head-drawer-empty', 'block-quote-empty', 'block-dynamic-block'].includes(name),
  },
  {
    id: 'org-src-tab-indent',
    reason: 'Emacs mixes tabs and spaces when it removes the common indentation of a source block whose lines begin with tabs (org-remove-indentation counts a tab as 8 columns but writes back columns); the app expands tabs and indents by two',
    matches: ({ backend, name }) => backend === 'orgx' && name === 'block-src-tab',
  },
  {
    id: 'org-crlf',
    reason: 'the app reads a file with CRLF line ends as LF; Emacs keeps the carriage returns in its output',
    matches: ({ backend, name }) => backend === 'orgx' && name === 'doc-crlf',
  },
];
/** @param {string} id @param {Record<string, string[]>} byBackend */
const rule = (id, byBackend) => ({ id, reason: REASONS[id], matches: (/** @type {{ backend: string, name: string }} */ c) => (byBackend[c.backend] || []).includes(c.name) });
const REASONS = {
  "table-el": "chosen: table.el tables cannot work in the app (Emacs converts them with table.el)",
  "cannot-work": "chosen: bbdb:, info: and rmail: links cannot work in the app",
  "crlf-bom": "a file with CRLF line ends or a byte-order mark: the parser strips them on reading; keeping them would corrupt every headline and title",
  "src-tab": "tab-indented source block: Emacs output is irregular (indentation removal depends on the line mix) and cannot be modelled consistently",
  "src-org-lang": "Emacs quirk: a heading inside an org source block is parsed as a heading",
  "nil-bug": "Emacs bug: an empty quote block prints a stray \"nil\"; the app keeps its behaviour",
  "env-home": "a ~/ file link expands to the home directory of the machine that generated the fixture",
  "unicode-space": "Emacs quirk with Unicode spaces (nbsp, escaped entity) in indentation",
  "inline-src-babel": "the fixture was made without babel processing, where inline source code is printed; the app follows Emacs with org-export-use-babel on (the default, fixture gap-inline-src), where :exports results (the default) prints nothing",
  "open": "open: output differs from Emacs and is not yet fixed"
};
KNOWN_DEVIATIONS.push(
  rule("unicode-space", {"ascii":["inline-115"],"utf8":["inline-029","inline-115"]}),
  rule("table-el", {"ascii":["table-table-el"],"utf8":["table-table-el"],"html":["table-table-el"],"latex":["table-table-el"]}),
  rule("src-tab", {"ascii":["block-src-tab"],"utf8":["block-src-tab"],"html":["block-src-tab"],"latex":["block-src-tab"]}),
  rule("src-org-lang", {"ascii":["block-src-org-lang"],"utf8":["block-src-org-lang"],"html":["block-src-org-lang"],"latex":["block-src-org-lang"]}),
  rule("env-home", {"html":["inline-074"],"latex":["inline-074"]}),
  rule("nil-bug", {"html":["block-quote-empty"],"latex":["block-quote-empty"]}),
  rule("crlf-bom", {"html":["doc-crlf"],"latex":["doc-crlf","doc-bom"]}),
  rule("inline-src-babel", {"latex":["inline-092","block-inline-src-latex"]}),
  rule("cannot-work", {"latex":["link-link-info","link-link-rmail","link-link-bbdb"]}),
);
