/**
 * Parses an Emacs "Local Variables" block:
 *
 *   # Local Variables:
 *   # org-agenda-start-on-weekday: 0
 *   # org-cycle-open-archived-trees: t
 *   # End:
 *
 * This is a general Emacs mechanism (works in any file type Emacs edits,
 * using whatever comment prefix that file type uses — `#` for org files,
 * since that's org's own comment-line syntax), not an org-specific
 * directive like #+STARTUP:. Org files commonly use it for settings
 * #+STARTUP: doesn't cover — org-agenda-start-on-weekday and
 * org-cycle-open-archived-trees are exactly two such cases; there will be
 * more, hence this returns a plain, open-ended `{ name: rawStringValue }`
 * map rather than a fixed, closed shape.
 *
 * Deliberately NOT restricted to appearing only near the end of the file
 * (real Emacs only looks in roughly the last few thousand characters, an
 * optimization for editing huge files interactively) — this parser reads
 * the whole file into memory anyway, so scanning the whole text for the
 * block is no less correct and one less arbitrary limit to explain.
 */

const LOCAL_VARS_START_RE = /^#\s*Local Variables:\s*$/i;
const LOCAL_VARS_END_RE = /^#\s*End:\s*$/i;
const LOCAL_VAR_LINE_RE = /^#\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

export function parseLocalVariables(text) {
  const vars = {};
  if (!text) return vars;
  const lines = text.split('\n');

  const startIdx = lines.findIndex((l) => LOCAL_VARS_START_RE.test(l.trim()));
  if (startIdx === -1) return vars;
  const endIdx = lines.findIndex((l, i) => i > startIdx && LOCAL_VARS_END_RE.test(l.trim()));
  if (endIdx === -1) return vars;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = LOCAL_VAR_LINE_RE.exec(lines[i].trim());
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

/** Emacs Lisp boolean convention: the symbol `t` is true, `nil` is
 *  false (and is also Lisp's empty list / "nothing", which is why nil
 *  reads as false) — not JavaScript truthiness, so this doesn't just
 *  coerce the raw string. Anything else falls back to `fallback`. */
export function parseLispBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === 't') return true;
  if (v === 'nil') return false;
  return fallback;
}

export function parseLispNumber(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}

/** org-agenda-start-on-weekday: 0=Sunday, 1=Monday (real org's own
 *  default), 2=Tuesday, ... 6=Saturday. Values outside 0-6 fall back to
 *  the default rather than producing a nonsensical week. */
export function getAgendaStartOnWeekday(vars) {
  const n = parseLispNumber((vars || {})['org-agenda-start-on-weekday'], 1);
  return n >= 0 && n <= 6 ? n : 1;
}

/** org-cycle-open-archived-trees: real org's default is nil (false) —
 *  cycling/folding does NOT expand into archived trees. */
export function getCycleOpenArchivedTrees(vars) {
  return parseLispBoolean((vars || {})['org-cycle-open-archived-trees'], false);
}

/** org-agenda-skip-comment-trees: real org's default is t — a
 *  "commented" heading (one whose title starts with "# ", see
 *  comment-model.js — real org's own comment-line syntax applied to a
 *  heading title) is skipped in agenda views. Set to nil to include
 *  commented headings in the agenda after all. */
export function getAgendaSkipCommentTrees(vars) {
  return parseLispBoolean((vars || {})['org-agenda-skip-comment-trees'], true);
}

/** org-agenda-skip-archived-trees: real org's default is t — an
 *  archived heading (tagged :ARCHIVE:, see archive-model.js) is skipped
 *  in agenda views. Set to nil to include archived headings in the
 *  agenda after all. */
export function getAgendaSkipArchivedTrees(vars) {
  return parseLispBoolean((vars || {})['org-agenda-skip-archived-trees'], true);
}

/** org-archive-confirm: whether archiving/unarchiving a heading asks
 *  for confirmation first. `t` (the default, matching real org's own
 *  default) shows a confirmation dialog with the destination before
 *  proceeding; `nil` archives/unarchives immediately with no prompt. */
export function getArchiveConfirm(vars) {
  return parseLispBoolean((vars || {})['org-archive-confirm'], true);
}

