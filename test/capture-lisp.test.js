import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTemplatesFromLisp, mergeCaptureTemplates } from '../src/capture-lisp.js';
import { insertCapture, resolveOlpTarget } from '../src/capture-template.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const INIT = `
(setq org-capture-templates
  '(("a" "Appointment" entry (file+olp "github:calendar.org" "%<%Y>") "* %^{Description} %^T\\n%?"
     :prepend t :omit-empty-entries t)
    ("j" "Journal" item
     (file+olp "github:home.org" "Journal" "%<%Y-%m %b>" "%<%Y-%m-%d>") "%<%H:%M> - %?" :prepend t)
    ("t" "Tracking" table-line (file+olp "home.org" "Tracking" "%<%Y-%m>")
     "| @# | %<%Y-%m-%d> | %<%H%M> ||" :prepend-heading t
     :pre-text "#+PLOT: title:\\"T\\"" :post-text "#+TBLFM: $4=1")))
`;

test('templates written in Lisp become the template objects the JSON form uses', () => {
  const { templates, notes } = captureTemplatesFromLisp(INIT);
  assert.deepEqual(notes, []);
  assert.deepEqual(templates[0], { key: 'a', description: 'Appointment', type: 'entry', olp: ['%<%Y>'], template: '* %^{Description} %^T\n%?', file: 'github:calendar.org', prepend: true, omitEmptyEntries: true });
  assert.deepEqual(templates[1], { key: 'j', description: 'Journal', type: 'item', olp: ['Journal', '%<%Y-%m %b>', '%<%Y-%m-%d>'], template: '%<%H:%M> - %?', file: 'github:home.org', prepend: true });
  assert.deepEqual(templates[2], { key: 't', description: 'Tracking', type: 'table-line', olp: ['Tracking', '%<%Y-%m>'], template: '| @# | %<%Y-%m-%d> | %<%H%M> ||', file: 'home.org', prependHeading: true, preText: '#+PLOT: title:"T"', postText: '#+TBLFM: $4=1' });
});

test('add-to-list puts a template first, and a group heading or a template that cannot be read is reported or skipped', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates '(("w" "Work") ("wt" "Task" entry (file+headline "w.org" "Tasks") "* TODO %?" :empty-lines 1)
                                  ("d" "Dated" entry (file+datetree "d.org") "* %?")
                                  ("f" "Fn" entry (function my-fn) "* %?")))
    (add-to-list 'org-capture-templates '("n" "Note" plain (file "inbox.org") "* %?"))`);
  assert.deepEqual(templates.map((t) => t.key), ['n', 'wt']);
  assert.deepEqual(templates[0].olp, []);
  assert.deepEqual(templates[1].olp, ['Tasks']);
  assert.equal(notes.length, 2);
  assert.equal(templates[1].emptyLines, 1);
  assert.match(notes.join(' '), /"d" is left out.*file\+datetree/);
  assert.match(notes.join(' '), /"f" is left out/);
});

test('a Lisp template replaces a JSON template with the same key', () => {
  const merged = mergeCaptureTemplates([{ key: 'a', type: 'item', template: 'old' }, { key: 'b', type: 'item', template: 'b' }], [{ key: 'a', type: 'entry', template: 'new' }]);
  assert.deepEqual(merged.map((t) => [t.key, t.template]), [['b', 'b'], ['a', 'new']]);
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

test('blank lines, the table row and the header are read from their keywords', () => {
  const { templates, notes } = captureTemplatesFromLisp(`
    (setq org-capture-templates
      '(("t" "Row" table-line (file+headline "t.org" "Log") "| @# | %U |"
         :empty-lines 1 :empty-lines-before 2 :empty-lines-after 0 :table-line-pos "I+1" :table-header nil :immediate-finish t)
        ("b" "Bad" entry (file "b.org") "* %?" :empty-lines "x" :table-line-pos 3)))`);
  assert.deepEqual(templates[0], { key: 't', description: 'Row', type: 'table-line', olp: ['Log'], template: '| @# | %U |', file: 't.org', emptyLines: 1, emptyLinesBefore: 2, emptyLinesAfter: 0, tableLinePos: 'I+1', tableHeader: false });
  assert.deepEqual(notes, ['Capture template "b": :empty-lines needs a whole number and is ignored.', 'Capture template "b": :table-line-pos needs a string and is ignored.']);
});
