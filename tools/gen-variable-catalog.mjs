// Writes src/variable-catalog.js: the default and one-line description of every variable that has no control in Settings (Emacs 29.3's for Emacs variables).
// Run: node tools/gen-variable-catalog.mjs   (needs emacs on the path)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DEFAULT_ORG_WEATHER_FORMAT } from '../src/org-weather.js';
import { DEFAULT_SIZE_LIMITS, formatSize } from '../src/size-limits.js';

const NAMES = `org-agenda-category-filter-preset org-agenda-cmp-user-defined org-agenda-effort-filter-preset org-agenda-max-effort
org-agenda-prefix-format org-agenda-regexp-filter-preset org-agenda-search-view-always-boolean org-agenda-search-view-force-full-words
org-agenda-search-view-max-outline-level org-agenda-tag-filter-preset calendar-bahai-all-holidays-flag calendar-christian-all-holidays-flag
calendar-hebrew-all-holidays-flag calendar-islamic-all-holidays-flag diary-hebrew-sabbath-candles-minutes diary-include-string
diary-nonmarking-symbol diary-sexp-entry-symbol org-log-into-drawer org-log-repeat org-clock-idle-time org-clock-sound
org-duration-units org-priority-get-priority-function buffer-read-only
org-agenda-clock-consistency-checks org-agenda-include-inactive-timestamps org-agenda-log-mode-add-notes org-agenda-log-mode-items
org-agenda-prefer-last-repeat org-agenda-skip-additional-timestamps-same-entry org-agenda-skip-deadline-prewarning-if-scheduled
org-agenda-skip-function org-agenda-skip-function-global org-agenda-skip-scheduled-delay-if-deadline
org-agenda-skip-scheduled-if-deadline-is-shown org-agenda-skip-timestamp-if-deadline-is-shown org-agenda-skip-timestamp-if-done
org-agenda-span org-agenda-start-day org-agenda-start-with-log-mode org-agenda-todo-ignore-deadlines org-agenda-todo-ignore-scheduled
org-agenda-todo-ignore-timestamp org-agenda-todo-ignore-with-date org-agenda-todo-list-sublevels org-deadline-past-days
org-scheduled-past-days org-stuck-projects org-icalendar-categories org-icalendar-combined-description org-icalendar-combined-name
org-icalendar-date-time-format org-icalendar-deadline-summary-prefix org-icalendar-exclude-tags org-icalendar-force-alarm
org-icalendar-scheduled-summary-prefix org-icalendar-timezone display-time-24hr-format
org-closed-keep-when-no-todo org-clock-into-drawer org-clock-out-switch-to-state org-clock-out-remove-zero-time-clocks
org-agenda-skip-archived-trees org-agenda-skip-comment-trees org-agenda-remove-times-when-in-prefix org-cite-global-bibliography
org-cite-basic-sorting-field org-cite-basic-author-year-separator org-footnote-section org-footnote-auto-label org-footnote-auto-adjust
org-footnote-define-inline org-tags-exclude-from-inheritance org-agenda-show-inherited-tags org-agenda-use-tag-inheritance
org-use-property-inheritance org-refile-allow-creating-parent-nodes org-priority-start-cycle-with-default org-priority-faces
org-priority-default org-table-duration-hour-zero-padding org-table-formula-create-columns org-export-with-broken-links org-html-doctype org-html-checkbox-type org-html-preamble-format org-html-postamble-format org-html-validation-link
org-icalendar-include-todo org-icalendar-use-scheduled org-icalendar-use-deadline org-icalendar-with-timestamps org-icalendar-alarm-time
org-agenda-sorting-strategy org-agenda-custom-commands org-modules org-inlinetask-min-level org-global-properties
org-columns-default-format org-columns-ellipses org-timer-format org-timer-default-timer org-timer-display org-crypt-key org-crypt-tag-matcher org-crypt-disable-auto-save before-save-hook diary-list-entries-hook diary-nongregorian-listing-hook diary-date-forms display-time-format large-file-warning-threshold`.split(/\s+/);

// Where this app's default is not Emacs's: the default as the app has it, and what the description says about it.
const APP_DEFAULTS = {
  'org-agenda-custom-commands': { default: 'nil', doc: 'Custom commands for the agenda (this app has no built-in "n" command; Emacs has one).' },
  'org-modules': { default: 'nil', doc: 'Modules to load with org (this app reads only org-inlinetask; Emacs loads ten by default).' },
  'large-file-warning-threshold': { default: String(DEFAULT_SIZE_LIMITS.orgFile.warn), doc: 'Size in bytes above which an Org file asks before it opens (this app: 500KB; Emacs: 10000000).' },
};

