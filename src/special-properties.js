// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
// The special properties `org-entry-get` answers from the entry itself: `$PROP_ITEM`, `$PROP_TODO`, `$PROP_DEADLINE` ... in a table formula.
import { inheritedProperty } from './babel-args.js';

/**
 * The value of a special property of `heading`; undefined for a name that is not special, null when the entry has none (no deadline, no todo keyword).
 * @param {Doc} doc @param {Heading[]} chain the headings from the top one down to the one the table is in @param {string} name
 * @returns {string | null | undefined}
 */
export function specialProperty(doc, chain, name) {
  const heading = chain[chain.length - 1];
  if (!heading) return undefined;
  const own = (/** @type {string | null | undefined} */ v) => (v ? v : null);
  switch (name) {
    case 'ITEM': return own(heading.title);
    case 'TODO': return own(heading.todo);
    case 'PRIORITY': return own(heading.priority);
    case 'TAGS': return heading.tags && heading.tags.length ? `:${heading.tags.join(':')}:` : null;
    case 'ALLTAGS': {
      /** @type {string[]} */ const all = [];
      for (const h of chain) for (const t of h.tags || []) if (!all.includes(t)) all.push(t);
      return all.length ? `:${all.join(':')}:` : null;
    }
    case 'DEADLINE': return own(heading.planning && heading.planning.deadline);
    case 'SCHEDULED': return own(heading.planning && heading.planning.scheduled);
    case 'CLOSED': return own(heading.planning && heading.planning.closed);
    case 'CATEGORY': {
      const set = inheritedProperty(doc, chain, 'CATEGORY');
      if (set !== null && set !== undefined) return set;
      const kw = ((doc && doc.keywords) || []).filter((k) => String(k.key).toUpperCase() === 'CATEGORY').pop();
      return kw ? String(kw.value).trim() : null;
    }
    default: return undefined;
  }
}

/** `(org-entry-get nil NAME 'inherit)`: the special property when NAME is one, else the property with its inheritance. @param {Doc} doc @param {Heading[]} chain @param {string} name @returns {string | null} */
export function entryProperty(doc, chain, name) {
  const special = specialProperty(doc, chain, name);
  return special !== undefined ? special : inheritedProperty(doc, chain, name);
}
