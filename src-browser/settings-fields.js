// @ts-check
// Extracted from app.js: settings fields. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { VISIBILITY_KEYWORDS } from '../src/startup-config.js';
import { getBabelJs } from '../src/local-variables.js';

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
/** @typedef {{ key: string, label: string, section: string, type: string, default?: any, helpAnchor?: string, [k: string]: any }} QuickSettingField */
/** @type {QuickSettingField[]} */
export const SETTINGS_FIELDS = [
  {
    key: 'org-startup-folded',
    label: 'Initial heading visibility',
    section: 'Startup',
    type: 'select',
    default: 'showeverything',
    options: VISIBILITY_KEYWORDS.map((v) => ({ value: v, label: v })),
    helpAnchor: '#folding-and-startup',
  },
  { key: 'recentf-max-saved-items', label: 'Recently opened files kept', section: 'Startup', type: 'number', default: 20, step: 1, helpAnchor: '#files-and-storage' },
  {
    key: 'org-startup-indented',
    label: 'Indent text and lists under headings',
    section: 'Startup',
    type: 'boolean',
    default: false,
    helpAnchor: '#folding-and-startup',
  },
  {
    key: 'org-xx-indent-tables',
    label: 'Indent tables too, when indenting is on',
    section: 'Startup',
    type: 'boolean',
    default: true,
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
    default: false,
    helpAnchor: '#modeline',
  },
  { key: 'org-log-done', label: 'Log completing a TODO', section: 'Progress logging', type: 'logdone', helpAnchor: '#progress-logging' },
  {
    key: 'org-agenda-show-all-dates',
    label: 'Show empty days in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  {
    key: 'org-agenda-show-future-repeats',
    label: 'Show repeats in the future part of the Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  { key: 'org-habit-preceding-days', label: 'Habit graph: days before today', section: 'Agenda', type: 'number', default: 21, min: 0, max: 400, step: 1, helpAnchor: '#habits' },
  { key: 'org-habit-following-days', label: 'Habit graph: days after today', section: 'Agenda', type: 'number', default: 7, min: 0, max: 400, step: 1, helpAnchor: '#habits' },
  { key: 'org-habit-show-habits-only-for-today', label: 'Show habits only in today\u2019s Agenda', section: 'Agenda', type: 'boolean', default: true, helpAnchor: '#habits' },
  { key: 'org-habit-show-all-today', label: 'Show every habit today, even if not yet due', section: 'Agenda', type: 'boolean', default: false, helpAnchor: '#habits' },
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
  { key: 'org-agenda-include-diary', label: 'Include the diary file in the Agenda', section: 'Diary', type: 'boolean', default: false, helpAnchor: '#diary-file' },
  { key: 'diary-show-holidays-flag', label: 'Show the day\u2019s holidays with its entries', section: 'Diary', type: 'boolean', default: true, helpAnchor: '#diary-file' },
  { key: 'diary-abbreviated-year-flag', label: 'Read a two-digit year as the year it ends', section: 'Diary', type: 'boolean', default: true, helpAnchor: '#diary-file' },
  { key: 'org-xx-diary-merge-rows', label: 'Rows as Org shows them (off: one row per entry)', section: 'Diary', type: 'boolean', default: true, helpAnchor: '#diary-file' },
  {
    key: 'calendar-date-style',
    label: 'Date order (diary-anniversary, diary-block…)',
    section: 'Diary',
    type: 'select',
    default: 'american',
    options: [
      { value: 'american', label: 'American (month day year)' },
      { value: 'european', label: 'European (day month year)' },
      { value: 'iso', label: 'ISO (year month day)' },
    ],
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-time-display-form',
    label: 'Sun times: use 24-hour (else 12-hour with am/pm)',
    section: 'Diary',
    type: 'hours24',
    default: false,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-latitude',
    label: 'Latitude (sun times and weather)',
    section: 'Diary',
    type: 'number',
    default: '', // nil, as in Emacs: no place until one is set
    min: -90,
    max: 90,
    step: 0.0001,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-longitude',
    label: 'Longitude (sun times and weather)',
    section: 'Diary',
    type: 'number',
    default: '',
    min: -180,
    max: 180,
    step: 0.0001,
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
    key: 'org-xx-show-inherited-tags',
    label: 'Outline headings show inherited tags',
    section: 'Search & tags',
    type: 'boolean',
    default: true,
    helpAnchor: '#searching',
  },
  { key: 'org-tags-column', label: 'Tags column (0 = one space after the title, negative = right-aligned)', section: 'Editing', type: 'number', default: -77, min: -300, max: 300, step: 1, helpAnchor: '#configuration' },
  {
    key: 'org-priority-highest',
    label: 'Highest priority (a letter such as A, or a number such as 1)',
    section: 'Editing',
    type: 'text',
    default: 'A',
    helpAnchor: '#priorities',
  },
  {
    key: 'org-priority-lowest',
    label: 'Lowest priority (a letter such as C, or a number such as 9)',
    section: 'Editing',
    type: 'text',
    default: 'C',
    helpAnchor: '#priorities',
  },
  { key: 'org-use-sub-superscripts', label: 'Interpret _ / ^ as sub/superscript', section: 'Editing', type: 'subsuper', helpAnchor: '#inline-text-markup' },
  {
    key: 'org-ascii-text-width',
    label: 'Line width',
    section: 'ASCII',
    type: 'number',
    default: 72,
    min: 20,
    max: 200,
    step: 1,
    helpAnchor: '#export',
  },
  {
    key: 'org-ascii-charset',
    label: 'Characters',
    section: 'ASCII',
    type: 'select',
    default: 'ascii',
    options: [
      { value: 'ascii', label: 'ASCII' },
      { value: 'latin1', label: 'Latin-1' },
      { value: 'utf-8', label: 'UTF-8' },
    ],
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
  {
    key: 'org-xx-drag-handle',
    label: 'Drag handle on headings',
    section: 'Keyboard',
    type: 'select',
    default: 'right',
    options: [
      { value: 'right', label: 'Right' },
      { value: 'left', label: 'Left' },
      { value: 'off', label: 'Off' },
    ],
    helpAnchor: '#editing-your-outline',
  },
  {
    key: 'org-xx-extensions',
    label: 'Run extension scripts',
    section: 'Editing',
    type: 'select',
    default: 'off',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    helpAnchor: '#extensions',
  },
  {
    key: 'org-babel-load-languages',
    label: 'Run JavaScript source blocks',
    section: 'Editing',
    type: 'select',
    default: '((emacs-lisp . t))',
    options: [
      { value: '((emacs-lisp . t))', label: 'Off' },
      { value: '((emacs-lisp . t) (js . t))', label: 'On' },
    ],
    // Any list that holds (js . t) reads as On, whatever else it names.
    currentValue: (/** @type {string | undefined} */ raw) => (getBabelJs({ 'org-babel-load-languages': raw ?? '' }) ? '((emacs-lisp . t) (js . t))' : '((emacs-lisp . t))'),
    helpAnchor: '#source-blocks',
  },
  { key: 'display-line-numbers-mode', label: 'Show file line numbers (outline and Text view)', section: 'Editing', type: 'boolean', default: false, helpAnchor: '#line-numbers' },
  { key: 'display-line-numbers-widen', label: 'Line numbers: count the whole file when narrowed', section: 'Editing', type: 'boolean', default: false, helpAnchor: '#line-numbers' },
  {
    key: 'display-line-numbers-type',
    label: 'Line number type',
    section: 'Editing',
    type: 'select',
    default: 't',
    options: [
      { value: 't', label: 'Absolute (t)' },
      { value: 'relative', label: 'Relative to the current line' },
      { value: 'visual', label: 'Visual (counts shown lines)' },
    ],
    helpAnchor: '#line-numbers',
  },
  { key: 'org-startup-truncated', label: 'Text view: scroll long lines sideways (off wraps them)', section: 'Editing', type: 'boolean', default: true, helpAnchor: '#the-plain-text-editor' },
  { key: 'org-xx-text-font-size', label: 'Text view: text size (px)', section: 'Editing', type: 'number', default: 13, min: 9, max: 28, step: 1, helpAnchor: '#the-plain-text-editor' },
  { key: 'org-xx-windowing-threshold', label: 'Long lists: draw only the rows on screen above this many rows (0 = always draw every row)', section: 'Editing', type: 'number', default: 400, min: 0, max: 100000, step: 50, helpAnchor: '#long-lists' },
  { key: 'org-xx-lisp-init', label: 'Lisp init (settings, holiday-* lists, capture templates)', section: 'Advanced (raw syntax)', type: 'longtext', lispString: true, helpAnchor: '#holidays' },
  { key: 'org-refile-targets', label: 'Refile targets', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#refile' },
  { key: 'org-agenda-files', label: 'Agenda files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#agenda-files' },
  { key: 'org-contacts-files', label: 'Contacts files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#contacts-files' },
  { key: 'org-agenda-text-search-extra-files', label: 'Search extra files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#search-extra-files' },
  { key: 'diary-file', label: 'Diary file', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#diary-file' },
];

/** Variables whose control is a card of its own rather than a field of Quick Settings: listed by apropos-variable and the Settings search,
 *  which open that card. `card` is the card's id. */
export const CARD_CONTROLS = [
  { key: 'org-attach-method', label: 'What Attach does with a file you pick (cp, mv, ln or lns)', section: 'Attachments', default: 'cp', card: 'attach' },
  { key: 'org-html-head', label: 'Text added to the head of every HTML export', section: 'Export', default: '""', card: 'export-html' },
  { key: 'org-html-postamble', label: 'The foot of every HTML export', section: 'Export', default: 'auto', card: 'export-html' },
  { key: 'org-html-preamble', label: 'Above the content of every HTML export', section: 'Export', default: 't', card: 'export-html' },
  { key: 'org-latex-compiler', label: 'LaTeX compiler: pdflatex, xelatex or lualatex', section: 'Export', default: '"pdflatex"', card: 'export-latex' },
  { key: 'org-latex-default-class', label: 'The LaTeX class of a file that sets none', section: 'Export', default: '"article"', card: 'export-latex' },
  { key: 'org-weather-refresh-interval', label: 'Automatic weather refresh: never, or every 1, 2, 4, 6, 12 or 24 hours', section: 'Weather', default: 'never', card: 'quick:Weather' },
];
