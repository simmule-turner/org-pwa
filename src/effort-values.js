/**
 * Effort_ALL: the list of allowed effort values Emacs offers when setting
 * an effort (org-set-effort completes against it) and when filtering the
 * agenda by effort. Where Org looks for it, most specific first:
 *
 *   1. an `Effort_ALL` property on the heading itself, or the nearest
 *      ancestor that has one (it's inherited);
 *   2. the file's `#+PROPERTY: Effort_ALL 0 0:10 0:30 1:00 ...` line;
 *   3. the global setting -- here `org-global-properties`, a line such as
 *      `Effort_ALL: 0 0:10 0:30 1:00 2:00; OTHER: x` (semicolon-separated
 *      NAME: VALUE entries; only Effort_ALL is used).
 *
 * The first of those that yields at least one usable value wins. Values
 * are whitespace-separated and each must be a valid org duration (see
 * org-duration.js) -- anything else is skipped, so every value offered is
 * one the effort prompt would accept.
 *
 * When nothing defines it there is simply no list, and the effort prompt
 * stays plain free text; the agenda's effort filter falls back on the
 * default set org-agenda-filter-by-effort itself uses.
 */

import { getProperty, findAncestorPath } from './archive-model.js';
import { parseOrgDuration } from './org-duration.js';

const PROPERTY_NAME = 'Effort_ALL';

/** org-agenda-filter-by-effort's own fallback when Effort_ALL isn't set. */
const DEFAULT_EFFORT_FILTER_VALUES = ['0', '0:10', '0:30', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00'];

/** The valid, de-duplicated values in `text`, in order. */
function parseEffortValues(text) {
  const seen = new Set();
  const values = [];
  for (const token of String(text == null ? '' : text).split(/\s+/)) {
    if (token === '' || seen.has(token) || parseOrgDuration(token) === null) continue;
    seen.add(token);
    values.push(token);
  }
  return values;
}

/** `org-global-properties` text -> { lowercased name: value string }. */
function parseGlobalProperties(text) {
  const result = {};
  for (const entry of String(text == null ? '' : text).split(';')) {
    const colon = entry.indexOf(':');
    if (colon === -1) continue;
    const name = entry.slice(0, colon).trim().toLowerCase();
    if (name && !(name in result)) result[name] = entry.slice(colon + 1).trim();
  }
  return result;
}

/**
 * The allowed effort values that apply to `heading` (which may be null,
 * for the file-wide list). `globalProperties` is the raw
 * org-global-properties text.
 */
function getAllowedEffortValues({ doc, heading = null, globalProperties = '' } = {}) {
  const candidates = [];
  if (doc && heading) {
    const ancestors = findAncestorPath(doc, heading) || [];
    for (const node of [heading, ...[...ancestors].reverse()]) candidates.push(getProperty(node, PROPERTY_NAME));
  }
  if (doc) {
    for (const keyword of doc.keywords || []) {
      if (String(keyword.key).toUpperCase() !== 'PROPERTY') continue;
      const m = /^\s*(\S+)\s+([\s\S]*)$/.exec(String(keyword.value == null ? '' : keyword.value));
      if (m && m[1].toLowerCase() === PROPERTY_NAME.toLowerCase()) candidates.push(m[2]);
    }
  }
  candidates.push(parseGlobalProperties(globalProperties)[PROPERTY_NAME.toLowerCase()]);

  for (const raw of candidates) {
    const values = parseEffortValues(raw);
    if (values.length > 0) return values;
  }
  return [];
}

export { PROPERTY_NAME, DEFAULT_EFFORT_FILTER_VALUES, parseEffortValues, parseGlobalProperties, getAllowedEffortValues };