/** org-closed-keep-when-no-todo: real org's own default is nil --
 *  cycling a DONE heading all the way back to having no TODO keyword at
 *  all removes its CLOSED timestamp, the same as cycling it to a
 *  different, non-done keyword does unconditionally. Set to t to keep
 *  the CLOSED timestamp specifically for this "cleared to no keyword"
 *  case (it's still always removed when cycling to a different TODO
 *  keyword, regardless of this setting -- that part of the behavior
 *  isn't controlled by any variable in real org either). */
export function getClosedKeepWhenNoTodo(vars) {
  return parseLispBoolean((vars || {})['org-closed-keep-when-no-todo'], false);
}

/** org-ascii-text-width: the maximum line width (in characters) for
 *  wrapping paragraph text during ASCII export. Real org's own default
 *  is 72, matched here exactly. A non-positive or unparseable value
 *  falls back to that default rather than producing zero-or-negative-
 *  width wrapping. */
export function getAsciiTextWidth(vars) {
  const n = parseLispNumber((vars || {})['org-ascii-text-width'], 72);
  return n > 0 ? n : 72;
}

/** org-refile-targets: this app's own plain-text translation (see
 *  src/refile.js's own docs for the full syntax and precedence) --
 *  just the raw string here, since parsing/validation lives in that
 *  module's own parseRefileTargets, not duplicated here. */
export function getRefileTargets(vars) {
  return (vars || {})['org-refile-targets'] || '';
}

/** org-use-tag-inheritance: whether a heading's "effective" tags (for
 *  search/filtering purposes) include its ancestors' own tags, not
 *  just its own. `t` is real org's own actual default — tags inherit
 *  down the outline structurally by default, confirmed directly
 *  against org's own manual ("if a heading has a certain tag, all
 *  subheadings inherit the tag as well") — not an opt-in feature the
 *  way property inheritance below is. A simple boolean here, not real
 *  org's fuller list-of-tags/regexp value space (org-use-tag-inheritance
 *  can also be set to a specific tag list or a regexp) — a stated
 *  simplification, covering the common on/off case. */
export function getUseTagInheritance(vars) {
  return parseLispBoolean((vars || {})['org-use-tag-inheritance'], true);
}

/** org-use-property-inheritance: whether a heading's "effective"
 *  property values (for search/filtering purposes) fall back to an
 *  ancestor's value when the heading doesn't have that property
 *  itself. `nil` is real org's own actual default — property
 *  inheritance is opt-in, explicitly NOT turned on by default because
 *  it can slow down property searches and is often not needed
 *  (confirmed directly against org's own manual). A simple boolean
 *  here, not real org's fuller t/list/regexp value space — the same
 *  stated simplification as getUseTagInheritance above. */
export function getUsePropertyInheritance(vars) {
  return parseLispBoolean((vars || {})['org-use-property-inheritance'], false);
}

/** org-contacts-birthday-property: which property key holds a
 *  heading's birthday/anniversary date+description (see agenda.js's
 *  org-contacts-anniversaries support). Default "BIRTHDAY", matching
 *  real org-contacts.el's own default exactly (confirmed directly
 *  against the org-contacts.el source: "Default FIELD value is
 *  BIRTHDAY"). A plain string value, not a Lisp boolean/number, so no
 *  special parsing beyond trimming. */
export function getContactsBirthdayProperty(vars) {
  const raw = (vars || {})['org-contacts-birthday-property'];
  const trimmed = raw ? String(raw).trim() : '';
  return trimmed || 'BIRTHDAY';
}

/** org-use-sub-superscripts: controls whether/how `_`/`^` are
 *  interpreted as subscript/superscript markers (see inline-markup.js).
 *  Unlike the other Lisp-boolean variables above, this one has three
 *  valid values, not two -- returns exactly 't', 'nil', or '{}' (never
 *  a JS boolean), matching parseInline's own subSuperscriptMode option
 *  directly. An unrecognized value falls back to 't', real org's own
 *  default, rather than silently disabling the feature. */
export function getUseSubSuperscripts(vars) {
  const raw = (vars || {})['org-use-sub-superscripts'];
  const trimmed = raw ? String(raw).trim() : '';
  if (trimmed === 'nil' || trimmed === '{}') return trimmed;
  return 't';
}
