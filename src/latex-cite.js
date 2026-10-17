// @ts-check
/**
 * Citations for `#+CITE_EXPORT: natbib` and `biblatex`: which command a citation becomes and where its prefix and suffix go,
 * chosen the way Org's oc-natbib and oc-biblatex choose (test/fixtures/latex/cite-natbib.org and cite-biblatex.org hold
 * Emacs's own output). Other processors (basic, plain ...) print text and are handled by the exporter itself.
 */

/** @typedef {import('./cite.js').CitationNode} CitationNode */

/** The `[cite/style/variant:...]` part, as [style, variant] with null for a missing one. @param {string | null} style @returns {[string | null, string | null]} */
function splitStyle(style) {
  const [name, variant] = (style || '').split('/');
  return [name || null, variant || null];
}

/**
 * Org's natbib command names for a style and variant (a short or a long name is accepted for each).
 * @param {string | null} style
 */
export function natbibCommand(style) {
  const [name, variant] = splitStyle(style);
  const is = (/** @type {string[]} */ ...names) => variant !== null && names.includes(variant);
  if (name === 'author' || name === 'a') return is('caps', 'c') ? '\\Citeauthor' : is('full', 'f') ? '\\citeauthor*' : '\\citeauthor';
  if (name === 'noauthor' || name === 'na') return is('bare', 'b') ? '\\citeyear' : '\\citeyearpar';
  if (name === 'nocite' || name === 'n') return '\\nocite';
  const table = /** @type {Record<string, string>} */ (name === 'text' || name === 't' ? { bare: 'citealt', b: 'citealt', caps: 'Citet', c: 'Citet', full: 'citet*', f: 'citet*', 'bare-caps': 'Citealt', bc: 'Citealt', 'bare-full': 'citealt*', bf: 'citealt*', 'caps-full': 'Citet*', cf: 'Citet*', 'bare-caps-full': 'Citealt*', bcf: 'Citealt*' } : { bare: 'citealp', b: 'citealp', caps: 'Citep', c: 'Citep', full: 'citep*', f: 'citep*', 'bare-caps': 'Citealp', bc: 'Citealp', 'bare-full': 'citealp*', bf: 'citealp*', 'caps-full': 'Citep*', cf: 'Citep*', 'bare-caps-full': 'Citealp*', bcf: 'Citealp*' });
  return '\\' + ((variant && table[variant]) || (name === 'text' || name === 't' ? 'citet' : 'citep'));
}

/**
 * The citation as natbib: one command, the main prefix and suffix as optional arguments, every key in one argument.
 * With one reference its own prefix and suffix are the main ones; with several, the citation's own.
 * @param {CitationNode} node @param {(text: string) => string} text renders and trims a prefix or suffix
 */
export function natbibCitation(node, text) {
  const single = node.refs.length === 1 ? node.refs[0] : null;
  const prefix = (single ? single.prefix : node.prefix) || '';
  const suffix = (single ? single.suffix : node.suffix) || '';
  const optional = (prefix ? '[' + text(prefix) + ']' : '') + (suffix ? '[' + text(suffix) + ']' : prefix ? '[]' : '');
  return natbibCommand(node.style) + optional + '{' + node.refs.map((r) => r.key).join(',') + '}';
}

/** Org's `org-cite-biblatex-styles`: [style, variant, command, multi-command, no-optional-arguments]. */
const BIBLATEX_STYLES = /** @type {[string | null, string | null, string, string | null, boolean][]} */ ([
  ['author', 'caps', 'Citeauthor*', null, false],
  ['author', 'full', 'citeauthor', null, false],
  ['author', 'caps-full', 'Citeauthor', null, false],
  ['author', null, 'citeauthor*', null, false],
  ['locators', 'bare', 'notecite', null, false],
  ['locators', 'caps', 'Pnotecite', null, false],
  ['locators', 'bare-caps', 'Notecite', null, false],
  ['locators', null, 'pnotecite', null, false],
  ['noauthor', 'bare', 'cite*', null, false],
  ['noauthor', null, 'autocite*', null, false],
  ['nocite', null, 'nocite', null, true],
  ['text', 'caps', 'Textcite', 'Textcites', false],
  ['text', null, 'textcite', 'textcites', false],
  [null, 'bare', 'cite', 'cites', false],
  [null, 'caps', 'Autocite', 'Autocites', false],
  [null, 'bare-caps', 'Cite', 'Cites', false],
  [null, null, 'autocite', 'autocites', false],
]);

const SHORTCUTS = /** @type {Record<string, string>} */ ({ a: 'author', b: 'bare', bc: 'bare-caps', c: 'caps', cf: 'caps-full', f: 'full', l: 'locators', n: 'nocite', na: 'noauthor', t: 'text' });

/**
 * The citation as biblatex. Several references with notes of their own become a multicite command (`\autocites`).
 * @param {CitationNode} node @param {(text: string) => string} text
 */
export function biblatexCitation(node, text) {
  const [rawName, rawVariant] = splitStyle(node.style);
  const name = rawName && (SHORTCUTS[rawName] || rawName);
  const variant = rawVariant && (SHORTCUTS[rawVariant] || rawVariant);
  /** @type {typeof BIBLATEX_STYLES} */
  let candidates = [];
  let named = false;
  for (const entry of BIBLATEX_STYLES) {
    if (entry[0] === name && entry[1] === variant) {
      candidates = [entry];
      break;
    }
    if (entry[0] === null && entry[1] === null) {
      if (!candidates.length) candidates.unshift(entry);
    } else if (entry[0] === name && entry[1] === null) {
      candidates.unshift(entry);
      named = true;
    } else if (entry[0] === null && entry[1] === variant && !named) candidates.unshift(entry);
  }
  const [, , command, multi, noOptional] = candidates[0];
  const atomic = (/** @type {import('./cite.js').CiteRef[]} */ refs, /** @type {{ prefix: string, suffix: string }} */ origin, /** @type {boolean} */ bare) => {
    const keys = '{' + refs.map((r) => r.key).join(',') + '}';
    if (bare) return keys;
    return (origin.prefix ? '[' + text(origin.prefix) + ']' : '') + (origin.suffix ? '[' + text(origin.suffix) + ']' : origin.prefix ? '[]' : '') + keys;
  };
  const useMulti = !!multi && node.refs.length > 1 && node.refs.some((r) => r.prefix || r.suffix);
  if (useMulti) {
    const global = (node.prefix ? '(' + text(node.prefix) + ')' : '') + (node.suffix ? '(' + text(node.suffix) + ')' : node.prefix ? '()' : '');
    return '\\' + multi + global + node.refs.map((r) => atomic([r], r, false)).join('');
  }
  return '\\' + command + atomic(node.refs, node.refs.length === 1 ? node.refs[0] : node, noOptional);
}
