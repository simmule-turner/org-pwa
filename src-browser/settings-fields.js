// Extracted from app.js: settings fields. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { tokenize as tokenizeExtraMenuValue } from '../src/extra-menu.js';
import { tokenizeMenuAliasValue } from '../src/menu-alias.js';
import { DEFAULT_ORG_WEATHER_FORMAT } from '../src/org-weather.js';
import { VISIBILITY_KEYWORDS } from '../src/startup-config.js';

/**
 * Quick Settings: one entry per Global/Local Variable this app knows
 * about, each with a proper, type-appropriate control (toggle,
 * number stepper, weekday picker, ...) instead of a bare "name: value"
 * line in a shared textarea -- the same underlying storage
 * (globalVariablesText / globalVariables) as the existing raw-text
 * "Global Variables" section below it, just with a friendlier front
 * end for the common case. The raw textarea stays too, unchanged, as
 * the power-user/advanced path for anything not covered here (or for
 * editing several fields at once via paste).
 *
 * `type` drives which control renderQuickSettingField builds:
 *   - 'boolean': a checkbox, Lisp t/nil underneath.
 *   - 'number': a number input, with min/max/step as given.
 *   - 'text': a single-line text input.
 *   - 'longtext': a small textarea, for a value that can itself be
 *     long/multi-entry (org-refile-targets, the org-xx-*-menu family)
 *     -- still just this one variable's own raw syntax, not a
 *     structured list-editor for it; that's a bigger feature of its
 *     own, out of scope here.
 *   - 'weekday': a 0-6 select, real day names shown instead of digits.
 *   - 'logdone': org-log-done's own three-state Off/Timestamp/Note,
 *     with real Lisp quoted-symbol syntax ('time / 'note) underneath.
 *   - 'subsuper': org-use-sub-superscripts' own three-state value
 *     space (t / nil / {}), not a plain boolean.
 */
