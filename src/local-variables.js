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
