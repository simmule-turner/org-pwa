import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSexpr, evaluateSexpr, findSexpTimestamps, evaluateSexpTimestamp, isTruthy, documentUsesOrgWeather } from '../src/sexp-eval.js';
import { parseOrg } from '../src/org-parser.js';

// ---- parseSexpr (the raw parser) --------------------------------------------

test('parses a simple function call with numeric arguments', () => {
  assert.deepEqual(parseSexpr('(org-cyclic 3 2026 1 1)'), [
    { type: 'symbol', value: 'org-cyclic' },
    { type: 'number', value: 3 },
    { type: 'number', value: 2026 },
    { type: 'number', value: 1 },
    { type: 'number', value: 1 },
  ]);
});

test('parses a nested expression (when wrapping two more calls)', () => {
  const result = parseSexpr('(when (today-p) (solar-time-string 6.5))');
  assert.equal(result[0].value, 'when');
  assert.deepEqual(result[1], [{ type: 'symbol', value: 'today-p' }]);
  assert.deepEqual(result[2], [{ type: 'symbol', value: 'solar-time-string' }, { type: 'number', value: 6.5 }]);
});

test('parses a symbol argument (the literal "t" for diary-float\u2019s own "every month")', () => {
  const result = parseSexpr('(diary-float t 6 1)');
  assert.deepEqual(result[1], { type: 'symbol', value: 't' });
});

test('parses a nested list argument (diary-float\u2019s own quarterly month list)', () => {
  const result = parseSexpr('(diary-float (1 4 7 10) 5 1)');
  assert.deepEqual(result[1], [
    { type: 'number', value: 1 },
    { type: 'number', value: 4 },
    { type: 'number', value: 7 },
    { type: 'number', value: 10 },
  ]);
});

test('parses a string literal argument', () => {
  assert.deepEqual(parseSexpr('("hello world")'), [{ type: 'string', value: 'hello world' }]);
});

test('throws on an unmatched opening paren', () => {
  assert.throws(() => parseSexpr('(when (today-p)'));
});

test('throws on trailing tokens after a complete expression', () => {
  assert.throws(() => parseSexpr('(today-p) extra'));
});

// ---- evaluateSexpr -- THE EXACT WORKED EXAMPLES FROM THE REQUEST -----------

const TODAY = new Date(2026, 7, 12);
function ctx(candidateDate) {
  return { candidateDate, today: TODAY, calendarLatitude: 35.994, calendarLongitude: -78.8986 };
}

test('(when (today-p) (solar-time-string 6.5)) shows sunrise ONLY on today', () => {
  const expr = parseSexpr('(when (today-p) (solar-time-string 6.5))');
  const todayResult = evaluateSexpr(expr, ctx(TODAY));
  assert.equal(typeof todayResult, 'string');
  assert.match(todayResult, /^6:30am$/);

  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 11))), false); // yesterday
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 13))), false); // tomorrow
});

test('(when (org-cyclic 7 2026 8 9) (solar-time-string 6.5)) -- weekly sunrise combining when + org-cyclic', () => {
  const expr = parseSexpr('(when (org-cyclic 7 2026 8 9) (solar-time-string 6.5))');
  assert.equal(typeof evaluateSexpr(expr, ctx(new Date(2026, 7, 9))), 'string'); // baseline day
  assert.equal(typeof evaluateSexpr(expr, ctx(new Date(2026, 7, 16))), 'string'); // baseline + 7
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 12))), false); // not a multiple of 7 from baseline
});

test('THE EXACT EXAMPLE: (diary-float t 6 1) -- first Saturday of every month', () => {
  const expr = parseSexpr('(diary-float t 6 1)');
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 1))), true); // Aug 1, 2026 is the first Saturday
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 8))), false); // the second Saturday
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 8, 5))), true); // first Saturday of September too
});

test('THE EXACT EXAMPLE: (org-cyclic 3 2026 1 1) -- every 3 days starting from the baseline', () => {
  const expr = parseSexpr('(org-cyclic 3 2026 1 1)');
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 0, 1))), true);
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 0, 4))), true);
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 0, 3))), false);
});

test('THE EXACT EXAMPLE: (org-anniversary 2018 5 14) -- yearly anniversary matches month/day regardless of year', () => {
  const expr = parseSexpr('(org-anniversary 2018 5 14)');
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 4, 14))), true);
  assert.equal(evaluateSexpr(expr, ctx(new Date(2030, 4, 14))), true);
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 4, 15))), false);
});

