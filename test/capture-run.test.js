// Capture templates that use Lisp: a target function, :prepare-finalize and the notes of a failing init (src/capture-run.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { bodyNodeAt, captureInto, revealAtLine } from '../src/capture-run.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const NOW = new Date(2026, 10, 7, 18, 30);
const file = (/** @type {string} */ text) => parseOrg(text);
/** @param {string} init @param {string} before @param {{ answers?: string[], runs?: number, template?: number }} [o] */
function run(init, before, o = {}) {
  const { templates, notes } = captureTemplatesFromLisp(init);
  assert.deepEqual(notes, []);
  const doc = file(before);
  const results = [];
  for (let i = 0; i < (o.runs ?? 1); i++) results.push(captureInto(doc, templates[o.template ?? 0], { now: NOW, answers: o.answers ?? [], context: {}, place: () => ({}) }));
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

test('an error in the Lisp init that sets the templates is a note, shown when the Capture list opens', () => {
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates (list (car (quote ())) (nosuchfunction 1)))`);
  assert.deepEqual(templates, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^The Lisp init could not set the capture templates: .*nosuchfunction/);
});

test('the keywords: a target function, :prepare-finalize and :before-finalize, and :after-finalize', () => {
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates '(
    ("a" "A" entry (file+function "f.org" my-fn) "* x" :prepare-finalize (my-a (lambda () (foo))) :before-finalize my-b :after-finalize my-c)
    ("b" "B" entry (function (lambda () (goto-char 1))) "* y")))`);
  assert.equal(templates.length, 2);
  assert.equal(templates[0].targetFunction, 'my-fn');
  assert.equal(templates[0].file, 'f.org');
  assert.deepEqual(templates[0].prepareFinalize, ['my-a', '(lambda nil (foo))']);
  assert.equal(templates[1].targetFunction, '(lambda nil (goto-char 1))');
  assert.deepEqual(templates[0].beforeFinalize, ['my-b']);
  assert.deepEqual(templates[0].afterFinalize, ['my-c']);
  assert.deepEqual(notes, []);
});

/** The reveal of the one capture a template makes into `before`. @param {string} template the template line @param {string} before */
function revealed(template, before) {
  const r = run(`(setq org-capture-templates '(${template}))`, before);
  const result = r.results[0];
  assert.ok(result.ok);
  return { reveal: result.ok ? result.reveal : null, doc: r.doc };
}

test('reveal: a table row is the table, the heading that holds it and the index of the new row', () => {
  const { reveal, doc } = revealed(`("t" "T" table-line (file+olp "f.org" "A") "| new |")`, '* A\n| a |\n| b |\n* B\n');
  assert.ok(reveal);
  assert.equal(reveal.heading, doc.children[0]);
  assert.equal(reveal.node, doc.children[0].body?.[0]);
  assert.equal(reveal.row, 2);
});

test('reveal: a table made new has its row last; a table with a header rule counts the rule', () => {
  const { reveal, doc } = revealed(`("t" "T" table-line (file+olp "f.org" "A") "| new |")`, '* A\ntext\n* B\n');
  assert.ok(reveal);
  assert.equal(reveal.heading, doc.children[0]);
  assert.equal(reveal.row, 2); // the empty header, the rule, the row
});

test('reveal: an item is the list item, wherever in the file the list is', () => {
  const { reveal, doc } = revealed(`("i" "I" item (file+olp "f.org" "A") "new")`, '* A\n- one\n- two\n');
  assert.ok(reveal);
  assert.equal(reveal.heading, doc.children[0]);
  assert.equal(/** @type {any} */ (reveal.node).text, 'new');
  assert.equal(reveal.row, null);
});

test('reveal: an entry is the new heading itself, the first when it is put first', () => {
  const { reveal, doc } = revealed(`("e" "E" entry (file+olp "f.org" "A") "** new" :prepend t)`, '* A\n** old\n');
  assert.ok(reveal);
  assert.equal(reveal.node, doc.children[0].children[0]);
  assert.equal(reveal.heading, reveal.node);
});

test('reveal: plain text is the block it landed in; text that is a heading is that heading', () => {
  const plain = revealed(`("p" "P" plain (file+olp "f.org" "A") "words" :empty-lines 1)`, '* A\ntext\n');
  assert.ok(plain.reveal);
  assert.equal(plain.reveal.heading, plain.doc.children[0]);
  assert.match(/** @type {any} */ (plain.reveal.node).lines.join(), /words/);
  const heading = revealed(`("p" "P" plain (file+olp "f.org" "A") "** sub")`, '* A\ntext\n');
  assert.equal(heading.reveal?.node, heading.doc.children[0].children[0]);
});

