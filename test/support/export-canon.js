// Reads the parts of an export that Emacs and the app both define the same way (test/oracle-export.test.js).

/** Renumbers Org's random reference hashes (org + 7 hex digits) by first use, so equal links stay equal. @param {string} s */
export function renumberRefs(s) {
  const ids = new Map();
  return s.replace(/org[0-9a-f]{7}/g, (id) => {
    if (!ids.has(id)) ids.set(id, 'org' + String(ids.size + 1).padStart(3, '0'));
    return /** @type {string} */ (ids.get(id));
  });
}

const STABLE_ID = /^(content|table-of-contents|text-table-of-contents|postamble|preamble|text-\d+|fn\.\d+|fnr\.\d+(\.\d+)?|footnotes|footnotedef)$/;

/** Renumbers every anchor name Org makes up (its are random hashes, the app's readable) by first use, so equal anchors stay equal. @param {string} html */
export function renumberAnchors(html) {
  const ids = new Map();
  const name = (/** @type {string} */ ref) => {
    if (!ids.has(ref)) ids.set(ref, 'ref' + String(ids.size + 1).padStart(3, '0'));
    return ids.get(ref);
  };
  return html.replace(/\b(id|for|name)="([^"]*)"|\bhref="#([^"]*)"/g, (m, attr, value, hash) => {
    if (hash !== undefined) return STABLE_ID.test(hash) ? m : `href="#${name(hash)}"`;
    if (STABLE_ID.test(value)) return m;
    const prefix = /^(outline-container-)/.exec(value);
    return prefix ? `${attr}="${prefix[1]}${name(value.slice(prefix[1].length))}"` : `${attr}="${name(value)}"`;
  });
}

/** The page body: from the content container up to the postamble (Emacs's head, styles and scripts are tested elsewhere). @param {string} html */
export function htmlContent(html) {
  const i = html.indexOf('<div id="content"');
  let h = i < 0 ? html : html.slice(i);
  const end = h.search(/<div id="postamble"|<\/body>/);
  if (end >= 0) h = h.slice(0, end);
  h = h.replace(/<script>[\s\S]*?<\/script>\s*/g, '');
  // the app colours source code (spans of class org-*); Emacs without htmlize does not
  for (let before = ''; before !== h;) {
    before = h;
    h = h.replace(/<span class="org-[a-z-]+">([^<]*)<\/span>/g, '$1');
  }
  // blank lines and trailing blanks carry no meaning in HTML (Emacs leaves them in odd places)
  return renumberAnchors(h).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l).join('\n') + '\n';
}

/** What lies between \begin{document} and \end{document}. @param {string} tex */
export function latexBody(tex) {
  const i = tex.indexOf('\\begin{document}');
  const j = tex.lastIndexOf('\\end{document}');
  return renumberRefs(i < 0 ? tex : tex.slice(i, j < 0 ? undefined : j + '\\end{document}'.length)) + '\n';
}

/** @param {string} s */
export const straightQuotes = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
