// The prompt text, the live "=> <date>" and the calendar motions of the date prompt (src/date-prompt.js) against Emacs 29.3 / Org 9.6:
// test/fixtures/date-prompt-oracle.json, from tools/gen-date-prompt-oracle.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calendarMotion, datePromptLabel, describeDate, isoDate, moveCalendarDate } from '../src/date-prompt.js';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/date-prompt-oracle.json', import.meta.url), 'utf8'));
const local = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), Number(s.slice(14, 16)), 0);
const prefer = (pf) => (pf === 'nil' ? false : pf === 't' ? true : 'time');

test('the prompt text is the one org-read-date asks', () => {
  const bad = [];
  for (const r of rows.filter((x) => x.kind === 'label')) {
    const got = datePromptLabel({ prefix: r.prefix, defaultTime: r.def ? local(r.def) : null, withTime: r.withTime, now: local(r.now), extendTodayUntil: r.ext });
    if (got !== r.res) bad.push({ r, got });
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('the live display after the input is the one Emacs shows', () => {
  const bad = [];
  for (const r of rows.filter((x) => x.kind === 'describe')) {
    const got = describeDate(r.ans, { defaultTime: r.def ? local(r.def) : null, withTime: r.withTime, now: local(r.now), vars: { preferFuture: prefer(r.pf), extendTodayUntil: r.ext } }).text;
    if (got !== r.res) bad.push({ ans: r.ans, now: r.now, pf: r.pf, withTime: r.withTime, got, want: r.res });
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} differ`);
});

test('the calendar keys move the cursor as the calendar does', () => {
  const bad = [];
  for (const r of rows.filter((x) => x.kind === 'move')) {
    const m = calendarMotion(r.key);
    const got = isoDate(moveCalendarDate(new Date(r.from[0], r.from[1] - 1, r.from[2]), m.unit, m.n));
    if (got !== r.res) bad.push({ from: r.from, key: r.key, got, want: r.res });
  }
  assert.deepEqual(bad, []);
  assert.equal(calendarMotion('C-x'), null);
});
