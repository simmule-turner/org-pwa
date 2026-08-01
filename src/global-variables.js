/**
 * "Global Variables" -- an app-wide, cross-file settings mechanism
 * (configured in Settings, not embedded in any particular .org file)
 * for the same kind of Emacs Lisp variable a file's own Local
 * Variables block or #+STARTUP: line can already set, but as the
 * baseline default across every file rather than a single file's own
 * override. Same "name: value" per-line text format as Local
 * Variables (see local-variables.js), just without that mechanism's
 * "# Local Variables: ... # End:" block wrapper, since this text
 * isn't embedded inside an org file's own comment syntax at all --
 * it's a dedicated Settings field.
 *
 * Precedence (lowest to highest, matching real Emacs org-mode's own
 * actual resolution order exactly):
 *
 *   1. Global Variables (this module)     -- the app-wide baseline
 *   2. #+STARTUP: (org's own file-level directive, where applicable --
 *      only a few variables, like org-log-done, have a #+STARTUP:
 *      shorthand at all)
 *   3. A file's own "# Local Variables:" block -- highest precedence,
 *      the most file-specific, explicit override
 *
 * Real Emacs processes file-local variables last, specifically so a
 * file can override anything set earlier -- including the user's own
 * init-file customizations, which is exactly the role Global
 * Variables plays here. See README.org's own "Configuration" section
 * for the full, worked-through explanation of why this order, not
 * just the mechanics of it.
 */

const GLOBAL_VAR_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

export function parseGlobalVariables(text) {
  const vars = {};
  if (!text) return vars;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = GLOBAL_VAR_LINE_RE.exec(line);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

/**
 * Merges Global Variables (`globalVars`, the lowest-precedence,
 * app-wide baseline) with a file's own Local Variables (`localVars`,
 * the highest-precedence, most file-specific override) into one
 * combined map -- a key present in both resolves in favor of the
 * file-local value. Every one of local-variables.js's own getXxx()
 * accessors already just reads from a plain `{ name: rawValue }` map,
 * so passing this merged result in their place is enough to make
 * every existing accessor Global-Variables-aware for free, with no
 * changes needed to local-variables.js itself.
 */
export function mergeGlobalAndLocalVariables(globalVars, localVars) {
  return { ...(globalVars || {}), ...(localVars || {}) };
}
