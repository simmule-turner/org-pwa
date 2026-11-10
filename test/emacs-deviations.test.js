// Holds the code and the documents to Emacs's own words. Capture keywords, and the settings whose value is a Lisp form, are Emacs's; a
// word that Emacs does not have and that the app once added must not come back, in the code, the README or the examples.
// EMACS_CAPTURE_KEYWORDS is every keyword in the documentation of org-capture-templates in Emacs 29.3 (Org 9.6):
//   (documentation-property 'org-capture-templates 'variable-documentation)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { QUICK_SETTINGS_FIELDS } from '../src-browser/settings-fields.js';

const EMACS_CAPTURE_KEYWORDS = new Set([
  ':after-finalize', ':before-finalize', ':clock-in', ':clock-keep', ':clock-resume', ':empty-lines', ':empty-lines-after', ':empty-lines-before',
  ':hook', ':immediate-finish', ':jump-to-captured', ':kill-buffer', ':no-save', ':prepare-finalize', ':prepend', ':refile-targets',
  ':table-line-pos', ':time-prompt', ':tree-type', ':unnarrowed',
]);
/** Words the app once added to capture templates; Emacs has an equivalent (a target function or :prepare-finalize), so they were removed. */
const REMOVED = [':omit-empty-entries', ':prepend-heading', ':table-header', ':pre-text', ':post-text'];
const REMOVED_FIELDS = ['omitEmptyEntries', 'prependHeading', 'tableHeader', 'preText', 'postText'];

