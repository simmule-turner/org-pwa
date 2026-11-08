// Capture templates that use Lisp: a target function, :prepare-finalize and the notes of a failing init (src/capture-run.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { captureInto } from '../src/capture-run.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const NOW = new Date(2026, 10, 7, 18, 30);
const file = (/** @type {string} */ text) => parseOrg(text);
/** @param {string} init @param {string} before @param {{ answers?: string[], runs?: number, template?: number }} [o] */
function run(init, before, o = {}) {
  const { templates, notes } = captureTemplatesFromLisp(init);
  assert.deepEqual(notes, []);
  const doc = file(before);
  const results = [];
  for (let i = 0; i < (o.runs ?? 1); i++) results.push(captureInto(doc, templates[o.template ?? 0], { now: NOW, answers: o.answers ?? [], context: {}, preText: '', postText: '', place: () => ({}) }));
  return { doc, text: serializeOrg(doc), results };
}

const YEAR = `
(defun my-year-heading ()
  (let ((year (format-time-string "%Y")))
    (goto-char (point-min))
    (unless (re-search-forward (format "^\\\\* %s$" year) nil t)
      (goto-char (point-max))
      (insert "* " year "\\n")
      (forward-line -1))
    (beginning-of-line)))
(setq org-capture-templates '(("a" "Appointment" entry (file+function "calendar.org" my-year-heading) "* Dentist %<%F %a>\\n")))`;

test('a target function that makes the year heading: twice, the heading is made once and both entries are its children', () => {
  const r = run(YEAR, '* 2025\n** old\n* Other\n', { runs: 2 });
  assert.equal(r.text, '* 2025\n** old\n* Other\n* 2026\n** Dentist 2026-11-07 Sat\n** Dentist 2026-11-07 Sat\n');
});

test('the function sees the whole file with point at its start, and the heading it leaves point on is the place', () => {
  const init = `(setq org-capture-templates '(("a" "A" entry (function (lambda () (goto-char (point-min)) (re-search-forward "^\\\\* Other") (beginning-of-line))) "* New")))`;
  const r = run(init, '* 2025\n* Other\n** Inside\n* Last\n');
  assert.equal(r.text, '* 2025\n* Other\n** Inside\n** New\n* Last\n');
});

test('a function that changes or deletes a line files nothing and says so', () => {
  for (const body of ['(goto-char (point-min)) (delete-char 2)', '(goto-char (point-min)) (insert "x")', '(erase-buffer)']) {
    const r = run(`(setq org-capture-templates '(("a" "A" entry (file+function "f.org" (lambda () ${body})) "* New")))`, '* A\nbody\n');
    assert.equal(r.text, '* A\nbody\n');
    const result = r.results[0];
    assert.ok(!result.ok);
    assert.match(result.message, /The target function changed the file; only inserting is supported/);
  }
});

test('an error in a target function stops the capture with Emacs\'s message', () => {
  const r = run(`(setq org-capture-templates '(("a" "A" entry (file+function "f.org" (lambda () (re-search-forward "nowhere"))) "* New")))`, '* A\n');
  assert.equal(r.text, '* A\n');
  const result = r.results[0];
  assert.ok(!result.ok);
  assert.match(result.message, /Search failed: "nowhere"/);
});

test('an item, a plain text and a table row are filed where the function leaves point', () => {
  const heading = '(goto-char (point-min)) (re-search-forward "^\\\\* Log") (beginning-of-line)';
  const item = run(`(setq org-capture-templates '(("a" "A" item (file+function "f.org" (lambda () ${heading})) "one")))`, '* Log\n- zero\n* Z\n');
  assert.equal(item.text, '* Log\n- zero\n- one\n* Z\n');
  const row = run(`(setq org-capture-templates '(("a" "A" table-line (file+function "f.org" (lambda () ${heading})) "| x | y |")))`, '* Log\n| a | b |\n* Z\n');
  assert.equal(row.text, '* Log\n| a | b |\n| x | y |\n* Z\n');
  const plain = run(`(setq org-capture-templates '(("a" "A" plain (file+function "f.org" (lambda () (goto-char (point-min)) (forward-line 1))) "note")))`, '* Log\n* Z\n');
  assert.equal(plain.text, '* Log\nnote\n* Z\n');
});