// Variables that are this app's own (or not in Emacs): no Emacs oracle for them.
const size = (bytes) => JSON.stringify(formatSize(bytes).replace(' ', ''));
const OWN = [
  { name: 'org-contacts-birthday-property', doc: 'The property that holds a contact\'s birthday or anniversary (org-contacts).', default: '"BIRTHDAY"' },
  { name: 'org-weather-format', doc: 'The template that %%(org-weather) fills in (this app\'s own).', default: JSON.stringify(DEFAULT_ORG_WEATHER_FORMAT) },
  { name: 'org-xx-extra-menu', doc: 'The entries of the floating extras (\u2630) button\'s menu (this app\'s own); the button is hidden while it is unset.', default: 'nil' },
  { name: 'org-xx-menu-aliases', doc: 'Relabels or hides buttons in the File, More, Export, Import and View menus (this app\'s own).', default: 'nil' },
  { name: 'org-xx-size-limit-org-file', doc: 'Org file: refuse above this size (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.orgFile.max) },
  { name: 'org-xx-size-limit-image', doc: 'Inline image: show up to this size; a larger one waits for a tap on Load (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.image.max) },
  { name: 'org-xx-size-limit-attachment-warn', doc: 'Attachment: ask before attaching above this size (this app\'s own; nil to never ask).', default: size(DEFAULT_SIZE_LIMITS.attachment.warn) },
  { name: 'org-xx-size-limit-attachment', doc: 'Attachment: refuse above this size (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.attachment.max) },
  { name: 'org-xx-size-limit-bibliography', doc: 'Bibliography file: skip above this size (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.bibliography.max) },
  { name: 'org-xx-size-limit-setupfile', doc: '#+SETUPFILE: skip above this size (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.setupfile.max) },
  { name: 'org-xx-size-limit-include', doc: '#+INCLUDE file: skip above this size (this app\'s own; nil for no limit).', default: size(DEFAULT_SIZE_LIMITS.include.max) },
  { name: 'org-xx-fetch-timeout', doc: 'Seconds to wait for a download to start answering (this app\'s own; nil for no timeout).', default: String(DEFAULT_SIZE_LIMITS.fetchTimeoutSeconds) },
];

const DOC_OVERRIDES = {
  'org-agenda-clock-consistency-checks': 'Limits for the clock consistency checks of the Agenda clock report (a property list).',
  'org-icalendar-timezone': 'The time zone string for iCalendar export (the system zone by default).',
};

const el = `(progn (require 'org) (require 'org-inlinetask) (require 'org-crypt) (require 'org-timer) (require 'org-footnote) (require 'oc) (require 'oc-basic) (require 'ox-html) (require 'org-table) (require 'org-agenda) (require 'org-clock) (require 'org-duration) (require 'ox-icalendar) (require 'diary-lib) (require 'holidays) (require 'cal-hebrew) (require 'cal-islam) (require 'cal-bahai) (require 'time)
(let ((print-length 40) (print-level 6))
 (dolist (v '(${NAMES.join(' ')}))
  (princ (format "%s\\t%s\\t%s\\n" v (if (boundp v) (replace-regexp-in-string "[\\n\\t]+" " " (prin1-to-string (default-value v))) "?")
    (car (split-string (or (documentation-property v 'variable-documentation t) "") "\\n")))))))`;
const out = execFileSync('emacs', ['--batch', '--eval', el], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 });
const rows = out.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t'));
const entries = rows.map(([name, def, doc]) => {
  const app = APP_DEFAULTS[/** @type {keyof typeof APP_DEFAULTS} */ (name)];
  return {
    name,
    doc: (app && app.doc) || DOC_OVERRIDES[/** @type {keyof typeof DOC_OVERRIDES} */ (name)] || doc,
    default: app ? app.default : name === 'org-icalendar-timezone' ? 'the system zone' : def.length > 90 ? def.slice(0, 87) + '...' : def,
  };
}).concat(OWN).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const missing = NAMES.filter((n) => !entries.some((e) => e.name === n));
if (missing.length) throw new Error('not found in Emacs: ' + missing.join(' '));
writeFileSync(new URL('../src/variable-catalog.js', import.meta.url), `// @ts-check
// Variables that have no control in Settings: their Emacs 29.3 default and one-line description (generated by tools/gen-variable-catalog.mjs).
// They are set from Global Variables or the Lisp init, and found by apropos-variable and the Settings search.

/** @typedef {{ name: string, doc: string, default: string }} CatalogEntry */

/** @type {CatalogEntry[]} */
export const VARIABLE_CATALOG = ${JSON.stringify(entries, null, 2)};
`);
console.log(entries.length, 'entries');