// ---- evaluateSexpr -- individual function behaviors ------------------------

test('today-p is true only when the candidate date exactly matches today, ignoring time-of-day', () => {
  const expr = parseSexpr('(today-p)');
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 12, 23, 59))), true); // same day, different time
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 7, 13, 0, 1))), false); // next day
});

test('when with a falsy condition returns false without evaluating the "then" branch', () => {
  const expr = parseSexpr('(when (org-cyclic 3 2026 1 1) (solar-time-string 6.5))');
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 0, 2))), false); // doesn't match the cyclic pattern
});

test('diary-float supports the quarterly month-list form within a sexp timestamp', () => {
  const expr = parseSexpr('(diary-float (1 4 7 10) 5 1)'); // first Friday of Jan/Apr/Jul/Oct
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 0, 2))), true); // Jan 2, 2026 is a Friday, the first one
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 1, 6))), false); // February isn't in the list
});

test('diary-float negative N (last occurrence) works within a sexp timestamp', () => {
  const expr = parseSexpr('(diary-float 3 5 -1)'); // last Friday of March
  assert.equal(evaluateSexpr(expr, ctx(new Date(2026, 2, 27))), true);
});

test('an unrecognized function name evaluates to false rather than throwing', () => {
  const expr = parseSexpr('(some-unknown-function 1 2 3)');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), false);
});

test('a bare leaf node (not wrapped in a function call) evaluates sensibly rather than crashing', () => {
  assert.equal(evaluateSexpr({ type: 'number', value: 0 }, ctx(TODAY)), false); // 0 is falsy here
  assert.equal(evaluateSexpr({ type: 'number', value: 42 }, ctx(TODAY)), true);
  assert.equal(evaluateSexpr({ type: 'string', value: 'hello' }, ctx(TODAY)), 'hello');
  assert.equal(evaluateSexpr({ type: 'symbol', value: 'nonsense' }, ctx(TODAY)), false);
});

// ---- isTruthy ---------------------------------------------------------------

test('isTruthy: false and the empty string are falsy; everything else (including a non-empty string) is truthy', () => {
  assert.equal(isTruthy(false), false);
  assert.equal(isTruthy(''), false);
  assert.equal(isTruthy(true), true);
  assert.equal(isTruthy('Sunrise 6:30am'), true);
  assert.equal(isTruthy(0), true); // deliberately NOT falsy here -- only false/'' are, matching elisp's own nil-is-the-only-real-falsy-value convention more closely than JS's own broader falsiness
});

// ---- findSexpTimestamps -----------------------------------------------------

test('finds a <%%(...)> timestamp embedded in a heading title, alongside ordinary text', () => {
  const found = findSexpTimestamps('Weekly Sunrise <%%(when (org-cyclic 7 2026 8 9) (solar-time-string 6.5))>');
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, '<%%(when (org-cyclic 7 2026 8 9) (solar-time-string 6.5))>');
  assert.notEqual(found[0].expr, null);
});

test('finds multiple <%%(...)> timestamps in the same text', () => {
  const found = findSexpTimestamps('<%%(today-p)> and also <%%(org-cyclic 3 2026 1 1)>');
  assert.equal(found.length, 2);
});

test('returns an empty array for text with no sexp timestamp at all', () => {
  assert.deepEqual(findSexpTimestamps('Just an ordinary heading title'), []);
  assert.deepEqual(findSexpTimestamps(''), []);
  assert.deepEqual(findSexpTimestamps(null), []);
});

test('does not confuse a plain <2026-01-01> timestamp for a sexp one', () => {
  assert.deepEqual(findSexpTimestamps('Meeting <2026-01-01 Thu>'), []);
});

test('a malformed sexp (unmatched paren) is skipped -- expr is null, not a thrown error', () => {
  findSexpTimestamps('<%%(when (today-p)>'); // missing the final closing paren for the outer expr
  // Either no match at all (since the outer paren never actually balances to 0 before hitting '>'),
  // or a match with expr === null -- either way, this must not throw.
  assert.doesNotThrow(() => findSexpTimestamps('<%%(when (today-p)>'));
});

test('correctly handles a double-quoted string containing a literal ")" without miscounting paren depth', () => {
  const found = findSexpTimestamps('<%%(when (today-p) ("text with a ) inside"))>');
  assert.equal(found.length, 1);
});

// ---- evaluateSexpTimestamp (the null-tolerant wrapper) ---------------------

