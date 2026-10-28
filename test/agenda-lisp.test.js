import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { PrefixFormError, agendaLisp, evalPrefixForm, runFunctionCommand } from '../src/agenda-lisp.js';
import { sortAgendaItems } from '../src/agenda-sort.js';
import { formatAgendaPrefix } from '../src/agenda-prefix.js';
import { parseCustomCommands, withCustomCommand } from '../src/agenda-commands.js';

const doc = parseOrg('* TODO [#C] Apple :a:\n:PROPERTIES:\n:WEIGHT: 3\n:END:\n* TODO Cherry\n:PROPERTIES:\n:WEIGHT: 1\n:END:\n* TODO [#A] Banana\n:PROPERTIES:\n:WEIGHT: 2\n:END:\n');
const docs = [{ documentId: 'd', doc }];
const items = doc.children.map((h) => ({ documentId: 'd', heading: h, title: h.title, todo: h.todo, priority: h.priority || null, tags: h.tags || [], category: 'Cat', kind: 'todo', date: new Date(2026, 0, 1) }));
const titles = (sorted) => sorted.map((i) => i.title);

test('user-defined-up and -down use org-agenda-cmp-user-defined on two agenda lines', () => {
  const lisp = agendaLisp({ 'org-agenda-cmp-user-defined': "(lambda (a b) (cond ((string-match-p \"Cherry\" a) -1) ((string-match-p \"Cherry\" b) 1)))" }, docs);
  assert.deepEqual(titles(sortAgendaItems(items, ['user-defined-up'], { lisp })), ['Cherry', 'Apple', 'Banana']);
  assert.deepEqual(titles(sortAgendaItems(items, ['user-defined-down'], { lisp })), ['Apple', 'Banana', 'Cherry']);
  assert.deepEqual(titles(sortAgendaItems(items, ['user-defined-up'], {})), ['Apple', 'Cherry', 'Banana']);
});

test('a comparator that gives anything but -1, 1 or nil has no opinion, and a failing one too', () => {
  for (const f of ['(lambda (a b) 5)', '(lambda (a b) (error "x"))', 'no-such-function']) {
    const lisp = agendaLisp({ 'org-agenda-cmp-user-defined': f }, docs);
    assert.deepEqual(titles(sortAgendaItems(items, ['user-defined-up'], { lisp })), ['Apple', 'Cherry', 'Banana'], f);
  }
});

test('org-priority-get-priority-function gives the priority number, called with the headline', () => {
  const lisp = agendaLisp({ 'org-priority-get-priority-function': "(lambda (s) (string-to-number (org-entry-get nil \"WEIGHT\")))" }, docs);
  // priority-down sorts the higher number first
  assert.deepEqual(titles(sortAgendaItems(items, ['priority-down'], { lisp })), ['Apple', 'Banana', 'Cherry']);
  const seen = agendaLisp({ 'org-priority-get-priority-function': "(lambda (s) (if (string-match-p \"^TODO \\\\[#A\\\\] Banana$\" s) 100 0))" }, docs);
  assert.deepEqual(titles(sortAgendaItems(items, ['priority-down'], { lisp: seen })), ['Banana', 'Apple', 'Cherry']);
});

test('%(form) in the prefix format is evaluated, with the row\'s variables', () => {
  const ev = (form) => evalPrefixForm(form, { category: 'Home', level: '  ' }, null);
  assert.equal(ev('(concat "<" category ">")'), '<Home>');
  assert.equal(ev('(length level)'), '2');
  // Emacs 29.3 stops the Agenda with the error (error-message-string), tools/gen-agenda-settings-example.mjs
  const fails = (form) => { try { ev(form); } catch (e) { assert.ok(e instanceof PrefixFormError); return e.message; } return null; };
  assert.equal(fails('(error "boom %d" 3)'), 'boom 3');
  assert.equal(fails('(car 5)'), 'Wrong type argument: listp, 5');
  assert.equal(fails('(foo)'), 'Symbol’s function definition is void: foo');
  assert.equal(formatAgendaPrefix('x%-8(upcase category)|%?(identity "")|', {}, (f) => ev(f.replace('category', '"ab"'))), 'xAB      ||');
  assert.equal(formatAgendaPrefix('%(foo (bar "(")) %c', { category: 'c' }, (f) => `[${f}]`), '[(foo (bar "("))] c');
  assert.equal(formatAgendaPrefix('%(x) %c', { category: 'c' }), ' c');
});

test('a Lisp function as a custom command is read, kept, and run with the match', () => {
  const text = `'(("x" "Mine" my-fn "work") ("y" "Lam" (lambda (m) (princ m)) "w" ((org-agenda-sorting-strategy '(alpha-up)))) ("z" "Stuck" stuck) ("t" "Tags" tags "a"))`;
  const cmds = parseCustomCommands(text);
  assert.deepEqual(cmds.map((c) => [c.key, c.type, c.query]), [['x', 'function', 'work'], ['y', 'function', 'w'], ['t', 'tags', 'a']]);
  assert.equal(cmds[0].fn, 'my-fn');
  assert.match(withCustomCommand(text, { key: 'q', description: 'd', type: 'tags', query: 'b', sortingStrategy: null }), /\("x" "Mine" my-fn "work"\)/);
  assert.deepEqual(runFunctionCommand('(lambda (m) (princ (concat "got " m)) (insert "!"))', 'work'), { ok: true, text: 'got work!' });
  assert.deepEqual(runFunctionCommand("(lambda (m) (list \"a\" \"b\"))", ''), { ok: true, text: '' }); // what the function returns is not shown, as in Emacs
  assert.equal(runFunctionCommand('(lambda (m) (error "no"))', '').ok, false);
});
