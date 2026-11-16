// @ts-check
/**
 * `org-fold-show-context-detail` and `org-fold-show-set-visibility`: how much of the outline opens around a heading something jumped to.
 * A folded heading hides its children and text together here, so showing an entry also shows its children's headings, and a heading
 * cannot be shown without its siblings.
 */
import { findAncestorPath } from './archive-model.js';
import { expandFully } from './fold-state.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {'minimal' | 'local' | 'ancestors' | 'ancestors-full' | 'lineage' | 'tree' | 'canonical'} ContextDetail */

const DETAILS = new Set(['minimal', 'local', 'ancestors', 'ancestors-full', 'lineage', 'tree', 'canonical']);
const DEFAULT_DETAILS = new Map([['agenda', 'local'], ['bookmark-jump', 'lineage'], ['isearch', 'lineage'], ['default', 'ancestors']]);

/**
 * The detail for a context: the variable is a symbol (every context), nil (minimal), t (canonical) or an alist of contexts.
 * @param {string | undefined} raw the variable as Lisp text @param {string} context `agenda`, `org-goto`, `isearch`...
 * @returns {ContextDetail}
 */
export function contextDetail(raw, context) {
  const asDetail = (/** @type {string} */ s) => (s === 'nil' ? 'minimal' : s === 't' ? 'canonical' : DETAILS.has(s) ? /** @type {ContextDetail} */ (s) : null);
  const text = (raw ?? '').trim().replace(/^'/, '');
  if (text === '') return /** @type {ContextDetail} */ (DEFAULT_DETAILS.get(context) ?? DEFAULT_DETAILS.get('default'));
  const plain = asDetail(text);
  if (plain) return plain;
  const pairs = new Map([...text.matchAll(/\(\s*([\w-]+)\s*\.\s*([\w-]+)\s*\)/g)].map((m) => [m[1], m[2]]));
  const named = asDetail(pairs.get(context) ?? pairs.get('default') ?? 'ancestors');
  return named ?? 'ancestors';
}

/**
 * org-fold-show-set-visibility around `heading`.
 * @param {Doc} doc @param {Heading} heading @param {ContextDetail} detail @param {boolean} [onHeadline] whether the place is the heading itself, not its text
 */
export function showContext(doc, heading, detail, onHeadline = true) {
  const ancestors = findAncestorPath(doc, heading) || [];
  if (!onHeadline || detail === 'local') {
    heading.collapsed = false;
    heading.bodyHidden = false;
    heading.drawersHidden = false;
  }
  if (detail === 'tree' || detail === 'canonical') heading.collapsed = false;
  if (detail === 'ancestors-full') expandFully(heading);
  for (const ancestor of ancestors) {
    ancestor.collapsed = false;
    if (detail === 'canonical') {
      ancestor.bodyHidden = false;
      ancestor.drawersHidden = false;
    }
  }
}