test('evaluateSexpTimestamp returns false for a null expr (a sexp that failed to parse) rather than throwing', () => {
  assert.equal(evaluateSexpTimestamp(null, ctx(TODAY)), false);
});

test('evaluateSexpTimestamp delegates to evaluateSexpr for a valid expr', () => {
  const expr = parseSexpr('(today-p)');
  assert.equal(evaluateSexpTimestamp(expr, ctx(TODAY)), true);
});

// ---- format -------------------------------------------------------------

test('THE FIX: THE EXACT REQUEST -- (format "Rise %s (%s)" (solar-time-string 6.5) (solar-time-string 6)) combines two functions into one string, with only the bare times', () => {
  const expr = parseSexpr('(format "Rise %s (%s)" (solar-time-string 6.5) (solar-time-string 6))');
  const result = evaluateSexpr(expr, { ...ctx(TODAY) });
  assert.match(result, /^Rise 6:30am \(6:00am\)$/);
});

test('THE FIX: THE EXACT REQUEST, wrapped in <%%(when (today-p) ...)> exactly as originally written, via findSexpTimestamps + evaluateSexpTimestamp end to end', () => {
  const title = 'Sun Report <%%(when (today-p) (format "Rise %s (%s)" (solar-time-string 6.5) (solar-time-string 6)) )>';
  const found = findSexpTimestamps(title);
  assert.equal(found.length, 1, 'the parens embedded inside the "Rise %s (%s)" string literal must not be mistaken for sexp structure');
  const result = evaluateSexpTimestamp(found[0].expr, { ...ctx(TODAY) });
  assert.match(result, /^Rise 6:30am \(6:00am\)$/);
  const notToday = evaluateSexpTimestamp(found[0].expr, { ...ctx(new Date(2026, 7, 13)) });
  assert.equal(notToday, false, 'still only matches on today, same as every other (when (today-p) ...) example');
});

test('THE FIX: too few sub-expressions to fill every %s evaluates to false (no match) rather than throwing or silently leaving a placeholder', () => {
  const expr = parseSexpr('(format "%s %s" (solar-time-string 6.5))');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), false);
});

test('THE FIX: extra, unused sub-expressions are simply ignored, matching real elisp\u2019s own tolerant behavior for format', () => {
  const expr = parseSexpr('(format "%s" (solar-time-string 6.5) (solar-time-string 19.25))');
  const result = evaluateSexpr(expr, ctx(TODAY));
  assert.match(result, /^6:30am$/, 'only the first sub-expression is used; the second is never evaluated or included');
});

test('THE FIX: %% is a literal percent sign', () => {
  const expr = parseSexpr('(format "100%% done: %s" (solar-time-string 6.5))');
  const result = evaluateSexpr(expr, ctx(TODAY));
  assert.match(result, /^100% done: /);
});

test('a format string with zero %s placeholders is just the literal string, unchanged', () => {
  const expr = parseSexpr('(format "just a literal string")');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), 'just a literal string');
});

test('THE FIX: format nests inside itself correctly -- each %s recursively evaluates its own sub-expression via the same evaluator, so nested format needs no special-casing at all', () => {
  const expr = parseSexpr('(format "outer: %s" (format "inner: %s" (solar-time-string 6.5)))');
  const result = evaluateSexpr(expr, ctx(TODAY));
  assert.match(result, /^outer: inner: 6:30am$/);
});

test('a boolean sub-expression (today-p) in a %s slot prints as real elisp\u2019s own "t"/"nil"', () => {
  const trueExpr = parseSexpr('(format "today? %s" (today-p))');
  assert.equal(evaluateSexpr(trueExpr, ctx(TODAY)), 'today? t');
  const falseExpr = parseSexpr('(format "today? %s" (today-p))');
  assert.equal(evaluateSexpr(falseExpr, ctx(new Date(2026, 7, 13))), 'today? nil');
});

test('format takes any string-valued first argument, and ignores arguments its string does not use, as in Emacs', () => {
  const expr = parseSexpr('(format (solar-time-string 6.5) "x")');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), '6:30am');
});

test('format combines three functions at once, from solar-time-string', () => {
  const expr = parseSexpr('(format "%s | %s | %s" (solar-time-string 6.5) (solar-time-string 6) (solar-time-string 13))');
  const result = evaluateSexpr(expr, { ...ctx(TODAY) });
  assert.match(result, /^6:30am \| 6:00am \| 1:00pm$/);
});

