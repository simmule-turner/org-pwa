/**
 * org-xx-extra-menu: a floating (☰) button's own configurable quick-
 * action menu. Not a real org-mode variable -- this app's own
 * extension, using the same Global/Local Variables mechanism every
 * other setting here does.
 *
 * Value format: a sequence of double-quoted tokens (whitespace-
 * separated), each either the five-hyphen separator marker
 * ("-----") or a "SPEC;LABEL" pair:
 *
 *   org-xx-extra-menu: "t;⭐ Tracking" "j;📔 Journal" "-----" "'org-clock-out;⏹ clock-out"
 *
 * (Typically spread across several physical lines via a trailing
 * "\" for readability -- see global-variables.js's own
 * joinContinuedLines, which already reconstructs this into one
 * logical value before it ever reaches this parser.)
 *
 * SPEC is one of:
 *   - A bare capture-template key (e.g. "t", "j", "c") -- selecting
 *     this menu item runs that capture template, exactly as if it had
 *     been picked from the regular Capture menu.
 *   - A bracketed array of double-quoted strings (e.g.
 *     ["Journal", "%<%Y-%m>"]) -- real capture-template olp: syntax,
 *     including %<FORMAT> strftime-style placeholders, resolved at
 *     SELECTION time (not parse time, since the format needs "now" as
 *     it actually is when tapped, not when the config was parsed).
 *     Selecting this menu item navigates to that heading, creating it
 *     first if it doesn't already exist (the same resolveOlpTarget
 *     capture templates themselves already use).
 *   - A quoted-symbol function reference (e.g. 'org-clock-out) --
 *     selecting this menu item runs that built-in function directly.
 *     org-clock-out, org-clock-cancel, org-xx-calendar (not a real
 *     org-mode function -- this app's own single-month calendar
 *     overview, see app.js's own openCalendarPanel), and
 *     org-table-recalculate-buffer-tables (real org's own actual,
 *     distinct command -- confirmed directly against the Org Manual:
 *     recalculating just the CURRENT table is C-c C-c / C-u C-c C-c
 *     instead, a completely separate command, which has its own
 *     per-table Calc button on every table here instead of a menu
 *     entry, since there's no "current table" this app could mean
 *     without a cursor/point concept the way Emacs has one -- this
 *     one recalculates every #+TBLFM: formula in every table in the
 *     whole document, see app.js's own dispatch for the full
 *     behavior), and org-cut-subtree / org-paste-subtree (the same
 *     C-c C-x C-w / C-c C-x C-y god-mode commands, run against
 *     whichever heading's own per-row action menu is currently open
 *     -- the touch-native way to designate a specific heading without
 *     a keyboard at all -- falling back to whichever heading is
 *     currently keyboard-focused if no action menu is open; a status
 *     message says so if neither is set, rather than doing nothing
 *     silently) are recognized today; more may be added later,
 *     so an unrecognized function name is treated as a malformed
 *     entry (skipped) rather than a hard parse error, the same
 *     forward-compatible tolerance every other "recognized subset"
 *     parser in this codebase already has.
 *
 * LABEL is the display text shown for the menu item -- whatever
 * follows the FIRST top-level (bracket-depth-0) semicolon, kept
 * exactly as written (including any emoji/icon prefix the person
 * chose to put there).
 */

const KNOWN_FUNCTIONS = new Set([
  'org-clock-out',
  'org-clock-cancel',
  'org-xx-calendar',
  'org-table-recalculate-buffer-tables',
  'org-cut-subtree',
  'org-paste-subtree',
]);
const SEPARATOR_TOKEN = '-----';

/** Splits the raw, already-line-joined org-xx-extra-menu value into its
 *  individual double-quoted tokens -- tracking `[`/`]` bracket depth
 *  so an embedded double-quote inside an OLP array (each header
 *  string is itself quoted) doesn't prematurely end the outer token.
 *  A stray, unquoted character between tokens (extra whitespace, a
 *  typo) is simply skipped rather than erroring. */
function tokenize(raw) {
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i++;
      continue;
    }
    if (raw[i] !== '"') {
      i++; // skip anything outside a token -- tolerant of stray characters
      continue;
    }
    i++; // consume the opening quote
    let content = '';
    let depth = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '[') {
        depth++;
        content += ch;
        i++;
      } else if (ch === ']') {
        depth = Math.max(0, depth - 1);
        content += ch;
        i++;
      } else if (ch === '"' && depth === 0) {
        i++; // consume the closing quote
        break;
      } else {
        content += ch;
        i++;
      }
    }
    tokens.push(content);
  }
  return tokens;
}

/** Splits one token's content into { spec, label } at the FIRST
 *  bracket-depth-0 semicolon -- a semicolon inside an OLP array
 *  (there generally isn't one, but this stays correct either way)
 *  doesn't count as the separator. Returns null if there's no
 *  top-level semicolon at all (a malformed entry, missing its own
 *  label). */
function splitSpecAndLabel(token) {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      return { spec: token.slice(0, i).trim(), label: token.slice(i + 1).trim() };
    }
  }
  return null;
}

/** Parses a SPEC string into its typed form, or null if it doesn't
 *  match any recognized shape. */
function parseSpec(spec) {
  if (spec.startsWith('[')) {
    let headers;
    try {
      headers = JSON.parse(spec);
    } catch {
      return null;
    }
    if (!Array.isArray(headers) || !headers.every((h) => typeof h === 'string')) return null;
    return { type: 'olp', headers };
  }
  const functionMatch = /^'([A-Za-z][A-Za-z0-9_-]*)$/.exec(spec);
  if (functionMatch) {
    const name = functionMatch[1];
    return KNOWN_FUNCTIONS.has(name) ? { type: 'function', name } : null;
  }
  if (/^[A-Za-z0-9]+$/.test(spec)) {
    return { type: 'capture', key: spec };
  }
  return null;
}

/**
 * Parses org-xx-extra-menu's full raw value into an ordered list of menu
 * entries: `{ type: 'separator' }` or
 * `{ type: 'capture' | 'olp' | 'function', label, ... }`. A token that
 * doesn't parse cleanly (malformed spec, missing label, unrecognized
 * function name) is silently skipped rather than aborting the whole
 * menu -- one bad entry shouldn't take out every other one. An
 * unset/empty value returns an empty array, not an error.
 */
function parseExtraMenu(text) {
  if (!text || !text.trim()) return [];
  const entries = [];
  for (const token of tokenize(text)) {
    if (token === SEPARATOR_TOKEN) {
      entries.push({ type: 'separator' });
      continue;
    }
    const split = splitSpecAndLabel(token);
    if (!split || !split.label) continue;
    const spec = parseSpec(split.spec);
    if (!spec) continue;
    entries.push({ ...spec, label: split.label });
  }
  return entries;
}

export { parseExtraMenu, KNOWN_FUNCTIONS };