test('reveal: plain text put by a target function is found by its line, in a heading or in the text of the file', () => {
  const fn = (/** @type {string} */ to) => `(lambda () (goto-char (point-min)) ${to})`;
  const inHeading = revealed(`("p" "P" plain (function ${fn('(re-search-forward "^\\\\* B") (beginning-of-line)')}) "words\\n")`, '* A\n* B\ntext\n');
  assert.ok(inHeading.reveal);
  assert.equal(inHeading.reveal.heading, inHeading.doc.children[0]); // put before "* B": the end of A's text
  assert.match(/** @type {any} */ (inHeading.reveal.node).lines.join(), /words/);
  const inFile = revealed(`("p" "P" plain (function ${fn('')}) "words\\n")`, 'intro\n* A\n');
  assert.ok(inFile.reveal);
  assert.equal(inFile.reveal.heading, null);
  const asHeading = revealed(`("p" "P" plain (function ${fn('(re-search-forward "^\\\\* B") (beginning-of-line)')}) "* C\\n")`, '* A\n* B\ntext\n');
  assert.equal(asHeading.reveal?.node, asHeading.doc.children[1]);
});

test('bodyNodeAt and revealAtLine: a list gives its item; a line past the text gives nothing', () => {
  const doc = file('* A\nlead\n- x\n- y\n');
  assert.equal(/** @type {any} */ (bodyNodeAt(doc.children[0], 2)).text, 'y');
  assert.equal(bodyNodeAt(doc.children[0], 9), null);
  assert.equal(revealAtLine(doc, 99), null);
  assert.equal(revealAtLine(doc, 0)?.node, doc.children[0]);
});

test(':jump-to-captured t is read into the template and is not reported as unknown', async () => {
  const { captureTemplatesFromLisp } = await import('../src/capture-lisp.js');
  const on = captureTemplatesFromLisp(`(setq org-capture-templates '(("a" "A" entry (file "f.org") "* x" :jump-to-captured t) ("b" "B" entry (file "f.org") "* y" :jump-to-captured nil) ("c" "C" entry (file "f.org") "* z")))`);
  assert.deepEqual(on.notes, []);
  assert.deepEqual(on.templates.map((t) => t.jumpToCaptured), [true, false, undefined]);
});

