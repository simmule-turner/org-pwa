// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
// Links that point at nothing, as Org's exporter treats them (`org-export-with-broken-links`): `nil` stops the export with
// "Unable to resolve link: ...", `t` leaves the link out, `mark` writes "[BROKEN LINK: path]" in its place.
import { resolveLinkTarget } from './link-resolve.js';
import { collectTargets, normalizeTargetName } from './targets.js';

/** @typedef {'nil' | 't' | 'mark'} BrokenLinks */

/**
 * @param {unknown} value  a variable or #+OPTIONS: value (a leading quote is fine)
 * @param {BrokenLinks | null} fallback
 * @returns {BrokenLinks | null}
 */
export function parseBrokenLinks(value, fallback = 'nil') {
  const v = String(value ?? '').trim().replace(/^'/, '').toLowerCase();
  return v === 'nil' || v === 't' || v === 'mark' ? v : fallback;
}

/** Lisp's `%S` of a string. @param {string} s */
const lispQuote = (s) => '"' + s.replace(/[\\"]/g, '\\$&') + '"';

/** @type {WeakMap<object, Set<string>>} */
const targetNames = new WeakMap();

/** @param {Doc} doc */
function targetsOf(doc) {
  let names = targetNames.get(doc);
  if (!names) {
    names = new Set(collectTargets(doc).map((t) => normalizeTargetName(t.name)));
    targetNames.set(doc, names);
  }
  return names;
}

/**
 * The path Org reports for a link known to lead nowhere, or null for a kind of link Org does not check (URLs, files).
 * @param {string} target
 * @returns {string | null}
 */
export function brokenPathOf(target) {
  const t = target.trim();
  if (/^\(.*\)$/.test(t)) return t.slice(1, -1);
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^id:/i.test(t)) return null;
  if (/^(\.{0,2}\/|~\/)/.test(t)) return null;
  return /^id:/i.test(t) ? t.slice(3) : t.startsWith('#') ? t.slice(1) : t;
}

/**
 * The path Org reports for a link that leads nowhere, or null when the link is fine (or not one Org checks: URLs, files,
 * code references, which the caller handles). A heading link reports the link as typed, a custom id or id link its id.
 * @param {Doc} doc
 * @param {string} target  the link as typed
 * @param {(name: string) => boolean} [isNamed]  whether a `#+NAME:` element has this name
 * @returns {string | null}
 */
export function brokenLinkPath(doc, target, isNamed = () => false) {
  const t = target.trim();
  if (/^\(.*\)$/.test(t)) return null;
  const path = brokenPathOf(t);
  if (path === null || resolveLinkTarget(doc, t).type === 'heading') return null;
  if (/^id:|^#|^\*/i.test(t)) return path;
  return targetsOf(doc).has(normalizeTargetName(t)) || isNamed(t) ? null : path;
}

/**
 * What stands in for a link that leads nowhere: the text "[BROKEN LINK: path]" (mark) or nothing (t). Stops the export
 * with Org's message for nil.
 * @param {BrokenLinks} mode
 * @param {string} path
 * @param {boolean} [marker]  for t: a marker that `finishDropped` removes later, rather than nothing
 * @returns {string}  the text, still to be escaped for the output format
 */
export function brokenLinkText(mode, path, marker = true) {
  if (mode === 'nil') throw new Error(`Unable to resolve link: ${lispQuote(path)}`);
  return mode === 'mark' ? `[BROKEN LINK: ${path}]` : marker ? DROPPED : '';
}

/** Stands where a link was left out, until `finishDropped` removes it with the blanks that followed the link. */
const DROPPED = '\uE000';

/**
 * Org gives a link the blanks after it (its post-blank), so a link that is left out takes them along.
 * @param {string} text
 */
export function finishDropped(text) {
  return text.includes(DROPPED) ? text.replace(/\uE000[ \t]*/g, '') : text;
}

/** A broken link found by a part of an exporter that works outside the link itself; the enclosing element is replaced. */
export class BrokenLinkSignal extends Error {
  /** @param {string} path */
  constructor(path) {
    super(`Unable to resolve link: ${lispQuote(path)}`);
    this.path = path;
  }
}
