/**
 * Normalizes "smart"/curly quote characters back to their plain ASCII
 * equivalents. Confirmed as a real, serious bug, not a theoretical
 * one: iOS Safari (and many Android keyboards, and some desktop word-
 * processor-style inputs) auto-substitute a typed straight quote with
 * a typographic "smart" one as part of ordinary autocorrect/"smart
 * punctuation" behavior -- entirely invisible to the person typing,
 * who sees what looks like an ordinary quote mark either way.
 *
 * Every quote-delimited settings syntax in this app depends on the
 * literal ASCII character:
 *   - org-xx-extra-menu's own "SPEC;LABEL" double-quoted tokens
 *     (see extra-menu.js)
 *   - org-xx-extra-menu's own 'function-name single-quote SIGIL
 *     prefix for a function-reference entry (also extra-menu.js) --
 *     a single quote, not a double one, and just as vulnerable
 *   - org-xx-extra-menu's own OLP header array, JSON.parse'd, which
 *     throws outright on a curly quote rather than silently
 *     mis-parsing
 *   - org-xx-menu-aliases' own "menu:Label;alias" double-quoted
 *     tokens (see menu-alias.js)
 *
 * A curly quote in place of a straight one doesn't error in most of
 * these cases -- it just silently fails to match the expected
 * delimiter, so the token/entry is quietly skipped (see each of those
 * parsers' own "malformed entries are skipped, not a hard error"
 * tolerance) rather than producing any visible failure at all. This
 * is exactly the kind of silent-no-op bug that's hardest to notice
 * and hardest to diagnose without knowing to look for it -- someone
 * on an iPhone typing a menu-alias entry has no way to tell their own
 * quote marks are the problem.
 *
 * Deliberately narrow in scope: only applied at specific, known-to-
 * always-be-syntax input points (Settings' own Quick Settings fields,
 * the raw Global/Local Variables textarea, and the Capture Templates
 * JSON textarea -- the most severe case of all three, since JSON is
 * entirely quote-delimited and JSON.parse rejects a single curly
 * quote outright rather than silently mis-parsing) -- never to
 * ordinary document prose (a heading's title, a paragraph's body
 * text), where a person's own real typographic quotes in their own
 * writing are wanted, not something to silently rewrite.
 */

// U+2018 LEFT SINGLE QUOTATION MARK, U+2019 RIGHT SINGLE QUOTATION
// MARK (also used as a typographic apostrophe), U+201B SINGLE HIGH-
// REVERSED-9 QUOTATION MARK -- every curly single-quote variant
// actually reachable via ordinary autocorrect on the platforms this
// app targets.
const SMART_SINGLE_QUOTES_RE = /[\u2018\u2019\u201B]/g;

// U+201C LEFT DOUBLE QUOTATION MARK, U+201D RIGHT DOUBLE QUOTATION
// MARK, U+201F DOUBLE HIGH-REVERSED-9 QUOTATION MARK.
const SMART_DOUBLE_QUOTES_RE = /[\u201C\u201D\u201F]/g;

/** Replaces every curly single/double quote character in `text` with
 *  its plain ASCII equivalent (`'` / `"`). Safe to call on any
 *  string, including `null`/`undefined` (returned as-is) or a value
 *  that happens to contain no quote characters at all (returned
 *  unchanged) -- callers don't need their own guard before calling
 *  this. */
function normalizeSmartQuotes(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SMART_SINGLE_QUOTES_RE, "'").replace(SMART_DOUBLE_QUOTES_RE, '"');
}

export { normalizeSmartQuotes };
