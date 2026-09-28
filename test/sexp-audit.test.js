import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';
import { parseSexpr, evaluateSexpTimestamp, parseGeneralBodyLine } from '../src/sexp-eval.js';
import { unquoteDiaryFloatMonthList } from '../src/diary-sexp.js';

const TODAY = new Date(2026, 8, 28);
const on = (y, m, d) => new Date(y, m - 1, d);
/** Evaluates a sexp on one date; true / false / a string. */
const ev = (sexp, date) => evaluateSexpTimestamp(parseSexpr(sexp), { candidateDate: date, today: TODAY });
const matches = (sexp, date) => ev(sexp, date) !== false && ev(sexp, date) !== '';

/** Agenda titles a document produces on one day. */
function titlesOn(text, date) {
  const items = buildAgendaItems([{ documentId: 'a.org', doc: parseOrg(text) }], {
    today: TODAY,
    rangeStart: date,
    rangeEnd: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59),
  });
  return items.map((i) => i.title);
}

// ---- the anniversary start-year bug ------------------------------------------

test('an anniversary applies only to years AFTER the start year (the Emacs manual: "any year after 1948")', () => {
  const line = "* Birthdays\n%%(org-anniversary 1948 10 31) Arthur's %d%s birthday\n";
  assert.deepEqual(titlesOn(line, on(1940, 10, 31)), [], 'no "-8th birthday" before he was born');
  assert.deepEqual(titlesOn(line, on(1948, 10, 31)), [], 'no "0th birthday" in the year itself');
  assert.deepEqual(titlesOn(line, on(1949, 10, 31)), ["Arthur's 1st birthday"]);
  assert.deepEqual(titlesOn(line, on(1990, 10, 31)), ["Arthur's 42nd birthday"]);
});

test('the same rule holds inside a <%%(...)> timestamp', () => {
  assert.equal(matches('(org-anniversary 1948 10 31)', on(1940, 10, 31)), false);
  assert.equal(matches('(org-anniversary 1948 10 31)', on(1948, 10, 31)), false);
  assert.equal(matches('(org-anniversary 1948 10 31)', on(1949, 10, 31)), true);
});

test('a February 29 anniversary still lands on March 1 in a non-leap year, but only after its start year', () => {
  assert.equal(matches('(org-anniversary 2000 2 29)', on(2004, 2, 29)), true);
  assert.equal(matches('(org-anniversary 2000 2 29)', on(2001, 3, 1)), true);
  assert.equal(matches('(org-anniversary 2000 2 29)', on(2000, 2, 29)), false);
});

// ---- quoting, t, nil ----------------------------------------------------------

test("a quoted list is the list, as Emacs writes it (the manual's (diary-date '(10 11 12) 22 t), in org-date's ISO order)", () => {
  const sexp = "(org-date t '(10 11 12) 22)";
  for (const [m, d] of [[10, 22], [11, 22], [12, 22]]) assert.equal(matches(sexp, on(2026, m, d)), true, `${m}/${d}`);
  assert.equal(matches(sexp, on(2026, 9, 22)), false);
  assert.equal(matches(sexp, on(2026, 10, 23)), false);
});

test('an unquoted list keeps working, as it always did here', () => {
  assert.equal(matches('(org-date t (10 11 12) 22)', on(2027, 11, 22)), true);
});

test("diary-float takes a quoted month list too: the third Thursday of each quarter's first month", () => {
  const sexp = "(diary-float '(1 4 7 10) 4 3)";
  assert.equal(matches(sexp, on(2026, 1, 15)), true);
  assert.equal(matches(sexp, on(2026, 2, 19)), false, 'February is not in the list');
});

test('t is true and nil is false', () => {
  assert.equal(ev('(and t)', TODAY), true);
  assert.equal(ev('(or nil t)', TODAY), true);
  assert.equal(ev('(not nil)', TODAY), true);
  assert.equal(ev('(or nil nil)', TODAY), false);
});

// ---- and / or / not -----------------------------------------------------------

test('and: every argument must match; a string result survives; (and) is true', () => {
  assert.equal(ev('(and (org-date t 9 28) (org-date 2026 t t))', on(2026, 9, 28)), true);
  assert.equal(ev('(and (org-date t 9 28) (org-date 2027 t t))', on(2026, 9, 28)), false);
  assert.equal(ev('(and t (format "Rake leaves"))', TODAY), 'Rake leaves');
  assert.equal(ev('(and)', TODAY), true);
});