test('a function may insert several lines: a heading and a table with its formula, and the row lands in the table', () => {
  const init = `(setq org-capture-templates '(("t" "T" table-line
    (file+function "f.org" (lambda () (goto-char (point-max)) (unless (save-excursion (goto-char (point-min)) (re-search-forward "^\\\\* Month" nil t)) (insert "* Month\\n|   |   |\\n|---|---|\\n#+TBLFM: $1=@#-1\\n")) (goto-char (point-min)) (re-search-forward "^\\\\* Month") (beginning-of-line)))
    "| | v |")))`;
  const r = run(init, '* Top\n', { runs: 2 });
  assert.equal(r.text, '* Top\n* Month\n|   |   |\n|---+---|\n|   | v |\n|   | v |\n#+TBLFM: $1=@#-1\n');
});

test(':prepare-finalize runs a symbol, a lambda or a list of them on the expanded text, point at its start, and the buffer is filed', () => {
  const defs = `(defun up () (let ((s (upcase (buffer-string)))) (erase-buffer) (insert s)))`;
  const upcase = (/** @type {string} */ fn) => run(`${defs}\n(setq org-capture-templates '(("a" "A" entry (file "f.org") "* hello %<%Y>" :prepare-finalize ${fn})))`, '* A\n').text;
  assert.equal(upcase('up'), '* A\n* HELLO 2026\n');
  assert.equal(upcase('(lambda () (goto-char (point-min)) (insert "x"))'), '* A\nx* hello 2026\n');
  assert.equal(upcase('(up (lambda () (goto-char (point-max)) (insert " end")))'), '* A\n* HELLO 2026\n end\n');
});

test('an error in a :prepare-finalize function shows its message and files nothing', () => {
  const r = run(`(setq org-capture-templates '(("a" "A" entry (file "f.org") "* x" :prepare-finalize (lambda () (error "No good %d" 7)))))`, '* A\n');
  assert.equal(r.text, '* A\n');
  const result = r.results[0];
  assert.ok(!result.ok);
  assert.match(result.message, /No good 7/);
});

test('the vCard function and the omitEmptyEntries option file the same document', () => {
  const sec = readFileSync(new URL('../examples/capture-functions.org', import.meta.url), 'utf8').split(/^\* /m).find((s) => s.startsWith('Contact without'));
  assert.ok(sec);
  const init = /#\+BEGIN_SRC emacs-lisp\n([\s\S]*?)#\+END_SRC/.exec(sec)?.[1] ?? '';
  const { templates } = captureTemplatesFromLisp(init);
  const lispTemplate = templates[0];
  assert.ok(lispTemplate.prepareFinalize?.length);
  const json = { key: 'v', description: 'vCard', type: 'plain', olp: ['New'], file: 'contacts.org', omitEmptyEntries: true, template: lispTemplate.template };
  const answers = ['Ann', 'Lee', '', 'ann@x.org', '555-1', '', '', 'Troy', 'NY', '', '', '', '', ''];
  const fill = (/** @type {any} */ template) => {
    const doc = file('* New\n** existing\n');
    const r = captureInto(doc, template, { now: NOW, answers, context: {}, preText: '', postText: '', place: () => ({}) });
    assert.ok(r.ok, r.ok ? '' : r.message);
    return serializeOrg(doc);
  };
  const viaLisp = fill(lispTemplate);
  assert.match(viaLisp, /\*\* Ann Lee\nBEGIN:VCARD/);
  assert.equal(fill(json), viaLisp);
});

test('an error in the Lisp init that sets the templates is a note, shown when the Capture list opens', () => {
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates (list (car (quote ())) (nosuchfunction 1)))`);
  assert.deepEqual(templates, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^The Lisp init could not set the capture templates: .*nosuchfunction/);
});

test('the keywords: a target function, :prepare-finalize and the finalize keywords the app does not run', () => {
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates '(
    ("a" "A" entry (file+function "f.org" my-fn) "* x" :prepare-finalize (my-a (lambda () (foo))) :before-finalize my-b)
    ("b" "B" entry (function (lambda () (goto-char 1))) "* y")))`);
  assert.equal(templates.length, 2);
  assert.equal(templates[0].targetFunction, 'my-fn');
  assert.equal(templates[0].file, 'f.org');
  assert.deepEqual(templates[0].prepareFinalize, ['my-a', '(lambda nil (foo))']);
  assert.equal(templates[1].targetFunction, '(lambda nil (goto-char 1))');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /:before-finalize/);
});
