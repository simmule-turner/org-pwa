import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { insertCapture, resolveOlpTarget } from '../src/capture-template.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { expandLoads } from '../src/lisp-load.js';

const INIT = `
(setq org-capture-templates
  '(("a" "Appointment" entry (file+olp "github:calendar.org" "Calendar") "* %^{Description} %^T\\n%?"
     :prepend t)
    ("j" "Journal" item
     (file+olp "github:home.org" "Journal" "Log") "%<%H:%M> - %?" :prepend t)
    ("t" "Tracking" table-line (file+olp "home.org" "Tracking")
     "| @# | %<%Y-%m-%d> | %<%H%M> ||")))
`;

/** A template without its org-capture-plist, which these tests do not look at. @param {object} t */
const bare = (t) => { const { plist: _plist, ...rest } = /** @type {any} */ (t); return rest; };

test('templates written in Lisp become the template objects the app runs', () => {
  const { templates, notes } = captureTemplatesFromLisp(INIT);
  assert.deepEqual(notes, []);
  assert.deepEqual(bare(templates[0]), { key: 'a', description: 'Appointment', type: 'entry', olp: ['Calendar'], olpMustExist: true, template: '* %^{Description} %^T\n%?', file: 'github:calendar.org', prepend: true });
  assert.deepEqual(bare(templates[1]), { key: 'j', description: 'Journal', type: 'item', olp: ['Journal', 'Log'], olpMustExist: true, template: '%<%H:%M> - %?', file: 'github:home.org', prepend: true });
  assert.deepEqual(bare(templates[2]), { key: 't', description: 'Tracking', type: 'table-line', olp: ['Tracking'], olpMustExist: true, template: '| @# | %<%Y-%m-%d> | %<%H%M> ||', file: 'home.org' });
});

test('keywords that only this app once had are reported as unknown, not carried out', () => {
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates '(("a" "A" entry (file "a.org") "* x" :omit-empty-entries t :prepend-heading t :table-header nil :pre-text "p" :post-text "q")))`);
  assert.equal(templates.length, 1);
  assert.deepEqual(Object.keys(bare(templates[0])).sort(), ['description', 'file', 'key', 'olp', 'template', 'type']);
  assert.deepEqual(notes.map((n) => n.replace(/^.*": /, '')), [':omit-empty-entries is not known and has no effect.', ':prepend-heading is not known and has no effect.', ':table-header is not known and has no effect.', ':pre-text is not known and has no effect.', ':post-text is not known and has no effect.']);
});

test('add-to-list puts a template first, and a group heading or a template that cannot be read is reported or skipped', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates '(("w" "Work") ("wt" "Task" entry (file+headline "w.org" "Tasks") "* TODO %?" :empty-lines 1)
                                  ("d" "Dated" entry (file+datetree+prompt "d.org") "* %?")
                                  ("f" "Fn" entry (clock) "* %?")))
    (add-to-list 'org-capture-templates '("n" "Note" plain (file "inbox.org") "* %?"))`);
  assert.deepEqual(templates.map((t) => t.key), ['n', 'wt']);
  assert.deepEqual(templates[0].olp, []);
  assert.deepEqual(templates[1].olp, ['Tasks']);
  assert.equal(notes.length, 2);
  assert.equal(templates[1].emptyLines, 1);
  assert.match(notes.join(' '), /"d" is left out.*file\+datetree\+prompt/);
  assert.match(notes.join(' '), /"f" is left out/);
});

test('an entry goes under its heading, or at the file’s top level when the target has no heading', () => {
  const doc = parseOrg('* Tasks\n** Old\n');
  const under = resolveOlpTarget(doc, ['Tasks']);
  insertCapture(under, 'entry', '* TODO New', true);
  assert.equal(serializeOrg(doc), '* Tasks\n** TODO New\n** Old\n');
  const top = parseOrg('* One');
  insertCapture(top, 'entry', '* Two');
  assert.equal(serializeOrg(top), '* One\n* Two');
});

test('blank lines and the table row are read from their keywords', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates
      '(("t" "Row" table-line (file+headline "t.org" "Log") "| @# | %U |"
         :empty-lines 1 :empty-lines-before 2 :empty-lines-after 0 :table-line-pos "I+1" :unnarrowed t)
        ("b" "Bad" entry (file "b.org") "* %?" :empty-lines "x" :table-line-pos 3)))`);
  assert.deepEqual(bare(templates[0]), { key: 't', description: 'Row', type: 'table-line', olp: ['Log'], template: '| @# | %U |', file: 't.org', emptyLines: 1, emptyLinesBefore: 2, emptyLinesAfter: 0, tableLinePos: 'I+1' });
  assert.deepEqual(notes, ['Capture template "b": :empty-lines needs a whole number and is ignored.', 'Capture template "b": :table-line-pos needs a string and is ignored.']);
});