test('or: the first match wins, and its string survives; (or) is false', () => {
  assert.equal(ev('(or (org-date 2000 t t) (org-date 2026 t t))', TODAY), true);
  assert.equal(ev('(or nil (format "second"))', TODAY), 'second');
  assert.equal(ev('(or)', TODAY), false);
});

test('not: negates exactly one argument', () => {
  assert.equal(ev('(not (org-date 2026 t t))', TODAY), false);
  assert.equal(ev('(not (org-date 2000 t t))', TODAY), true);
  assert.equal(ev('(not)', TODAY), false);
  assert.equal(ev('(not t t)', TODAY), false);
});

test('an unknown function inside a combinator is simply no match, never a throw', () => {
  assert.equal(ev('(and (no-such-function 1 2) t)', TODAY), false);
  assert.equal(ev('(or (no-such-function 1 2))', TODAY), false);
});

// ---- blocks -------------------------------------------------------------------

test("org-block: the manual's own vacation (June 24 - July 10, 1990), inclusive at both ends", () => {
  const sexp = '(org-block 1990 6 24 1990 7 10)';
  assert.equal(matches(sexp, on(1990, 6, 24)), true);
  assert.equal(matches(sexp, on(1990, 7, 1)), true);
  assert.equal(matches(sexp, on(1990, 7, 10)), true);
  assert.equal(matches(sexp, on(1990, 6, 23)), false);
  assert.equal(matches(sexp, on(1990, 7, 11)), false);
  assert.equal(matches(sexp, on(1991, 7, 1)), false, 'a block is one range, not yearly');
});

test('a block can span the new year', () => {
  assert.equal(matches('(org-block 2025 12 20 2026 1 5)', on(2026, 1, 2)), true);
  assert.equal(matches('(org-block 2025 12 20 2026 1 5)', on(2026, 1, 6)), false);
});

test('a block with an impossible date matches nothing', () => {
  assert.equal(matches('(org-block 1990 2 30 1990 7 10)', on(1990, 7, 1)), false);
  assert.equal(matches('(org-block 1990 6)', on(1990, 7, 1)), false);
});

// ---- dates --------------------------------------------------------------------

test('org-date: each field an integer, a list of integers, or t', () => {
  assert.equal(matches('(org-date 2026 9 28)', on(2026, 9, 28)), true);
  assert.equal(matches('(org-date 2026 9 28)', on(2026, 9, 29)), false);
  assert.equal(matches('(org-date t 9 t)', on(2031, 9, 3)), true, 'any day of any September');
  assert.equal(matches('(org-date t 9 28)', on(2030, 9, 28)), true);
  assert.equal(matches('(org-date t 9 28)', on(2030, 9, 27)), false);
});

// ---- the standard American-order anniversary / cyclic --------------------------

test("org-cyclic: the manual's own '3 1 1990' every 50 days, from that date on", () => {
  const sexp = '(org-cyclic 50 1990 3 1)';
  assert.equal(matches(sexp, on(1990, 3, 1)), true);
  assert.equal(matches(sexp, on(1990, 4, 20)), true, '50 days after March 1');
  assert.equal(matches(sexp, on(1990, 4, 19)), false);
  assert.equal(matches(sexp, on(1990, 2, 1)), false, 'not before it starts');
});

// ---- org-class ----------------------------------------------------------------

test('org-class: a weekday between two dates (0 = Sunday)', () => {
  const monday = '(org-class 2026 9 1 2026 12 18 1)';
  assert.equal(matches(monday, on(2026, 9, 28)), true);
  assert.equal(matches(monday, on(2026, 9, 29)), false, 'a Tuesday');
  assert.equal(matches(monday, on(2026, 8, 31)), false, 'a Monday, but before the start');
  assert.equal(matches(monday, on(2026, 12, 21)), false, 'a Monday, but after the end');
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 0)', on(2026, 9, 27)), true, 'a Sunday');
});

test('org-class skips the ISO weeks it is told to', () => {
  const skipWeek40 = '(org-class 2026 9 1 2026 12 18 1 40)';
  assert.equal(matches(skipWeek40, on(2026, 9, 28)), false, '2026-09-28 is ISO week 40');
  assert.equal(matches(skipWeek40, on(2026, 10, 5)), true, 'week 41');
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 1 40 41)', on(2026, 10, 5)), false);
});

test('ISO week numbers are right across a year boundary', () => {
  // 2026-01-01 is a Thursday, so it is in week 1; 2025-12-29 (Monday) is too.
  assert.equal(matches('(org-class 2025 12 1 2026 2 1 1 1)', on(2025, 12, 29)), false, 'week 1 skipped');
  assert.equal(matches('(org-class 2025 12 1 2026 2 1 1 52)', on(2025, 12, 29)), true, 'week 52 skipped: this is week 1');
});

