// Writes examples/settings.org: every variable the app reads, alphabetically, each as a commented-out (setq NAME DEFAULT) with a
// one-line description, as an init file shows them. A * marks a variable with no control in Settings (src/variable-catalog.js).
// The defaults of Emacs's own variables are asked of Emacs 29.3, and stored in test/fixtures/settings-defaults.json so the
// check (test/example-settings.test.js) needs no Emacs. Run: node tools/gen-settings-example.mjs   (needs emacs on the path)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';

/** The variables that have a control in Settings. `own`: this app's own, with its default as Lisp. `app`: this app's default where it
 *  is not Emacs's, as Lisp; `none`: nothing is set by default (a note says what then happens). */
const CONTROLLED = [
  ['calendar-date-style', "Order of a date in diary entries: american, european or iso."],
  ['calendar-latitude', 'Latitude for sun times and org-weather.'],
  ['calendar-longitude', 'Longitude for the same.'],
  ['calendar-time-display-form', 'How solar-time-string shows a time.', { emacs: '(12-hours ":" minutes am-pm (if time-zone " (") time-zone (if time-zone ")"))' }],
  ['diary-abbreviated-year-flag', 'Whether a two-digit year in a diary date is the year it ends.'],
  ['diary-file', 'The diary: one github:, webdav: or local: file.', { none: 'no diary', note: 'Emacs: "~/.emacs.d/diary"' }],
  ['diary-show-holidays-flag', "Whether a day's holidays are listed with its diary entries."],
  ['display-time-mode', "Whether the mode line shows the date and time: 1 on, 0 off."],
  ['display-line-numbers-mode', "Whether each row shows its line number in the file."],
  ['display-line-numbers-type', 'How lines are numbered: t, relative or visual.', { emacs: 't' }],
  ['display-line-numbers-widen', 'Whether a narrowed outline keeps the file’s own line numbers.'],
  ['org-agenda-files', 'More files for the Agenda and TODO views.', { app: 'nil', note: 'nil: the open file only' }],
  ['org-agenda-include-diary', 'Whether the entries of diary-file are in the Agenda.'],
  ['org-agenda-show-all-dates', 'Whether days with nothing on them show in the Agenda.'],
  ['org-agenda-show-future-repeats', 'Whether repeating items show in the future part of the Agenda.'],
  ['org-agenda-start-on-weekday', "The Week view's first day: 0 is Sunday through 6 Saturday."],
  ['org-agenda-text-search-extra-files', 'More files for text search only.'],
  ['org-ascii-charset', 'Characters used by ASCII export: ascii, latin1 or utf-8.'],
  ['org-ascii-text-width', 'Wrap width, in characters, for ASCII export.'],
  ['org-attach-method', 'What Attach does with a file: cp, mv, ln or lns.'],
  ['org-babel-load-languages', 'Languages whose source blocks may run; (js . t) allows js.'],
  ['org-contacts-files', 'More files for Contacts (.vcf) export.', { own: 'nil' }],
  ['org-cycle-open-archived-trees', 'nil: an archived heading starts folded and swipe will not open it.'],
  ['org-deadline-warning-days', 'Days before its date that a DEADLINE starts to show.'],
  ['org-habit-following-days', "Days shown after today in a habit's strip."],
  ['org-habit-preceding-days', "Days shown before today in a habit's strip."],
  ['org-habit-show-all-today', 'Whether every habit shows today, even one not yet due.'],
  ['org-habit-show-habits-only-for-today', "Whether habits appear only in today's Agenda."],
  ['org-html-head', 'Text added to the <head> of every HTML export.'],
  ['org-html-postamble', 'The foot of every HTML export: auto (date, author, email, Created, validation link), nil, t (org-html-postamble-format), a format string or a function.'],
  ['org-html-preamble', 'Above the content of every HTML export: t, nil or a format string.', { note: 't uses org-html-preamble-format, which is empty by default: nothing is added above the content' }],
  ['org-latex-compiler', 'pdflatex, xelatex or lualatex.'],
  ['org-latex-default-class', 'The class of a LaTeX export whose file sets none.'],
  ['org-log-done', "'time adds a CLOSED: stamp when a heading becomes DONE; 'note asks for a note too."],
  ['org-priority-highest', 'The highest priority, a character or a number.'],
  ['org-priority-lowest', 'The lowest priority.'],
  ['org-refile-targets', 'Which headings Refile offers.', { app: 'nil', note: 'nil: the open file, top level' }],
  ['org-scheduled-delay-days', 'Days a scheduled item with no delay of its own waits before it shows.'],
  ['org-startup-folded', "The initial visibility: overview, content, showall, showeverything or show2levels to show5levels."],
  ['org-startup-indented', 'Whether text, lists and tables are indented under their heading (org-indent-mode).'],
  ['org-startup-truncated', 'Whether long lines of the Text view scroll sideways.'],
  ['org-startup-with-inline-images', 'Whether images render inline when a file opens.'],
  ['org-tags-column', "Where a heading's tags sit: 0 one space after the title, negative right-aligns."],
  ['org-use-sub-superscripts', 'How a_b and a^b are read: t, {} or nil.'],
  ['org-use-tag-inheritance', 'Whether a tag search matches inherited tags.'],
  ['org-weather-refresh-interval', 'never, or a refresh every 1, 2, 4, 6, 12 or 24 hours.', { own: "'never" }],
  ['org-weather-speed-unit', 'km/h, m/s, mph or Knots.', { own: '"mph"' }],
  ['org-weather-temperature-unit', '°C or °F.', { own: '"°F"' }],
  ['org-xx-diary-merge-rows', "Whether a diary line without a time joins the row before it, as Org's agenda does.", { own: 't' }],
  ['org-xx-drag-handle', 'Where the drag grip sits on a heading: right, left or off.', { own: "'right" }],
  ['org-xx-extensions', 'on lets the approved init script run.', { own: "'off" }],
  ['org-xx-god-mode-button', 'Whether the floating [g] god-mode button is shown.', { own: 't' }],
  ['org-xx-indent-tables', 'With org-startup-indented on, whether tables are indented too.', { own: 't' }],
  ['org-xx-lisp-init', 'Emacs Lisp run like an init file.', { own: 'nil' }],
  ['org-xx-show-inherited-tags', 'Whether the outline shows inherited tags, dimmed.', { own: 't' }],
  ['org-xx-startup-with-show-photos', "Whether a contact's photo shows as a thumbnail when a file opens.", { own: 'nil' }],
  ['org-xx-text-font-size', "The Text view's text size in pixels, 9 to 28.", { own: '13' }],
  ['org-xx-windowing-threshold', 'Above this many rows only the rows near the screen are drawn; 0 draws all.', { own: '400' }],
  ['recentf-max-saved-items', 'How many files Recently opened keeps.'],
];

