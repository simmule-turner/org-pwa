/**
 * Parses one of the four menu-alias variables' own value into a
 * lookup table: `org-xx-file-menu`, `org-xx-more-menu`, `org-xx-export-menu`,
 * `org-xx-view-menu` -- not real org-mode variables; this app's own
 * extension, using the same Global/Local Variables mechanism
 * org-extra-menu already established a precedent for.
 *
 * Value format: a sequence of double-quoted `"Label;alias"` entries,
 * space-separated (optionally spread across multiple physical lines
 * with a trailing `\`, same line-continuation mechanism every other
 * multi-entry Global/Local Variable already uses):
 *
 *   org-xx-file-menu: "New;➕" "Open;📂" "Save;💾" "Save As;💾➕" "Export;↗️"
 *
 * `Label` is one of this menu's own real, built-in button labels
 * (e.g. "New", "Save As" for org-xx-file-menu) -- an entry for a label
 * that doesn't actually exist in that menu is simply never looked up
 * by anything and has no effect, the same tolerant-of-the-unexpected
 * approach every other "recognized subset" parser in this codebase
 * already takes, rather than a hard validation error.
 *
 * `alias`, after the semicolon, has two meanings depending on whether
 * it's present:
 *   - Non-empty: the button's default label text is REPLACED with this
 *     alias wherever it's displayed (the button still does exactly the
 *     same thing; only what's written on it changes). The original
 *     label becomes that button's accessible name (aria-label/title)
 *     instead, so screen readers and hover tooltips still say what it
 *     actually is even once the visible text is just an icon.
 *   - Empty ("Label;" with nothing after the semicolon): the button is
 *     OMITTED entirely -- not shown at all, not even disabled.
 *
 * A label never mentioned in the variable at all keeps its default,
 * unchanged text -- this is an opt-in override list, not a full
 * redefinition of the menu.
 *
 * Returns a plain object `{ [label]: alias }` for direct lookup by
 * label. An unset/empty value returns `{}` (no overrides at all).
 */
function parseMenuAliases(rawValue) {
  const result = {};
  if (!rawValue || !rawValue.trim()) return result;

  const tokens = tokenizeMenuAliasValue(rawValue);
  for (const token of tokens) {
    const semicolonIndex = token.indexOf(';');
    if (semicolonIndex === -1) continue; // no ";" at all -- malformed, skip rather than error
    const label = token.slice(0, semicolonIndex).trim();
    const alias = token.slice(semicolonIndex + 1).trim();
    if (!label) continue; // ";alias" with nothing before the ";" -- nothing to attach this to
    result[label] = alias;
  }
  return result;
}

/** Splits the raw, already-line-joined value into its individual
 *  double-quoted tokens -- simpler than org-extra-menu's own
 *  tokenizer, since a "Label;alias" entry never needs to nest
 *  brackets the way an OLP array entry does. */
function tokenizeMenuAliasValue(raw) {
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i++;
      continue;
    }
    if (raw[i] !== '"') {
      i++; // tolerant of stray characters between tokens
      continue;
    }
    i++; // consume the opening quote
    let content = '';
    while (i < raw.length && raw[i] !== '"') {
      content += raw[i];
      i++;
    }
    i++; // consume the closing quote (or reach end of string harmlessly)
    tokens.push(content);
  }
  return tokens;
}

export { parseMenuAliases };