test('the two contact templates of examples/capture-vcard.org file what the guide shows', async () => {
  const { scanPrompts } = await import('../src/capture-template.js');
  const text = readFileSync(new URL('../examples/capture-vcard.org', import.meta.url), 'utf8');
  const sources = [...text.matchAll(/#\+begin_src emacs-lisp\n([\s\S]*?)#\+end_src/g)].map((m) => m[1]);
  const shown = [...text.matchAll(/#\+begin_example\n([\s\S]*?)#\+end_example/g)].map((m) => m[1].replace(/^,\*/gm, '*'));
  const collapse = (/** @type {string} */ t) => t.split('\n').map((l) => l.replace(/ +/g, ' ').trimEnd()).join('\n').trim();
  const answersFor = (/** @type {string} */ init, /** @type {string[]} */ given) => {
    const { templates } = captureTemplatesFromLisp(init);
    const asked = scanPrompts(templates[0].template).length;
    return given.concat(Array(asked - given.length).fill(''));
  };
  const first = run(sources[0], '* New\n', { answers: answersFor(sources[0], ['Ada Lovelace', 'friends', 'ada@example.org', '+1 555 0100', '1815-12-10']) });
  assert.ok(first.results[0].ok);
  assert.equal(collapse(first.text), collapse('* New\n' + shown[0]));
  const second = run(sources[1], '* New\n', { answers: answersFor(sources[1], ['Grace', 'Hopper', 'navy', 'grace@example.org', '', '+1 555 0123', '', '', '', '', '', '1906-12-09', 'Pioneer', 'US Navy', 'Rear Admiral']) });
  assert.ok(second.results[0].ok);
  assert.equal(collapse(second.text), collapse('* New\n' + shown[2]));
});

// Checked against Emacs 29.3 (org-capture with a file that lacks the heading): file+headline makes the heading; file+olp and
// file+olp+datetree stop with "Heading not found on level N: NAME" (N the first level that is missing) and file nothing.
test('file+headline makes a missing heading; file+olp and file+olp+datetree stop at one, as Emacs does', () => {
  const made = run(`(setq org-capture-templates '(("a" "A" entry (file+headline "f.org" "Missing") "* X")))`, '* Other\n');
  assert.ok(made.results[0].ok);
  assert.equal(made.text, '* Other\n* Missing\n** X\n');
  const olp = run(`(setq org-capture-templates '(("a" "A" entry (file+olp "f.org" "Missing" "Deep") "* X")))`, '* Other\n');
  assert.deepEqual(olp.results[0], { ok: false, message: 'Capture failed: Heading not found on level 1: Missing' });
  assert.equal(olp.text, '* Other\n');
  const deep = run(`(setq org-capture-templates '(("a" "A" entry (file+olp "f.org" "Missing" "Deep") "* X")))`, '* Other\n* Missing\n');
  assert.deepEqual(deep.results[0], { ok: false, message: 'Capture failed: Heading not found on level 2: Deep' });
  const tree = run(`(setq org-capture-templates '(("a" "A" entry (file+olp+datetree "f.org" "Missing" "Deep") "* X")))`, '* Other\n* Missing\n');
  assert.deepEqual(tree.results[0], { ok: false, message: 'Capture failed: Heading not found on level 2: Deep' });
});

// Emacs runs :after-finalize once the entry is filed, also when it is the only keyword; its failure does not undo the capture.
test(':after-finalize runs after the entry is filed, and a failing one is reported without undoing it', () => {
  const ok = run(`(defun my-after () (message "done")) (setq org-capture-templates '(("a" "A" entry (file "f.org") "* X" :after-finalize my-after)))`, '* Other\n');
  assert.equal(ok.text, '* Other\n* X\n');
  assert.equal(/** @type {any} */ (ok.results[0]).afterFinalizeMessage, undefined);
  const bad = run(`(setq org-capture-templates '(("a" "A" entry (file "f.org") "* X" :after-finalize no-such-function)))`, '* Other\n');
  assert.equal(bad.text, '* Other\n* X\n');
  assert.match(/** @type {any} */ (bad.results[0]).afterFinalizeMessage, /no-such-function/);
});

test('a level-2 heading made before a level-1 one is a child of the heading above it in the tree, not a top-level one', () => {
  const init = `(defun my-sub ()
  (goto-char (point-min)) (re-search-forward "^\\\\* Alpha$") (forward-line 1)
  (goto-char (or (and (re-search-forward "^\\\\* " nil t) (match-beginning 0)) (point-max)))
  (insert "** Made\\n") (forward-line -1) (beginning-of-line))
(setq org-capture-templates '(("a" "A" item (file+function "f.org" my-sub) "one")))`;
  const { doc, text } = run(init, '* Alpha\n** Old\n* Beta\n');
  assert.equal(text, '* Alpha\n** Old\n** Made\n- one\n* Beta\n');
  assert.deepEqual(doc.children.map((h) => h.title), ['Alpha', 'Beta']);
  assert.deepEqual(doc.children[0].children.map((h) => h.title), ['Old', 'Made']);
});

test('a target function reads the template through org-capture-get, as in Emacs (values checked against Emacs 29.3: :prepend t, :type item, :key "j", :template "%?", missing keys nil)', () => {
  const init = `(defun my-t ()
  (goto-char (point-min))
  (org-capture-put :mine 5)
  (insert (format "** %S\\n" (list (org-capture-get :prepend) (org-capture-get :type) (org-capture-get :key) (org-capture-get :description) (org-capture-get :template) (org-capture-get :nothere) (org-capture-get :mine) (plist-get org-capture-plist :empty-lines)))))
(setq org-capture-templates '(("j" "Journal" item (file+function "f.org" my-t) "%?" :prepend t :empty-lines 1)))`;
  const { text } = run(init, '* A\n');
  assert.ok(text.startsWith('** (t item "j" "Journal" "%?" nil 5 1)\n'), text);
});

test('keywords first met in the init text still evaluate to themselves afterwards', () => {
  const { text } = run(`(defun my-t () (goto-char (point-min)) (insert (format "** %S\\n" (eq :first-seen-here :first-seen-here))) (insert (format "** %S\\n" (plist-get '(:first-seen-here 3) :first-seen-here))))
(setq org-capture-templates '(("j" "J" entry (file+function "f.org" my-t) "* new")))`, '* A\n');
  assert.ok(text.startsWith('** t\n** 3\n'), text);
});
