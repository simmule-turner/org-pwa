/**
 * Parses org's #+STARTUP: directive into a structured config covering
 * heading visibility and inline-image visibility. None, some, or both
 * keywords can appear on a single #+STARTUP: line, and a file can have
 * more than one such line — "last one wins" applies uniformly to both
 * cases, since this walks doc.keywords (already in document order from
 * the parser) and lets each later matching token simply overwrite the
 * earlier one in its category.
 *
 * Archive-tree-cycling behavior used to live here too, as invented
 * "archived"/"noarchived" #+STARTUP: keywords — that was a mistake: real
 * org-mode doesn't have #+STARTUP: keywords for this at all. The actual
 * mechanism is the Emacs variable `org-cycle-open-archived-trees`,
 * conventionally set per-file via a "Local Variables" block, not
 * #+STARTUP:. That's now handled by local-variables.js instead — see
 * there for the corrected mechanism.
 *
 * Defaults (used when a category's keyword never appears anywhere in the
 * file) match real Emacs org-mode's actual out-of-the-box behavior, not
 * assumptions: a fresh file with no #+STARTUP line opens fully shown
 * (`showeverything`), and images stay as link text rather than rendering
 * (`noinlineimages`).
 */

const VISIBILITY_KEYWORDS = [
  'overview',
  'content',
  'showall',
  'showeverything',
  'show2levels',
  'show3levels',
  'show4levels',
  'show5levels',
];

/** For a 'showNlevels' visibility keyword, the N itself (2/3/4/5); null
 *  for every other visibility keyword. Kept as its own small helper
 *  since two different modules need this same number extracted --
 *  applyStartupVisibility (fold-state.js) to know how deep to expand,
 *  and nowhere else needs it duplicated. */
function showLevelsDepth(visibility) {
  const m = /^show(\d)levels$/.exec(visibility || '');
  return m ? Number(m[1]) : null;
}
const IMAGE_VISIBILITY_KEYWORDS = ['inlineimages', 'noinlineimages'];
const LOG_DONE_KEYWORDS = { logdone: 'time', lognotedone: 'note' };

const DEFAULT_STARTUP_CONFIG = {
  visibility: 'showeverything',
  imageVisibility: 'noinlineimages',
  logDone: null,
};

/** The raw #+STARTUP: values actually present in `doc`, with no
 *  defaulting applied at all -- a category #+STARTUP: never mentions
 *  comes back as null, not DEFAULT_STARTUP_CONFIG's own default value.
 *  Needed as its own step (rather than folded directly into
 *  parseStartupConfig below) so getEffectiveVisibility /
 *  getEffectiveImageVisibility can correctly tell "this file's
 *  #+STARTUP: line genuinely set showeverything" apart from "this
 *  file has no #+STARTUP: visibility keyword at all, so
 *  parseStartupConfig's own default just happens to equal
 *  showeverything" -- the middle layer of their own 3-layer precedence
 *  must only win in the first case. */
function parseStartupConfigRaw(doc) {
  const raw = { visibility: null, imageVisibility: null, logDone: null };
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'STARTUP') continue;
    const tokens = kw.value.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (VISIBILITY_KEYWORDS.includes(token)) {
        raw.visibility = token;
      } else if (IMAGE_VISIBILITY_KEYWORDS.includes(token)) {
        raw.imageVisibility = token;
      } else if (token in LOG_DONE_KEYWORDS) {
        raw.logDone = LOG_DONE_KEYWORDS[token];
      }
      // Unrecognized tokens (org has many more #+STARTUP keywords than
      // these three categories -- hidestars, etc.) are silently ignored
      // rather than erroring, matching org's own tolerant parsing of
      // directives it doesn't act on.
    }
  }
  return raw;
}

export function parseStartupConfig(doc) {
  const raw = parseStartupConfigRaw(doc);
  return {
    visibility: raw.visibility || DEFAULT_STARTUP_CONFIG.visibility,
    imageVisibility: raw.imageVisibility || DEFAULT_STARTUP_CONFIG.imageVisibility,
    logDone: raw.logDone,
  };
}