export const QUICK_SETTINGS_FIELDS = [
  {
    key: 'org-xx-updates-at-top',
    label: 'Updates section at top of Settings',
    section: 'Settings',
    type: 'boolean',
    default: true,
    helpAnchor: '#settings',
  },
  {
    key: 'org-startup-folded',
    label: 'Initial heading visibility',
    section: 'Startup',
    type: 'select',
    default: 'showeverything',
    options: VISIBILITY_KEYWORDS.map((v) => ({ value: v, label: v })),
    helpAnchor: '#folding-and-startup',
  },
  {
    key: 'org-startup-with-inline-images',
    label: 'Show images inline on open',
    section: 'Startup',
    type: 'boolean',
    default: false,
    helpAnchor: '#folding-and-startup',
  },
  {
    key: 'org-xx-startup-with-show-photos',
    label: 'Show contact photos',
    section: 'Startup',
    type: 'boolean',
    default: false,
    helpAnchor: '#folding-and-startup',
  },
  {
    key: 'display-time-mode',
    label: 'Show date/time in modeline',
    section: 'Modeline',
    type: 'onezero',
    default: true,
    helpAnchor: '#modeline',
  },
  {
    key: 'display-time-format',
    label: 'Date/time format',
    section: 'Modeline',
    type: 'text',
    default: '%H:%M',
    helpAnchor: '#modeline',
  },
  { key: 'org-log-done', label: 'Log completing a TODO', section: 'Progress logging', type: 'logdone', helpAnchor: '#progress-logging' },
  {
    key: 'org-closed-keep-when-no-todo',
    label: 'Keep CLOSED when cycled to no TODO keyword',
    section: 'Progress logging',
    type: 'boolean',
    default: false,
    helpAnchor: '#progress-logging',
  },
  {
    key: 'org-agenda-show-all-dates',
    label: 'Show empty days in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  {
    key: 'org-agenda-skip-archived-trees',
    label: 'Skip archived headings in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  {
    key: 'org-agenda-skip-comment-trees',
    label: 'Skip commented headings in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  { key: 'org-agenda-start-on-weekday', label: 'Week starts on', section: 'Agenda', type: 'weekday', default: 1, helpAnchor: '#agenda-behavior' },
  {
    key: 'org-deadline-warning-days',
    label: 'Deadline advance warning (days)',
    section: 'Agenda',
    type: 'number',
    default: 14,
    min: 0,
    max: 365,
    step: 1,
    helpAnchor: '#agenda-dated-entries',
  },
  {
    key: 'org-scheduled-delay-days',
    label: 'Scheduled item delay (days)',
    section: 'Agenda',
    type: 'number',
    default: 0,
    min: 0,
    max: 365,
    step: 1,
    helpAnchor: '#agenda-dated-entries',
  },
  {
    key: 'org-cycle-open-archived-trees',
    label: 'Allow expanding archived headings',
    section: 'Agenda',
    type: 'boolean',
    default: false,
    helpAnchor: '#archiving',
  },
  {
    key: 'org-contacts-birthday-property',
    label: 'Birthday property name',
    section: 'Contacts & Calendar',
    type: 'text',
    default: 'BIRTHDAY',
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-latitude',
    label: 'Latitude',
    section: 'Contacts & Calendar',
    type: 'number',
    default: 35.994,
    min: -90,
    max: 90,
    step: 0.0001,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-longitude',
    label: 'Longitude',
    section: 'Contacts & Calendar',
    type: 'number',
    default: -78.8986,
    min: -180,
    max: 180,
    step: 0.0001,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'solar-ampm',
    label: 'Solar times: use am/pm (else 24-hour)',
    section: 'Contacts & Calendar',
    type: 'boolean',
    default: false,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'solar-hide-label',
    label: 'Solar times: hide label (e.g. "Sunrise")',
    section: 'Contacts & Calendar',
    type: 'boolean',
    default: false,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'org-weather-format',
    label: 'Format',
    section: 'Weather',
    type: 'text',
    default: DEFAULT_ORG_WEATHER_FORMAT,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'org-weather-temperature-unit',
    label: 'Temperature unit',
    section: 'Weather',
    type: 'select',
    default: '\u00b0F',
    options: [
      { value: '\u00b0F', label: '\u00b0F' },
      { value: '\u00b0C', label: '\u00b0C' },
    ],
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'org-weather-speed-unit',
    label: 'Wind speed unit',
    section: 'Weather',
    type: 'select',
    default: 'mph',
    options: [
      { value: 'mph', label: 'mph' },
      { value: 'km/h', label: 'km/h' },
      { value: 'm/s', label: 'm/s' },
      { value: 'Knots', label: 'Knots' },
    ],
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'org-use-tag-inheritance',
    label: 'Tag search matches inherited tags',
    section: 'Search & tags',
    type: 'boolean',
    default: true,
    helpAnchor: '#searching',
  },
  {
    key: 'org-use-property-inheritance',
    label: 'Property search matches inherited values',
    section: 'Search & tags',
    type: 'boolean',
    default: false,
    helpAnchor: '#searching',
  },
  { key: 'org-use-sub-superscripts', label: 'Interpret _ / ^ as sub/superscript', section: 'Editing', type: 'subsuper', helpAnchor: '#inline-text-markup' },
  {
    key: 'org-table-duration-hour-zero-padding',
    label: 'Zero-pad hours in duration formulas',
    section: 'Editing',
    type: 'boolean',
    default: true,
    helpAnchor: '#table-formulas',
  },
  {
    key: 'org-ascii-text-width',
    label: 'ASCII export line width',
    section: 'Export',
    type: 'number',
    default: 72,
    min: 20,
    max: 200,
    step: 1,
    helpAnchor: '#export',
  },
  {
    key: 'org-xx-god-mode-button',
    label: 'Show the floating [g] god-mode button',
    section: 'Keyboard',
    type: 'boolean',
    default: true,
    helpAnchor: '#god-mode-mobile',
  },
  { key: 'org-refile-targets', label: 'Refile targets', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#refile' },
  { key: 'org-global-properties', label: 'Global properties', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#effort-all' },
  { key: 'org-agenda-files', label: 'Agenda files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#agenda-files' },
  { key: 'org-contacts-files', label: 'Contacts files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#contacts-files' },
  { key: 'org-agenda-text-search-extra-files', label: 'Search extra files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#search-extra-files' },
  { key: 'org-xx-extra-menu', label: 'Extras menu (\u2630)', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#extras-menu', entryTokenizer: tokenizeExtraMenuValue },
  { key: 'org-xx-menu-aliases', label: 'Menu labels (File/More/Export/View)', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#menu-customization', entryTokenizer: tokenizeMenuAliasValue },
];