test(':immediate-finish, :time-prompt, the clock keywords and :before-finalize are read; :refile-targets is said to do nothing', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates
      '(("a" "A" entry (file+olp+datetree "a.org") "* %?" :immediate-finish t :time-prompt t :clock-in t :clock-keep t :clock-resume nil :before-finalize (lambda () (insert "x")))
        ("b" "B" entry (file "b.org") "* %?" :after-finalize my-after :refile-targets ((nil :maxlevel . 2)))))`);
  assert.deepEqual(bare(templates[0]), { key: 'a', description: 'A', type: 'entry', olp: [], olpMustExist: true, template: '* %?', file: 'a.org', datetree: true, immediateFinish: true, timePrompt: true, clockIn: true, clockKeep: true, clockResume: false, beforeFinalize: ['(lambda nil (insert "x"))'] });
  assert.deepEqual(templates[1].afterFinalize, ['my-after']);
  assert.deepEqual(notes, ['Capture template "b": :refile-targets has no effect here.']);
  assert.deepEqual(captureTemplatesFromLisp(`(setq org-capture-templates '(("c" "C" entry (file "c.org") "* x" :time-prompt t)))`).notes, ['Capture template "c": :time-prompt has no effect without a file+olp+datetree target, as in Emacs.']);
});

test('a template written in a file the init loads is read, and one in the init itself wins over it', async () => {
  const files = { 'github:init.el': `(add-to-list 'org-capture-templates '("w" "From file" plain (file "a.org") "file"))\n(add-to-list 'org-capture-templates '("x" "Also from file" plain (file "a.org") "x"))` };
  const { text } = await expandLoads(`(load "github:init.el")\n(add-to-list 'org-capture-templates '("x" "In the init" plain (file "b.org") "init"))`, async (spec) => files[spec]);
  const { templates, notes } = captureTemplatesFromLisp(text);
  assert.deepEqual(notes, []);
  assert.deepEqual(templates.map((t) => [t.key, t.description]), [['x', 'In the init'], ['x', 'Also from file'], ['w', 'From file']]);
  assert.deepEqual(templates.filter((t) => t.key === 'x').map((t) => t.description), ['In the init', 'Also from file']);
});

test('file+olp+datetree and the older file+datetree and file+weektree read as a date tree target, :tree-type week or month choose the tree', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates '(("a" "A" entry (file+olp+datetree "j.org" "Journal" "Sub") "* %?" :tree-type week)
      ("b" "B" entry (file+datetree "j.org") "* %?") ("c" "C" item (file+weektree "j.org" "X") "x")
      ("d" "D" entry (file+olp+datetree "j.org") "* %?" :tree-type month) ("e" "E" entry (file+olp+datetree "j.org") "* %?" :tree-type (month day))))`);
  assert.deepEqual(templates.map((t) => [t.key, t.olp, t.datetree, t.treeType]), [['a', ['Journal', 'Sub'], true, 'week'], ['b', [], true, undefined], ['c', ['X'], true, 'week'], ['d', [], true, 'month'], ['e', [], true, undefined]]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /"e".*Org 9\.8/);
});