const read = (/** @type {string} */ path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sourceFiles = (/** @type {string} */ dir) => readdirSync(new URL('../' + dir, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
/** The text with the contents of its "strings" taken out, so a tag inside a template (":meeting:") is not read as a keyword. @param {string} text */
const withoutStrings = (text) => text.replace(/"(?:[^"\\]|\\[\s\S])*"/g, '""');
/** The keywords (":word") that appear in `text`. @param {string} text */
const keywordsIn = (text) => new Set([...withoutStrings(text).matchAll(/(?:^|[\s(])(:[a-z][a-z-]*)(?![\w-])/g)].map((m) => m[1]));
/** The emacs-lisp blocks of an org text that set up capture templates. @param {string} org */
const captureBlocks = (org) => [...org.matchAll(/#\+begin_src emacs-lisp\n([\s\S]*?)#\+end_src/gi)].map((m) => m[1]).filter((b) => b.includes('org-capture-templates'));

test('every capture keyword the code reads is one Emacs has', () => {
  const found = new Set([...read('src/capture-lisp.js').matchAll(/'(:[a-z][a-z-]*)'/g)].map((m) => m[1]));
  assert.ok(found.size > 10, 'the keywords were found');
  const extra = [...found].filter((k) => !EMACS_CAPTURE_KEYWORDS.has(k));
  assert.deepEqual(extra, [], 'capture-lisp.js reads a keyword that Emacs does not have');
});

test('every capture keyword in the README and the examples is one Emacs has', () => {
  const readme = read('README.org');
  const section = readme.slice(readme.indexOf(':CUSTOM_ID: capture-templates'), readme.indexOf('*** Capturing from other apps'));
  assert.ok(section.length > 1000);
  const places = [{ name: 'README.org', blocks: captureBlocks(readme) }];
  for (const f of readdirSync(new URL('../examples', import.meta.url)).filter((x) => x.endsWith('.org'))) places.push({ name: 'examples/' + f, blocks: captureBlocks(read('examples/' + f)) });
  let seen = 0;
  for (const { name, blocks } of places) {
    for (const block of blocks) {
      for (const k of keywordsIn(block)) {
        seen++;
        if (!EMACS_CAPTURE_KEYWORDS.has(k)) assert.fail(`${name} uses the capture keyword ${k}, which Emacs does not have`);
      }
    }
  }
  assert.ok(seen > 5, 'the examples were found');
  // the keywords the section names between ~ ~ marks
  for (const m of section.matchAll(/~(:[a-z][a-z-]*)[ ~]/g)) {
    if (!EMACS_CAPTURE_KEYWORDS.has(m[1])) assert.fail(`the Capture section of the README names ${m[1]}, which Emacs does not have`);
  }
});

test('the options that were removed in favor of Emacs’s own way do not come back', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('src-browser'), 'app.js', 'README.org', ...readdirSync(new URL('../examples', import.meta.url)).filter((x) => x.endsWith('.org')).map((f) => 'examples/' + f)];
  for (const file of files) {
    const text = read(file);
    for (const word of REMOVED) if (new RegExp(word.replace(/-/g, '\\-') + '(?![\\w-])').test(text)) assert.fail(`${file} mentions ${word}, which was removed (use a target function or :prepare-finalize)`);
    if (file.endsWith('.js')) for (const field of REMOVED_FIELDS) if (new RegExp('\\b' + field + '\\b').test(text)) assert.fail(`${file} still has the capture field ${field}`);
  }
});

/** Settings the app once had of its own, each now an Emacs variable (the second name) or, for the last two, the Lisp init. */
const RENAMED = [
  ['org-xx-text-wrap', 'org-startup-truncated'], ['org-xx-size-limit-org-file-warn', 'large-file-warning-threshold'],
  ['org-xx-text-line-numbers', 'display-line-numbers-mode'], ['org-xx-latex-header', 'org-latex-packages-alist'], ['org-xx-latex-init', 'the Lisp init'],
];

test('the own settings that Emacs variables replaced do not come back', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('src-browser'), 'app.js', 'README.org', ...readdirSync(new URL('../docs', import.meta.url)).filter((x) => x.endsWith('.org')).map((f) => 'docs/' + f), ...readdirSync(new URL('../examples', import.meta.url)).filter((x) => x.endsWith('.org')).map((f) => 'examples/' + f)];
  for (const file of files) {
    const text = read(file);
    for (const [old, now] of RENAMED) if (text.includes(old)) assert.fail(`${file} mentions ${old}; it is ${now} now`);
  }
});

test('the Global Variables text is read as (setq ...) forms, not as the old name: value lines', async () => {
  const { parseGlobalVariables } = await import('../src/global-variables.js');
  assert.deepEqual(parseGlobalVariables("org-log-done: 'time"), {});
  assert.deepEqual(parseGlobalVariables("(setq org-log-done 'time)"), { 'org-log-done': "'time" });
});

/** Settings whose value is written as Emacs writes it: a Lisp list, alist or string. */
const EMACS_FORM = new Set([
  'org-agenda-sorting-strategy', 'org-agenda-custom-commands', 'org-modules', 'org-inlinetask-min-level', 'org-refile-targets', 'org-global-properties',
  'org-agenda-files', 'org-contacts-files', 'org-agenda-text-search-extra-files', 'diary-file', 'diary-list-entries-hook',
  'diary-nongregorian-listing-hook', 'diary-date-forms',
]);

test('every free-text setting is either written as Emacs writes it or is one of the app’s own (org-xx-)', () => {
  const longtext = QUICK_SETTINGS_FIELDS.filter((f) => f.type === 'longtext').map((f) => f.key);
  assert.ok(longtext.length > 10);
  const unclassified = longtext.filter((k) => !EMACS_FORM.has(k) && !k.startsWith('org-xx-'));
  assert.deepEqual(unclassified, [], 'a free-text setting needs Emacs’s syntax (add it to EMACS_FORM once its value is read the way Emacs writes it) or an org-xx- name');
  const gone = [...EMACS_FORM].filter((k) => !longtext.includes(k));
  assert.deepEqual(gone, [], 'EMACS_FORM names a setting that is no longer free text');
});

test('the settings that were changed to Emacs’s form do not read the old text', async () => {
  const { parseAgendaFilesVar } = await import('../src/local-variables.js');
  const { parseRefileTargetsWithErrors } = await import('../src/refile.js');
  const { parseGlobalProperties } = await import('../src/effort-values.js');
  assert.deepEqual(parseAgendaFilesVar('github:a.org;webdav:b.org'), []);
  assert.deepEqual(parseRefileTargetsWithErrors('current maxlevel=3').entries, []);
  assert.deepEqual(parseGlobalProperties('Effort_ALL: 0:10'), {});
});

test('a list or symbol value written quoted, as Emacs writes it, is read like the unquoted one', async () => {
  const { getUseSubSuperscripts, getTimeDisplayForm } = await import('../src/local-variables.js');
  assert.equal(getUseSubSuperscripts({ 'org-use-sub-superscripts': "'{}" }), '{}');
  assert.equal(getUseSubSuperscripts({ 'org-use-sub-superscripts': "'nil" }), 'nil');
  assert.equal(getTimeDisplayForm({ 'calendar-time-display-form': `'(24-hours ":" minutes)` }), '(24-hours ":" minutes)');
});