test('format with no sub-expressions at all (missing entirely, not just fewer than %s needs) evaluates to false when %s is present, since args.length < 1 only covers the missing-format-string case -- here args.length is 1 (just the string), so placeholderCount (1) > substitutionArgs.length (0)', () => {
  const expr = parseSexpr('(format "%s")');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), false);
});

test('format with truly zero arguments at all is malformed and evaluates to false', () => {
  const expr = parseSexpr('(format)');
  assert.equal(evaluateSexpr(expr, ctx(TODAY)), false);
});

// ---- documentUsesOrgWeather ---------------------------------------------------

test('documentUsesOrgWeather is false for a document with no org-weather usage at all', () => {
  const doc = parseOrg('* Just a heading\nSome text.\n');
  assert.equal(documentUsesOrgWeather(doc), false);
});

test('THE FIX: documentUsesOrgWeather is true for a standalone "%%(org-weather)" body line', () => {
  const doc = parseOrg('* Weather\n%%(org-weather)\n');
  assert.equal(documentUsesOrgWeather(doc), true);
});

test('THE FIX: documentUsesOrgWeather is true for org-weather used within a <%%(...)> timestamp', () => {
  const doc = parseOrg('* Conditions <%%(when (today-p) (org-weather))>\n');
  assert.equal(documentUsesOrgWeather(doc), true);
});

test('documentUsesOrgWeather finds a usage on a deeply nested sub-heading, not just top-level ones', () => {
  const doc = parseOrg('* A\n** B\n*** C\n%%(org-weather)\n');
  assert.equal(documentUsesOrgWeather(doc), true);
});

test('documentUsesOrgWeather handles a null/missing document gracefully', () => {
  assert.equal(documentUsesOrgWeather(null), false);
  assert.equal(documentUsesOrgWeather(undefined), false);
});

test('THE FIX: similar-looking but unrelated text does not false-positive -- only a genuine trigger counts', () => {
  const doc = parseOrg('* Heading\nI mention org-weather here but there\u2019s no actual %%(...) trigger.\n');
  assert.equal(documentUsesOrgWeather(doc), false);
});

// ---- solar-sunrise-sunset, solar-time-string, apply ---------------------------

test('solar-time-string: Emacs\u2019s default calendar-time-display-form, with and without a time zone', () => {
  const run = (/** @type {string} */ text) => evaluateSexpr(parseSexpr(text), ctx(TODAY));
  assert.equal(run('(solar-time-string 6.5)'), '6:30am');
  assert.equal(run('(solar-time-string 6.5 "EDT")'), '6:30am (EDT)');
  assert.equal(run('(solar-time-string 18.75)'), '6:45pm');
  assert.equal(run('(solar-time-string 0)'), '12:00am');
  assert.equal(run('(solar-time-string 12)'), '12:00pm');
  assert.equal(run('(solar-time-string 6.999)'), '7:00am', 'rounded to the minute');
  assert.equal(run('(solar-time-string nil)'), false);
});

test('solar-time-string follows calendar-time-display-form, a malformed one falling back to the default', () => {
  const run = (/** @type {string} */ form) => evaluateSexpr(parseSexpr('(solar-time-string 6.5 "EDT")'), { ...ctx(TODAY), calendarTimeDisplayForm: form });
  assert.equal(run('(24-hours ":" minutes)'), '06:30');
  assert.equal(run('(12-hours ":" minutes am-pm)'), '6:30am');
  assert.equal(run('(24-hours "h" minutes " " time-zone)'), '06h30 EDT');
  assert.equal(run('(24-hours'), '6:30am (EDT)');
});