/** @param {string} lisp a value as Emacs prints it, @returns {string} as it is written after a quote in a setq */
function asForm(lisp) {
  if (/^(nil|t|-?\d+(\.\d+)?|"[\s\S]*"|\?.|'.*)$/.test(lisp)) return lisp;
  return `'${lisp}`;
}

const cut = VARIABLE_CATALOG.filter((c) => c.default.endsWith('...')).map((c) => c.name); // the catalog shortens long defaults for display
const emacsNames = [...CONTROLLED.filter(([, , o]) => !o || !o.own).map(([n]) => n), ...cut];
const askEmacs = () => {
  const forms = emacsNames.map((n) => `(princ (format "%s\\t%s\\n" '${n} (if (boundp '${n}) (let ((print-length nil) (print-level nil)) (prin1-to-string (default-value '${n}))) "UNBOUND")))`).join('');
  const out = execFileSync('emacs', ['--batch', '-Q', '--eval', `(progn (dolist (f '(org org-agenda org-habit org-attach ox-html ox-latex ox-ascii org-clock diary-lib calendar solar display-line-numbers ob recentf)) (require f)) ${forms})`], { encoding: 'utf8' });
  const defaults = {};
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t([\s\S]*)$/.exec(line);
    if (m) defaults[m[1]] = m[2];
  }
  return defaults;
};
const emacs = askEmacs();
writeFileSync(new URL('../test/fixtures/settings-defaults.json', import.meta.url), `${JSON.stringify(emacs, null, 1)}\n`);

/** @type {{ name: string, star: boolean, doc: string, value: string | null, note: string }[]} */
const rows = VARIABLE_CATALOG.map((c) => ({
  name: c.name, star: true, doc: c.doc, note: '',
  value: c.default === 'the system zone' ? 'nil' : asForm(cut.includes(c.name) ? emacs[c.name] : c.default),
}));
for (const [name, doc, o = {}] of CONTROLLED) {
  let value = null;
  let note = o.note || '';
  if (o.own) value = o.own;
  else if (o.app) value = o.app;
  else if (o.none) { note = `${o.none}${note ? `; ${note}` : ''}`; }
  else {
    const raw = o.emacs ?? emacs[name];
    if (raw === undefined || raw === 'UNBOUND') throw new Error(`no Emacs default for ${name}`);
    value = /^(65|66|67)$/.test(raw) && name.startsWith('org-priority') ? `?${String.fromCharCode(Number(raw))}` : asForm(raw);
  }
  rows.push({ name, star: false, doc, value, note });
}
rows.sort((a, b) => (a.name < b.name ? -1 : 1));

const lines = rows.map((r) => {
  const head = `;; ${r.star ? '*' : ' '} ${r.name}: ${r.doc.replace(/\s+/g, ' ')}`;
  const form = r.value === null ? `;; (setq ${r.name} VALUE)` : `;; (setq ${r.name} ${r.value})`;
  return `${head}\n${form}${r.note ? `   ; ${r.note}` : ''}`;
});

const text = `#+TITLE: Every setting, with its default
#+STARTUP: showall

Every variable the app reads, in alphabetical order, as it would stand in the Lisp init (Settings → Advanced → *Lisp init*) or in Global Variables. Each is a commented-out ~(setq NAME DEFAULT)~ with a one-line description: remove the two semicolons to set it. A ~*~ before a name means the variable has no control in Settings; it is set here, or in Global Variables, only. The defaults of Emacs's variables are Emacs 29.3's; a note says where the app starts from something else.

Setting every line below to the value shown changes nothing.

#+BEGIN_SRC emacs-lisp
${lines.join('\n\n')}
#+END_SRC
`;
writeFileSync(new URL('../examples/settings.org', import.meta.url), text);
console.log(`${rows.length} variables, ${rows.filter((r) => r.star).length} without a control`);