/** org-startup-folded: resolves the effective heading-visibility mode
 *  across all three precedence layers, highest first: a file's own
 *  "Local Variables" block, then #+STARTUP: (only when it genuinely,
 *  explicitly set a visibility keyword -- see parseStartupConfigRaw
 *  above), then the app-wide Global Variables setting, then
 *  DEFAULT_STARTUP_CONFIG's own default (showeverything) if nothing
 *  anywhere ever set it -- the same precedence org-log-done's own
 *  getEffectiveLogDoneSetting already established. Accepts the Lisp
 *  quoted-symbol form ('showeverything) or the bare word
 *  (showeverything) equally, matching org-log-done's own tolerance for
 *  the same leading-quote convention. An invalid value at any layer is
 *  treated the same as that layer not having set anything at all,
 *  rather than short-circuiting the whole resolution with a bad value. */
export function getEffectiveVisibility(doc, localVarsOnly, globalVarsOnly) {
  const local = parseVisibilityLispValue((localVarsOnly || {})['org-startup-folded']);
  if (local) return local;
  const raw = parseStartupConfigRaw(doc);
  if (raw.visibility) return raw.visibility;
  const global = parseVisibilityLispValue((globalVarsOnly || {})['org-startup-folded']);
  if (global) return global;
  return DEFAULT_STARTUP_CONFIG.visibility;
}

function parseVisibilityLispValue(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().replace(/^'/, '');
  return VISIBILITY_KEYWORDS.includes(v) ? v : null;
}

/** org-startup-with-inline-images: the same 3-layer precedence as
 *  getEffectiveVisibility above, for whether images render inline.
 *  `t` / `nil` (Lisp booleans, matching every other boolean variable
 *  in this app), converted to/from this module's own internal
 *  inlineimages/noinlineimages keyword pair for consistency with
 *  parseStartupConfig's own imageVisibility field. */
export function getEffectiveImageVisibility(doc, localVarsOnly, globalVarsOnly) {
  const local = parseLispBooleanOrNull((localVarsOnly || {})['org-startup-with-inline-images']);
  if (local !== null) return local ? 'inlineimages' : 'noinlineimages';
  const raw = parseStartupConfigRaw(doc);
  if (raw.imageVisibility) return raw.imageVisibility;
  const global = parseLispBooleanOrNull((globalVarsOnly || {})['org-startup-with-inline-images']);
  if (global !== null) return global ? 'inlineimages' : 'noinlineimages';
  return DEFAULT_STARTUP_CONFIG.imageVisibility;
}

/** Unlike local-variables.js's own parseLispBoolean, this returns null
 *  (rather than a fallback boolean) when unset/unrecognized -- needed
 *  here specifically so getEffectiveImageVisibility can tell "this
 *  layer said nil" apart from "this layer never set anything at all,"
 *  which a single fallback-collapsing boolean can't distinguish. */
function parseLispBooleanOrNull(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim();
  if (v === 't') return true;
  if (v === 'nil') return false;
  return null;
}

/** Combines getEffectiveVisibility and getEffectiveImageVisibility into
 *  the same {visibility, imageVisibility, logDone} shape
 *  parseStartupConfig itself returns -- for callers that want the
 *  fully Global/Local-Variables-aware config in one call, not just the
 *  raw #+STARTUP:-and-default version. logDone is deliberately left as
 *  parseStartupConfig's own raw #+STARTUP:-only value here (unchanged)
 *  -- org-log-done's own full 3-layer resolution already has its own
 *  dedicated function (progress-logging.js's getEffectiveLogDoneSetting)
 *  used directly wherever it's actually needed, not read from this
 *  config object anywhere in this codebase. */
export function resolveEffectiveStartupConfig(doc, localVarsOnly, globalVarsOnly) {
  return {
    visibility: getEffectiveVisibility(doc, localVarsOnly, globalVarsOnly),
    imageVisibility: getEffectiveImageVisibility(doc, localVarsOnly, globalVarsOnly),
    logDone: parseStartupConfigRaw(doc).logDone,
  };
}

export { DEFAULT_STARTUP_CONFIG, showLevelsDepth, VISIBILITY_KEYWORDS };
