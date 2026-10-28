import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { print, list, intern, NIL } from '../src/elisp-data.js';
import { Reader } from '../src/elisp-read.js';
import { evalForm, resetRun, withDynamic } from '../src/elisp-core.js';
import { describeFailure } from '../src/elisp.js';
import '../src/diary-lisp.js';
import { evalHolidayList } from '../src/calendar-lisp.js';
import { holidaysOn, setHolidayConfig, setHolidayZone } from '../src/holidays.js';

// Emacs 29.3 (tools/gen-calendar-oracle.mjs): the calendar and holiday built-ins, and lists evaluated by `calendar-holiday-list`.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/calendar-lisp.json', import.meta.url), 'utf8'));

/** The answer the interpreter gives to one oracle case, in the shape the oracle records. */
function answer(c) {
  resetRun({ budget: 1_000_000 });
  try {
    const form = new Reader(c.src).read();
    if (!c.list) {
      const value = withDynamic([[intern('displayed-month'), c.month], [intern('displayed-year'), c.year]], () => evalForm(form, null));
      return { status: 'ok', value: print(value) };
    }
    const entries = [];
    const value = evalForm(form, null);
    for (let p = value; p !== NIL && p.car !== undefined; p = p.cdr) entries.push(p.car);
    const { holidays: found } = evalHolidayList(entries, [], c.month, c.year, {});
    return { status: 'ok', value: print(list(found.map((h) => list([list([...h.date]), h.name])))) };
  } catch (e) {
    return { status: 'error', value: describeFailure(e).message };
  }
}

test('the calendar and holiday functions give Emacs\'s answer', () => {
  const bad = [];
  for (const c of oracle) {
    const got = answer(c);
    if (got.status !== c.status || got.value !== c.value) bad.push({ month: c.month, year: c.year, src: c.src, got, want: { status: c.status, value: c.value } });
  }
  assert.deepEqual(bad.slice(0, 8), []);
});

const names = (year, month, day) => holidaysOn(new Date(year, month - 1, day));

test('a holiday list is Lisp: let, mapcar, if and the init\'s own functions all work', () => {
  setHolidayConfig(`
(defun my-day (m d name) (holiday-fixed m d name))
(setq my-flag t)
(setq calendar-holidays
  (list '(my-day 2 3 "Defun Day")
        '(if my-flag (holiday-fixed 2 4 "Flag Day"))
        '(let ((n 5)) (holiday-fixed 2 n "Let Day"))
        '(apply #'append (mapcar (lambda (d) (holiday-fixed 2 d "Mapped")) '(6 7)))))`);
  try {
    assert.deepEqual(names(2026, 2, 3), ['Defun Day']);
    assert.deepEqual(names(2026, 2, 4), ['Flag Day']);
    assert.deepEqual(names(2026, 2, 5), ['Let Day']);
    assert.deepEqual(names(2026, 2, 6), ['Mapped']);
    assert.deepEqual(names(2026, 2, 7), ['Mapped']);
    assert.deepEqual(names(2026, 12, 25), []);
  } finally {
    setHolidayConfig('');
  }
});

test('an entry that fails is reported on the first of the month and the others still count', () => {
  setHolidayConfig(`(setq calendar-holidays '((holiday-fixed 3 3 "Fine") (no-such-function 1) (holiday-fixed 3 4 "Also fine")))`);
  try {
    assert.deepEqual(names(2026, 3, 3), ['Fine']);
    assert.deepEqual(names(2026, 3, 4), ['Also fine']);
    assert.match(names(2026, 3, 1)[0], /^Holiday list error: .*no-such-function/);
  } finally {
    setHolidayConfig('');
  }
});

test('the default lists still give Daylight Saving Time as holiday-sexp does', () => {
  setHolidayZone('America/New_York');
  try {
    assert.deepEqual(names(2026, 3, 8), ['Daylight Saving Time Begins 2:00am (EST)']);
    assert.deepEqual(names(2026, 11, 1), ['Daylight Saving Time Ends 2:00am (EDT)']);
  } finally {
    setHolidayZone(null);
  }
});