test('solar-sunrise-sunset returns ((rise zone) (set zone) "H:MM") and takes a height for the twilights', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York'; // sun times are in the device zone
  try {
    const show = (/** @type {string} */ text, context = ctx(TODAY)) => evaluateSexpr(parseSexpr(`(format "%s" ${text})`), context);
    const hours = (/** @type {string} */ text) => Number(show(text));
    const rise = hours('(car (car (solar-sunrise-sunset date)))');
    const set = hours('(car (cadr (solar-sunrise-sunset date)))');
    const apart = (/** @type {number} */ from, /** @type {number} */ to) => (((to - from) % 24) + 24) % 24; // hours from one clock time to the next, in any zone
    assert.ok(Math.abs(apart(rise, set) - 13.6) < 0.3, `${rise} ${set}`);
    assert.equal(show('(cadr (car (solar-sunrise-sunset date)))'), show('(cadr (cadr (solar-sunrise-sunset date)))'));
    assert.match(show('(nth 2 (solar-sunrise-sunset date))'), /^1[2-4]:\d\d$/);
    assert.match(show('(length (solar-sunrise-sunset date))'), /^3$/);
    const civil = hours('(car (car (solar-sunrise-sunset date -6)))');
    const nautical = hours('(car (car (solar-sunrise-sunset date -12)))');
    const astronomical = hours('(car (car (solar-sunrise-sunset date -18)))');
    assert.ok(apart(civil, rise) > 0 && apart(civil, rise) < 1);
    assert.ok(apart(astronomical, nautical) > 0 && apart(nautical, civil) > 0 && apart(astronomical, civil) < 3);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('solar-sunrise-sunset gives nil for an event the day lacks (the polar night)', () => {
  const polar = { ...ctx(new Date(2026, 11, 21)), calendarLatitude: 80, calendarLongitude: 0 };
  const show = (/** @type {string} */ text) => evaluateSexpr(parseSexpr(`(format "%s" ${text})`), polar);
  assert.equal(show('(car (solar-sunrise-sunset date))'), 'nil');
  assert.equal(show('(cadr (solar-sunrise-sunset date))'), 'nil');
  assert.equal(show('(nth 2 (solar-sunrise-sunset date))'), '0:00');
});

test('apply spreads the last argument: the user\u2019s sun-times entry', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York'; // sun times are in the device zone
  try {
    const text = '(when (today-p) (let ((l (solar-sunrise-sunset date))) (format "Sun times: %s | %s | %s" (apply \'solar-time-string (car l)) (apply \'solar-time-string (cadr l)) (nth 2 l))))';
    const result = evaluateSexpr(parseSexpr(text), { ...ctx(TODAY), calendarTimeDisplayForm: '(24-hours ":" minutes)' });
    assert.match(result, /^Sun times: \d\d:\d\d \| \d\d:\d\d \| 1[2-4]:\d\d$/);
    assert.equal(evaluateSexpr(parseSexpr(text), ctx(new Date(2026, 7, 13))), false);
    assert.equal(evaluateSexpr(parseSexpr("(apply '+ 1 2 (list 3 4))"), ctx(TODAY)), true, 'a number result is a match');
    assert.equal(evaluateSexpr(parseSexpr("(format \"%d\" (apply '+ 1 2 (list 3 4)))"), ctx(TODAY)), '10');
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('a day without the event leaves apply with nothing to pass: solar-time-string gives nil, not an error', () => {
  const polar = { ...ctx(new Date(2026, 11, 21)), calendarLatitude: 80, calendarLongitude: 0 };
  const text = `(let ((l (solar-sunrise-sunset date))) (format "Rise %s" (apply 'solar-time-string (car l))))`;
  assert.equal(evaluateSexpr(parseSexpr(text), polar), 'Rise nil');
  assert.equal(evaluateSexpr(parseSexpr(`(let ((l (solar-sunrise-sunset date))) (when (car l) "up"))`), polar), false);
});

test('diary-entry-time reads hhmm at the start of an entry, as Emacs does, and -9999 when there is none', () => {
  const at = (text) => evaluateSexpr(parseSexpr(`(format "%d" (diary-entry-time "${text}"))`), { candidateDate: new Date(2026, 9, 24), today: new Date(2026, 9, 24) });
  assert.deepEqual(['9:30am foo', 'foo', '1430 x', '12am'].map(at), ['930', '-9999', '1430', '0']); // all four as Emacs 29.3 answers
});

test('diary-sunrise-sunset writes the sentence Emacs does, with the location name or its default', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York'; // sun times are in the device zone
  try {
    const line = (extra) => evaluateSexpr(parseSexpr('(format "%s" (diary-sunrise-sunset))'), { candidateDate: new Date(2026, 9, 24), today: new Date(2026, 9, 24), calendarLatitude: 40.7, calendarLongitude: -74.0, ...extra });
    assert.match(line({}), /^Sunrise \d{1,2}:\d\d[ap]m \([A-Z]{3,4}\), sunset \d{1,2}:\d\d[ap]m \([A-Z]{3,4}\) at 40\.7N, 74\.0W \(\d+:\d\d hrs daylight\)$/);
    assert.match(line({ calendarLocationName: 'NYC' }), / at NYC \(/);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});
