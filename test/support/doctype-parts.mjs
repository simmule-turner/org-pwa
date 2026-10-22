// The parts of a page that #+HTML_DOCTYPE: controls, read the same way from Emacs's page and ours.
export const DOCTYPE_NAMES = ['html4-strict', 'html4-transitional', 'html4-frameset', 'xhtml-strict', 'xhtml-transitional', 'xhtml-frameset', 'xhtml-11', 'html5', 'xhtml5'];

/** @param {string} html */
export function doctypeParts(html) {
  const head = html.slice(0, html.indexOf('<head>')).trimEnd();
  const tags = (/** @type {RegExp} */ re) => [...new Set((html.match(re) || []).map((t) => t.replace(/\s+/g, ' ')))].sort();
  return {
    head,
    contentType: (/<meta (?:charset|http-equiv)[^>]*>/.exec(html) || [''])[0],
    br: tags(/<br ?\/?>/g),
    hr: tags(/<hr ?\/?>/g),
    img: tags(/<img [^>]*?(?: \/)?>/g).map((t) => t.replace(/ alt="[^"]*"/, '')),
    col: tags(/<col[^>]*>/g).map((t) => t.replace(/ class="[^"]*"/, '').replace(/\s+/g, ' ')),
    table: tags(/<table[^>]*>/g).map((t) => t.replace(/ id="[^"]*"/, '')),
  };
}
