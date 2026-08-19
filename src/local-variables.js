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
  const lines = joinContinuedLines(text);

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

/** Joins any line ending in a trailing backslash with the physical
 *  line(s) that follow it, before "# key: value" parsing happens --
 *  lets a single variable's value span multiple lines for readability
 *  (org-xx-extra-menu's own multi-entry format is the motivating case).
 *  Identical to global-variables.js's own joinContinuedLines -- kept
 *  as a separate copy here rather than a shared import, matching how
 *  each of this app's variable-source modules already stays fairly
 *  self-contained. The backslash itself is stripped, and the joined
 *  content is separated by a single space. A trailing backslash on the
 *  very last line (nothing left to continue onto) is left as a
 *  literal trailing character rather than silently swallowed. */
function joinContinuedLines(text) {
  const rawLines = text.split('\n');
  const joined = [];
  let current = null;
  for (let i = 0; i < rawLines.length; i++) {
    if (current === null) {
      current = rawLines[i];
    } else {
      // A continuation line still carries this block's own "# ..."
      // comment-prefix convention -- strip it here (unlike the first
      // line of a declaration, whose leading "#" is stripped later by
      // LOCAL_VAR_LINE_RE's own match instead) so it doesn't end up as
      // a literal "#" character embedded in the middle of the joined
      // value.
      current += ' ' + rawLines[i].replace(/^\s*#\s*/, '');
    }
    const isLastLine = i === rawLines.length - 1;
    if (/\s*\\\s*$/.test(current) && !isLastLine) {
      current = current.replace(/\s*\\\s*$/, '');
    } else {
      joined.push(current);
      current = null;
    }
  }
  if (current !== null) joined.push(current);
  return joined;
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

/** org-deadline-warning-days: how many days before its own due date a
 *  DEADLINE with no explicit delay cookie of its own (e.g. no
 *  "<2026-01-10 Sat -3d>" suffix) starts appearing in the agenda at
 *  all. Real org's own actual default is 14 -- confirmed directly
 *  against the Org FAQ, the authoritative source for this specific
 *  number -- not 0: a DEADLINE with no cookie of its own still gets a
 *  two-week heads-up automatically, the same as real org's own daily
 *  workflow, rather than only ever showing up on its exact due date
 *  with zero advance notice. A negative value falls back to the
 *  default too, rather than producing a nonsensical negative window. */
export function getDeadlineWarningDays(vars) {
  const n = parseLispNumber((vars || {})['org-deadline-warning-days'], 14);
  return n >= 0 ? n : 14;
}

/** org-scheduled-delay-days: SCHEDULED's own equivalent to
 *  org-deadline-warning-days above -- how many days a SCHEDULED item
 *  with no explicit delay cookie of its own (e.g. no "-2d" suffix)
 *  has its appearance in the agenda delayed by, past its own literal
 *  date (see resolveScheduledDate in agenda.js for the direction
 *  itself, which is already correctly the opposite of DEADLINE's own
 *  early-warning direction -- this is purely about the FILE-WIDE
 *  DEFAULT for that same delay, when no per-heading suffix is
 *  written). Default 0 -- unlike DEADLINE's own confirmed-against-
 *  the-FAQ 14-day default, this specific number couldn't be directly
 *  confirmed against a primary source the way that one was; 0 is used
 *  on the strength of the Org manual's own bare SCHEDULED example
 *  ("SCHEDULED: <2004-12-25 Sat>" shows on the 25th, with no
 *  additional caveat about any further default delay applying) and
 *  the basic semantics of what a "delay" even is: unlike DEADLINE's
 *  own early-warning default (which proactively gives MORE
 *  information nobody had to ask for), a nonzero default here would
 *  mean every ordinary SCHEDULED item is silently HIDDEN for some
 *  number of days by default, contradicting the manual's own example
 *  and actively working against SCHEDULED's whole purpose. A negative
 *  value falls back to 0 too, rather than producing a nonsensical
 *  negative delay. */
export function getScheduledDelayDays(vars) {
  const n = parseLispNumber((vars || {})['org-scheduled-delay-days'], 0);
  return n >= 0 ? n : 0;
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

/** org-agenda-files: real org's own exact variable name -- additional
 *  files the Agenda and TODO views scan across, beyond whichever file
 *  is currently open. Semicolon-separated "scheme:path" entries (the
 *  same separator convention as org-refile-targets above, and the
 *  same "scheme:path" per-entry shape this app already used for its
 *  own, previously-separate Agenda Files setting) -- just the raw
 *  string here; parsing/validation is app.js's own
 *  parseAgendaFilesVar, the same division of responsibility as
 *  getRefileTargets and src/refile.js above. */
export function getAgendaFilesVar(vars) {
  return (vars || {})['org-agenda-files'] || '';
}

/** org-xx-extra-menu: this app's own extension (not a real org-mode
 *  variable), a floating (☰) button's configurable quick-action menu
 *  -- see src/extra-menu.js's own docs for the full syntax. Just the
 *  raw string here, since parsing/validation lives in that module's
 *  own parseExtraMenu. */
export function getExtraMenu(vars) {
  return (vars || {})['org-xx-extra-menu'] || '';
}

/** org-xx-menu-aliases: this app's own extension (not a real org-mode
 *  variable), an override list for the four main app-chrome menus
 *  (File, More, Export, View) at once -- see src/menu-alias.js's own
 *  docs for the full "menu:Label;alias" syntax and semantics. Just
 *  the raw string here, same as getExtraMenu; parsing lives in that
 *  module's own parseMenuAliases. */
export function getMenuAliases(vars) {
  return (vars || {})['org-xx-menu-aliases'] || '';
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

/** calendar-latitude: real Emacs's own exact variable name and
 *  purpose -- the latitude diary-sunrise-sunset computes from. A
 *  non-numeric or out-of-range (-90 to 90) value falls back to the
 *  default rather than producing a nonsensical calculation. */
export function getCalendarLatitude(vars) {
  const n = parseLispNumber((vars || {})['calendar-latitude'], 35.994);
  return n >= -90 && n <= 90 ? n : 35.994;
}

/** calendar-longitude: real Emacs's own exact variable name. A
 *  non-numeric or out-of-range (-180 to 180) value falls back to the
 *  default. */
export function getCalendarLongitude(vars) {
  const n = parseLispNumber((vars || {})['calendar-longitude'], -78.8986);
  return n >= -180 && n <= 180 ? n : -78.8986;
}

/** calendar-location-name: real Emacs's own exact variable name --
 *  purely cosmetic (a label), unlike latitude/longitude which
 *  actually drive the calculation. */
export function getCalendarLocationName(vars) {
  const raw = (vars || {})['calendar-location-name'];
  const trimmed = raw ? String(raw).trim() : '';
  return trimmed || 'Durham, NC';
}

/** solar-ampm: this app's own extension, not a real elisp/org
 *  variable -- controls the time format for the four single-value
 *  solar functions (diary-sunrise/diary-sunset/diary-civil-sunrise/
 *  diary-civil-sunset). Default nil (24-hour, zero-filled, matching
 *  what was originally requested for these four); t switches to
 *  12-hour with am/pm. Doesn't affect diary-sunrise-sunset or
 *  diary-solar-summary, which already have their own, separate
 *  12-hour convention (matching real diary-sunrise-sunset's own
 *  actual output) unrelated to this variable, nor diary-day-length,
 *  which is a duration, not a time-of-day -- there's no "am/pm" for a
 *  duration. */
export function getSolarAmpm(vars) {
  return parseLispBoolean((vars || {})['solar-ampm'], false);
}

/** solar-hide-label: this app's own extension too -- controls
 *  whether the four single-value solar functions above, and
 *  diary-day-length, show their own trailing label ("Sunrise",
 *  "Dawn", "daylight", ...) at all. Default nil (label shown,
 *  matching the format originally requested); t omits it, leaving
 *  just the bare time or duration. Unlike solar-ampm, this one DOES
 *  apply to diary-day-length as well as the four solar functions --
 *  a duration still has a label to hide ("daylight"), even though it
 *  has no time-of-day format to switch between 12-/24-hour. */
export function getSolarHideLabel(vars) {
  return parseLispBoolean((vars || {})['solar-hide-label'], false);
}

/** org-weather-format: this app's own extension, not a real
 *  elisp/org variable -- the template %%(org-weather) substitutes
 *  its own placeholders into (see src/org-weather.js's own
 *  formatWeatherLine). Default matches the exact format given in the
 *  original request. */
export function getOrgWeatherFormat(vars) {
  const raw = (vars || {})['org-weather-format'];
  const trimmed = raw ? String(raw).trim() : '';
  return trimmed || 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su';
}

const WEATHER_SPEED_UNITS = new Set(['km/h', 'm/s', 'mph', 'Knots']);

/** org-weather-speed-unit: this app's own extension. Default "mph",
 *  matching what this app always fetches in (see
 *  src/org-weather.js's own FETCH_SPEED_UNIT) -- an unrecognized
 *  value (a typo, an unsupported unit) falls back to that same
 *  default rather than passing a malformed unit label straight
 *  through to the formatted output. */
export function getOrgWeatherSpeedUnit(vars) {
  const raw = (vars || {})['org-weather-speed-unit'];
  const trimmed = raw ? String(raw).trim() : '';
  return WEATHER_SPEED_UNITS.has(trimmed) ? trimmed : 'mph';
}

const WEATHER_TEMPERATURE_UNITS = new Set(['\u00b0C', '\u00b0F']);

/** org-weather-temperature-unit: this app's own extension. Default
 *  "\u00b0F", matching what this app always fetches in (see
 *  src/org-weather.js's own FETCH_TEMPERATURE_UNIT) -- same
 *  unrecognized-value fallback behavior as getOrgWeatherSpeedUnit
 *  above. */
export function getOrgWeatherTemperatureUnit(vars) {
  const raw = (vars || {})['org-weather-temperature-unit'];
  const trimmed = raw ? String(raw).trim() : '';
  return WEATHER_TEMPERATURE_UNITS.has(trimmed) ? trimmed : '\u00b0F';
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
