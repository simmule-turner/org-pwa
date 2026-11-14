// Holds src/org-timestamp.js to real Emacs: test/fixtures/timestamp-oracle.json was made by tools/gen-timestamp-oracle.mjs, which
// reads each string with org-element in Emacs 29.3 and records what it found, and names the weekday of a spread of dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findTimestamps, formatOrgTimestamp, parseOrgTimestamp } from '../src/org-timestamp.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/timestamp-oracle.json', import.meta.url), 'utf8'));
const UNIT = { hour: 'h', day: 'd', week: 'w', month: 'm', year: 'y' };
const REPEAT_MARK = { cumulate: '+', 'catch-up': '++', restart: '.+' };

/** What Emacs found, in the terms parseOrgTimestamp reports. */
function expectedFrom(e) {
  const hasTime = e.hs !== false;
  return {
    active: e.type.startsWith('active'),
    y: e.ys, mo: e.ms, d: e.ds,
    h: hasTime ? e.hs : null, min: hasTime ? e.is : null,
    endH: hasTime && e.he !== e.hs ? e.he : hasTime && e.ie !== e.is ? e.he : null,
    endMin: hasTime && (e.he !== e.hs || e.ie !== e.is) ? e.ie : null,
    repeater: e.rt ? `${REPEAT_MARK[e.rt]}${e.rv}${UNIT[e.ru]}` : null,
    delay: e.wt ? `${e.wt === 'first' ? '--' : '-'}${e.wv}${UNIT[e.wu]}` : null,
  };
}

// The numbers as written: a day or time that does not exist (2021-02-29, 24:00) is kept, as Emacs keeps it. The repeater string of ours
// carries a habit's last-chance period (`+1d/2d`) that Emacs leaves out of the repeater, so it is read without it.
function oursFrom(p) {
  const f = p.fields;
  return {
    active: p.active,
    y: f.year, mo: f.month, d: f.day,
    h: f.hour, min: f.minute,
    endH: f.endHour, endMin: f.endMinute,
    repeater: p.repeater && p.repeater.replace(/\/.*$/, ''), delay: p.delay,
  };
}

test(`a timestamp is read the way Emacs reads it, for ${oracle.cases.length} strings`, () => {
  const wrong = [];
  for (const c of oracle.cases) {
    const got = parseOrgTimestamp(c.ts);
    if (!c.emacs) {
      if (got) wrong.push(`${c.ts}: Emacs does not read it as a timestamp, we do`);
      continue;
    }
    if (c.emacs.type.endsWith('range')) continue; // a date range is two timestamps joined by "--": read piecewise
    if (!got) {
      wrong.push(`${c.ts}: Emacs reads it, we do not`);
      continue;
    }
    const want = JSON.stringify(expectedFrom(c.emacs));
    const have = JSON.stringify(oursFrom(got));
    if (want !== have) wrong.push(`${c.ts}: ours ${have}, Emacs ${want}`);
  }
  assert.deepEqual(wrong.slice(0, 15), [], `${wrong.length} of ${oracle.cases.length} differ`);
});

test(`the weekday written for a date is the one Emacs names, for ${oracle.weekdays.length} dates`, () => {
  for (const { date, weekday } of oracle.weekdays) {
    const [y, m, d] = date.split('-').map(Number);
    const text = formatOrgTimestamp({ date: new Date(y, m - 1, d) });
    assert.equal(text, `<${date} ${weekday}>`);
  }
});

test('a timestamp inside a line of text is found the way Emacs finds it', () => {
  const found = findTimestamps('Dinner <2026-10-11 Sun 18:30> and [2026-10-12 Mon] then <2026-10-13 +1w>');
  assert.equal(found.length, 3);
});

test('the last-chance period of a repeater is kept with it, as a habit reads it, and written as a number', () => {
  assert.equal(parseOrgTimestamp('<2020-01-01 Wed +01d/02d>').repeater, '+1d/2d');
  assert.equal(parseOrgTimestamp('<2020-01-01 Wed .+1w/2w>').repeater, '.+1w/2w');
  assert.equal(parseOrgTimestamp('<2020-01-01 Wed +007w -03d>').repeater, '+7w');
});

test(`timestamps in running text are the ones Emacs finds there, for ${oracle.found.length} texts`, () => {
  const wrong = [];
  for (const c of oracle.found) {
    const got = findTimestamps(c.text).map((t) => {
      const a = t.fields;
      const e = t.end ? t.end.fields : null;
      return {
        raw: t.raw,
        start: [a.year, a.month, a.day, a.hour, a.minute],
        end: e ? [e.year, e.month, e.day, e.hour, e.minute] : [a.year, a.month, a.day, a.endHour ?? a.hour, a.endHour !== null ? a.endMinute : a.minute],
      };
    });
    const want = c.emacs.map((e) => ({
      raw: e.raw,
      start: [e.ys, e.ms, e.ds, e.hs === false ? null : e.hs, e.is === false ? null : e.is],
      end: [e.ye, e.me, e.de, e.he === false ? null : e.he, e.ie === false ? null : e.ie],
    }));
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ text: c.text, got, want });
  }
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} differ`);
});
