
/**
 * Generic pretty-print / canonicalize helpers for any Global/Local
 * Variable whose value is a flat, space-separated sequence of
 * double-quoted entries -- org-xx-extra-menu and org-xx-menu-aliases
 * both fit this shape. Neither function knows anything about either
 * variable's own specific syntax; both take a `tokenizeFn` (whichever
 * of extra-menu.js's own tokenize / menu-alias.js's own
 * tokenizeMenuAliasValue actually owns that variable's own notion of
 * "where one entry ends and the next begins"), so this always agrees
 * with how the value would actually be parsed at runtime rather than
 * being a second, independent splitting rule that could drift out of
 * sync with the real one.
 */

/** Reformats a flat, single-line multi-entry value into one
 *  double-quoted entry per line, each ending in a trailing backslash
 *  except the last -- purely a DISPLAY transform, easier to read/edit
 *  than one long run-on line, matching the file-based Local Variables
 *  line-continuation convention already documented for this syntax. */
function multiEntryValueToDisplayText(rawValue, tokenizeFn) {
  if (!rawValue) return '';
  const tokens = tokenizeFn(rawValue);
  return tokens.map((t) => `"${t}"`).join(' \\\n');
}

/** The inverse: re-tokenizes whatever's actually in the edit box --
 *  however it's currently formatted, multi-line with backslashes, a
 *  single run-on line, or anything else the tokenizer itself already
 *  tolerates -- and rebuilds the canonical, flat, single-line form
 *  that's actually stored. Committing this CANONICAL string, rather
 *  than the raw edited text directly, is what keeps the value stable
 *  across a reload: storage never again contains an embedded newline
 *  for something else to collapse later. */
function multiEntryDisplayTextToValue(displayText, tokenizeFn) {
  const tokens = tokenizeFn(displayText);
  return tokens.map((t) => `"${t}"`).join(' ');
}

export { multiEntryValueToDisplayText, multiEntryDisplayTextToValue };