test('org-class asked to skip holidays matches NOTHING -- it cannot know them, and will not guess', () => {
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 1 holidays)', on(2026, 9, 28)), false);
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 1 "Labor Day")', on(2026, 9, 28)), false);
});

test('org-class with a bad day name or too few arguments matches nothing', () => {
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 7)', on(2026, 9, 28)), false);
  assert.equal(matches('(org-class 2026 9 1 2026 12 18)', on(2026, 9, 28)), false);
});

// ---- body lines ---------------------------------------------------------------

test('body lines: diary-float with a quoted month list', () => {
  assert.deepEqual(titlesOn("* B\n%%(diary-float '(1 4 7 10) 4 3) Quarterly review\n", on(2026, 1, 15)), ['Quarterly review']);
  assert.deepEqual(titlesOn("* B\n%%(diary-float '(1 4 7 10) 4 3) Quarterly review\n", on(2026, 2, 19)), []);
});

test('body lines: functions combined with and / or / not go through the general evaluator', () => {
  const doc = '* B\n%%(and (org-block 2026 9 1 2026 12 18) (org-class 2026 9 1 2026 12 18 1)) Seminar\n';
  assert.deepEqual(titlesOn(doc, on(2026, 9, 28)), ['Seminar']);
  assert.deepEqual(titlesOn(doc, on(2026, 9, 29)), []);
  assert.deepEqual(titlesOn(doc, on(2027, 1, 4)), [], 'a Monday after the block');
});

test('body lines: org-class and org-date on their own', () => {
  assert.deepEqual(titlesOn('* B\n%%(org-class 2026 9 1 2026 12 18 1) Class\n', on(2026, 10, 5)), ['Class']);
  assert.deepEqual(titlesOn("* B\n%%(org-date t '(10 11 12) 22) Rake leaves\n", on(2026, 11, 22)), ['Rake leaves']);
});

test('body lines: a string result replaces the text; no text falls back to the heading', () => {
  assert.deepEqual(titlesOn('* B\n%%(and t (format "From the sexp")) ignored\n', TODAY), ['From the sexp']);
  assert.deepEqual(titlesOn('* Heading title\n%%(org-date 2026 9 28)\n', TODAY), ['Heading title']);
});

test('body lines: a malformed line produces nothing and does not throw', () => {
  assert.deepEqual(titlesOn('* B\n%%(and (org-block 2026 9 1) Unfinished\n', TODAY), []);
});

// ---- the timestamp-form inconsistency ---------------------------------------------

test('<%%(org-block ...)> in a heading now matches (it silently never did, though the body-line form always worked)', () => {
  const doc = '* Term <%%(org-block 2026 9 1 2026 12 18)>\n';
  assert.deepEqual(titlesOn(doc, on(2026, 9, 28)), ['Term']);
  assert.deepEqual(titlesOn(doc, on(2026, 8, 31)), []);
});

// ---- helpers --------------------------------------------------------------------

test('unquoteDiaryFloatMonthList drops the quote on diary-float\'s month list and touches nothing else', () => {
  assert.equal(unquoteDiaryFloatMonthList("%%(diary-float '(1 4) 4 3) x"), '%%(diary-float (1 4) 4 3) x');
  assert.equal(unquoteDiaryFloatMonthList('%%(diary-float t 4 3) x'), '%%(diary-float t 4 3) x');
  assert.equal(unquoteDiaryFloatMonthList('%%(org-anniversary 1948 10 31) x'), '%%(org-anniversary 1948 10 31) x');
  assert.equal(unquoteDiaryFloatMonthList('plain text'), 'plain text');
});

test('parseGeneralBodyLine only claims the general functions, and finds the text after the closing paren', () => {
  assert.equal(parseGeneralBodyLine('%%(org-anniversary 1948 10 31) x'), null);
  assert.equal(parseGeneralBodyLine('%%(diary-float t 4 3) x'), null);
  assert.equal(parseGeneralBodyLine('not a sexp'), null);
  assert.equal(parseGeneralBodyLine('%%(and t (or nil t)) The text (with parens)').text, 'The text (with parens)');
  assert.equal(parseGeneralBodyLine('%%(and t "a ) in a string") after').text, 'after');
  assert.equal(parseGeneralBodyLine('%%(and t'), null);
});

