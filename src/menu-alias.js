/**
 * Parses org-xx-menu-aliases -- this app's own extension (not a real
 * org-mode variable), using the same Global/Local Variables mechanism
 * org-xx-extra-menu already established a precedent for. One
 * namespaced entry format covers all four of the app's main menus
 * (File, More, Export, View) at once, rather than a separate variable
 * per menu.
 *
 * Value format: a sequence of double-quoted `"menu:Label;alias"`
 * entries, space-separated (optionally spread across multiple
 * physical lines with a trailing `\`, same line-continuation
 * mechanism every other multi-entry Global/Local Variable already
 * uses). `menu` is one of `file`, `more`, `export`, `view`:
 *
 *   org-xx-menu-aliases: "file:New;➕" "file:Open;📂" "export:ASCII;📄" "view:Org;📝"
 *
 * `Label` is one of that menu's own real, built-in button labels
 * (e.g. "New" for file, "ASCII" for export) -- an entry naming a
 * label that doesn't actually exist in that menu is simply never
 * looked up by anything and has no effect, the same tolerant-of-the-
 * unexpected approach every other "recognized subset" parser in this
 * codebase already takes, rather than a hard validation error. An
 * entry with no recognized "menu:" prefix at all (a stray colon-free
 * token, or a colon-prefix that isn't one of the four known menus) is
 * likewise silently skipped rather than erroring.
 *
 * `alias`, after the semicolon, has two meanings depending on whether
 * it's present:
 *   - Non-empty: the button's default label text is REPLACED with this
 *     alias wherever it's displayed (the button still does exactly the
 *     same thing; only what's written on it changes). The original
 *     label becomes that button's accessible name (aria-label/title)
 *     instead, so screen readers and hover tooltips still say what it
 *     actually is even once the visible text is just an icon.
 *   - Empty ("menu:Label;" with nothing after the semicolon): the
 *     button is OMITTED entirely -- not shown at all, not even disabled.
 *
 * A label never mentioned in the variable at all keeps its default,
 * unchanged text -- this is an opt-in override list, not a full
 * redefinition of any menu.
 *
 * Returns `{ file: {...}, more: {...}, export: {...}, view: {...} }`
 * -- each of the four always present (possibly empty `{}`), for
 * direct `result[menu][label]` lookup by any call site. An
 * unset/empty value returns all four as `{}`.
 */
function parseMenuAliases(rawValue) {
  const result = { file: {}, more: {}, export: {}, view: {} };
  if (!rawValue || !rawValue.trim()) return result;

  const tokens = tokenizeMenuAliasValue(rawValue);
  for (const token of tokens) {
    const colonIndex = token.indexOf(':');
    if (colonIndex === -1) continue; // no "menu:" prefix at all -- malformed, skip rather than error
    const menu = token.slice(0, colonIndex).trim();
    if (!(menu in result)) continue; // not one of the four known menus -- skip

    const rest = token.slice(colonIndex + 1);
    const semicolonIndex = rest.indexOf(';');
    if (semicolonIndex === -1) continue; // no ";" at all -- malformed, skip rather than error
    const label = rest.slice(0, semicolonIndex).trim();
    const alias = rest.slice(semicolonIndex + 1).trim();
    if (!label) continue; // "menu:;alias" with nothing before the ";" -- nothing to attach this to
    result[menu][label] = alias;
  }
  return result;
}

/** Splits the raw, already-line-joined value into its individual
 *  double-quoted tokens -- simpler than org-xx-extra-menu's own
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

/**
 * The pure ordering decision behind org-xx-menu-aliases' own
 * reordering capability -- kept separate from any actual DOM
 * manipulation (app.js's own appendMenuButtonsInOrder does that part)
 * purely so this decision itself is directly, easily testable.
 *
 * `labels` is a menu's own real labels, in the app's own default
 * order. `aliasMap` is one menu's own slice of parseMenuAliases'
 * result (e.g. `result.more`). Returns `labels` reordered to match
 * aliasMap's own key insertion order, but ONLY when every single one
 * of `labels` is a key in aliasMap -- even an empty-string value
 * counts as "mentioned" (that's how a label establishes its own
 * position in the order without changing its text or being hidden);
 * only a label missing from aliasMap entirely means "not mentioned",
 * which makes reordering opt-in and all-or-nothing: a partial listing
 * leaves the default order completely untouched, so setting one or
 * two aliases never silently reorders anything as a side effect.
 *
 * An aliasMap key that isn't among `labels` at all (a typo, or a
 * stale reference to a label that no longer exists) is silently
 * dropped from the result, the same tolerant-of-the-unexpected
 * approach parseMenuAliases itself already takes.
 */
function resolveMenuOrder(aliasMap, labels) {
  const allMentioned = labels.every((label) => label in aliasMap);
  if (!allMentioned) return labels;
  return Object.keys(aliasMap).filter((orderedLabel) => labels.includes(orderedLabel));
}

export { resolveMenuOrder };
