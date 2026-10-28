import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';
import { parseSexpr, evaluateSexpDetailed, evaluateSexprValue } from '../src/sexp-eval.js';

const today = new Date(2026, 9, 14, 11, 0);
const ctx = (day = today, extra = {}) => ({ candidateDate: day, today, calendarLatitude: 40.7, calendarLongitude: -74, ...extra });
const run = (text, day) => evaluateSexpDetailed(parseSexpr(text), ctx(day));

test('a diary sexp can define variables and functions', () => {
  assert.equal(run('(progn (setq n 3) (defun twice (x) (* 2 x)) (twice n))').value, 6);
  assert.equal(run('(let ((m (nth 0 date))) (when (= m 10) "October"))').value, 'October');
  assert.equal(run('(let* ((d (calendar-extract-day date)) (f (lambda (k) (+ k d)))) (funcall f 1))', new Date(2026, 9, 5)).value, 6);
});

test('the diary functions work inside ordinary Lisp', () => {
  assert.equal(run('(mapcar (lambda (y) (calendar-leap-year-p y)) (list 2024 2025))').value.join(), 'true,false');
  assert.equal(run('(format "%s-%02d" (calendar-extract-year date) (calendar-extract-month date))').value, '2026-10');
});

test('a failing program says why, in the words Emacs uses', () => {
  assert.equal(run('(no-such-function 1)').error, 'Symbol’s function definition is void: no-such-function');
  assert.equal(run('(+ 1 "a")').error, 'Wrong type argument: number-or-marker-p, "a"');
  assert.equal(run('(car 5)').error, 'Wrong type argument: listp, 5');
  assert.equal(run('(error "Bad %s" "thing")').error, 'Bad thing');
  assert.equal(run('nothing-bound').error, 'Symbol’s value as variable is void: nothing-bound');
});

test('a runaway program stops with a message instead of hanging', () => {
  const started = Date.now();
  const loop = run('(while t (setq x 1))');
  assert.match(loop.error, /too many steps/);
  assert.equal(loop.kind, 'budget');
  const deep = run('(progn (defun f (n) (+ 1 (f n))) (f 1))');
  assert.match(deep.error, /Lisp nesting exceeds ‘max-lisp-eval-depth’/);
  assert.ok(Date.now() - started < 5000);
});

test('condition-case cannot swallow the step limit, but handles ordinary errors', () => {
  assert.equal(run('(condition-case e (car 1) (error (symbol-name (car e))))').value, 'wrong-type-argument');
  assert.match(run('(condition-case nil (while t nil) (error "caught"))').error, /too many steps/);
});

test('a program that fails shows its error once in the agenda', () => {
  const doc = parseOrg('* Broken <%%(no-such-function)>\n');
  const items = buildAgendaItems([{ documentId: 'a.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 9, 1),
    rangeEnd: new Date(2026, 9, 31),
    today,
  });
  const errors = items.filter((i) => i.error);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].title, 'Broken: Symbol’s function definition is void: no-such-function');
});

test('a body line that fails shows its error', () => {
  const doc = parseOrg('* Heading\n%%(and (car 5) t) Lunch\n');
  const items = buildAgendaItems([{ documentId: 'a.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 9, 14),
    rangeEnd: new Date(2026, 9, 15),
    today,
  });
  const errors = items.filter((i) => i.error);
  assert.equal(errors.length, 1);
  assert.match(errors[0].title, /Wrong type argument: listp, 5/);
});

test('values come back as plain values', () => {
  assert.equal(evaluateSexprValue(parseSexpr('(list 1 2.5 "x")'), ctx()).join(), '1,2.5,x');
});

test('functions and variables from the Lisp init are there for diary entries, and go when the init changes', async () => {
  const { setHolidayConfig } = await import('../src/holidays.js');
  try {
    setHolidayConfig('(setq my-offset 5)\n(defun my-plus (x) (+ x my-offset))');
    assert.equal(run('(my-plus 1)').value, 6);
    assert.equal(run('(progn (defun my-twice (x) (my-plus (* 2 x))) (my-twice 3))').value, 11);
    setHolidayConfig('(defun my-plus (x) (+ x 100))');
    assert.equal(run('(my-plus 1)').value, 101);
    assert.match(run('my-offset').error, /void/);
    setHolidayConfig('');
    assert.match(run('(my-plus 1)').error, /function definition is void: my-plus/);
  } finally {
    setHolidayConfig('');
  }
});