test('ISO weeks run Monday to SUNDAY: a Sunday belongs to the week that began the Monday before', () => {
  // 2026-09-27 is a Sunday, the last day of ISO week 39 (Sep 21-27)
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 0 39)', on(2026, 9, 27)), false, 'skipping week 39 skips that Sunday');
  assert.equal(matches('(org-class 2026 9 1 2026 12 18 0 40)', on(2026, 9, 27)), true, 'skipping week 40 does not');
});

test('a block written with its dates reversed still works, in every form (as the body-line org-block always allowed)', () => {
  assert.equal(matches('(org-block 1990 7 10 1990 6 24)', on(1990, 7, 1)), true);
  assert.equal(matches('(org-block 1990 7 10 1990 6 24)', on(1990, 7, 11)), false);
  assert.deepEqual(titlesOn('* B\n%%(org-block 2026 6 5 2026 6 1) Beach\n', on(2026, 6, 3)), ['Beach']);
  assert.deepEqual(titlesOn('* Beach <%%(org-block 2026 6 5 2026 6 1)>\n', on(2026, 6, 3)), ['Beach']);
});

test("the README's own combined example: the first Monday of each month, but only within the block", () => {
  const sexp = '(and (org-block 2026 9 1 2026 12 18) (diary-float t 1 1))';
  assert.equal(matches(sexp, on(2026, 10, 5)), true, 'first Monday of October 2026');
  assert.equal(matches(sexp, on(2026, 10, 12)), false, 'a later Monday');
  assert.equal(matches(sexp, on(2027, 1, 4)), false, 'first Monday of January, but outside the block');
});

// ---- the diary-* twins are unsupported ON PURPOSE ---------------------------------
// diary-anniversary / diary-cyclic / diary-block / diary-date each have an org-*
// twin taking ISO (year month day) arguments. The diary-* ones read theirs in an
// order set by calendar-date-style, so the same line would mean different dates
// under different settings. These tests pin the decision: they match nothing, in
// either reading, and are not quietly translated.

test('diary-anniversary, diary-cyclic, diary-block and diary-date match nothing -- in any argument order', () => {
  const cases = [
    ['(diary-anniversary 10 31 1948)', on(1990, 10, 31)], // American reading
    ['(diary-anniversary 1948 10 31)', on(1990, 10, 31)], // ISO reading
    ['(diary-cyclic 50 3 1 1990)', on(1990, 3, 1)],
    ['(diary-cyclic 50 1990 3 1)', on(1990, 3, 1)],
    ['(diary-block 6 24 1990 7 10 1990)', on(1990, 7, 1)],
    ['(diary-block 1990 6 24 1990 7 10)', on(1990, 7, 1)],
    ['(diary-date 10 22 2026)', on(2026, 10, 22)],
    ['(diary-date 2026 10 22)', on(2026, 10, 22)],
  ];
  for (const [sexp, date] of cases) assert.equal(matches(sexp, date), false, sexp);
});

test('the org-* twins of those four still work', () => {
  assert.equal(matches('(org-anniversary 1948 10 31)', on(1990, 10, 31)), true);
  assert.equal(matches('(org-cyclic 50 1990 3 1)', on(1990, 4, 20)), true);
  assert.equal(matches('(org-block 1990 6 24 1990 7 10)', on(1990, 7, 1)), true);
  assert.equal(matches('(org-date 2026 10 22)', on(2026, 10, 22)), true);
});

test('as body lines the diary-* twins produce nothing, and are not rewritten into org-* ones', () => {
  assert.deepEqual(titlesOn("* B\n%%(diary-anniversary 10 31 1948) Arthur's %d%s birthday\n", on(1990, 10, 31)), []);
  assert.deepEqual(titlesOn('* B\n%%(diary-cyclic 50 3 1 1990) Renew\n', on(1990, 4, 20)), []);
  assert.deepEqual(titlesOn('* B\n%%(diary-block 6 24 1990 7 10 1990) Vacation\n', on(1990, 7, 1)), []);
  assert.deepEqual(titlesOn('* B\n%%(diary-date 10 22 2026) Rake\n', on(2026, 10, 22)), []);
  // ...while the org-* spelling of the same entry works, with its text and %d%s
  assert.deepEqual(titlesOn("* B\n%%(org-anniversary 1948 10 31) Arthur's %d%s birthday\n", on(1990, 10, 31)), ["Arthur's 42nd birthday"]);
});

test('diary-float has no org-* twin, so it stays -- including with the quoted month list Emacs writes', () => {
  assert.equal(matches("(diary-float '(1 4 7 10) 4 3)", on(2026, 1, 15)), true);
  assert.deepEqual(titlesOn("* B\n%%(diary-float '(1 4 7 10) 4 3) Quarterly\n", on(2026, 1, 15)), ['Quarterly']);
});
