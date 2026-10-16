// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
// What the text exporters (Markdown, ASCII, ODT) need to treat internal links as Org does: each exported heading's section
// number, where each `<<target>>` is, and the pattern for a radio target's plain mentions. (HTML export has its own.)
import { resolveLinkTarget } from './link-resolve.js';
import { collectTargets, normalizeTargetName, radioTargetRegExp } from './targets.js';

/** @typedef {{
 *   numbers: Map<Heading, string>, targets: Map<string, { id: string, heading: Heading }>, radioRe: RegExp | null,
 *   numbered: boolean, doc: Doc
 * }} LinkContext */

/** @param {string} name */
function targetAnchor(name) {
  return 'org-target-' + (normalizeTargetName(name).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x');
}

/**
 * @param {Doc} doc
 * @param {Heading[]} roots  the headings being exported
 * @param {boolean} numbered  whether the export numbers its sections
 * @returns {LinkContext}
 */
export function buildLinkContext(doc, roots, numbered) {
  /** @type {Map<Heading, string>} */ const numbers = new Map();
  /** @param {Heading[]} headings @param {number[]} prefix */
  const number = (headings, prefix) => {
    headings.filter((h) => h.type === 'heading').forEach((h, i) => {
      const path = [...prefix, i + 1];
      numbers.set(h, path.join('.'));
      number(h.children || [], path);
    });
  };
  number(roots, []);
  /** @type {LinkContext['targets']} */ const targets = new Map();
  const used = new Set();
  for (const t of collectTargets(doc)) {
    const key = normalizeTargetName(t.name);
    if (targets.has(key) || !numbers.has(t.heading)) continue;
    let id = targetAnchor(t.name);
    for (let n = 2; used.has(id); n++) id = targetAnchor(t.name) + '-' + n;
    used.add(id);
    targets.set(key, { id, heading: t.heading });
  }
  return { numbers, targets, radioRe: targets.size ? radioTargetRegExp(doc) : null, numbered, doc };
}

/** The anchor id for a target the export knows.
 * @param {LinkContext} ctx
 * @param {string} name */
export function anchorFor(ctx, name) {
  const hit = ctx.targets.get(normalizeTargetName(name));
  return hit ? hit.id : targetAnchor(name);
}

/**
 * Where an internal link goes and what it reads as when it has no description, as Org does it: a heading's section number
 * (its title when sections are not numbered), and for a target the number of the section it is in ("No description for this
 * link" when sections are not numbered). Null when the link is not to a heading or target in this export.
 * @param {LinkContext} ctx
 * @param {string} rawTarget
 * @returns {{ heading: Heading | null, anchor: string | null, label: string | null } | null}  label null: use the heading's title
 */
export function internalLink(ctx, rawTarget) {
  const t = rawTarget.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^id:/i.test(t)) return null;
  const key = normalizeTargetName(t.replace(/^#/, ''));
  if (!t.startsWith('*') && !t.startsWith('#')) {
    const hit = ctx.targets.get(key);
    if (hit) return { heading: hit.heading, anchor: hit.id, label: ctx.numbered ? ctx.numbers.get(hit.heading) || null : 'No description for this link' };
  }
  const res = resolveLinkTarget(ctx.doc, t);
  if (res.type === 'heading' && ctx.numbers.has(res.heading)) {
    return { heading: res.heading, anchor: null, label: ctx.numbered ? ctx.numbers.get(res.heading) || null : null };
  }
  return null;
}
