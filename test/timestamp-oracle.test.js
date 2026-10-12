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

function oursFrom(p) {
  return {
    active: p.active,
    y: p.date.getFullYear(), mo: p.date.getMonth() + 1, d: p.date.getDate(),
    h: p.hasTime ? p.date.getHours() : null, min: p.hasTime ? p.date.getMinutes() : null,
    endH: p.endDate ? p.endDate.getHours() : null, endMin: p.endDate ? p.endDate.getMinutes() : null,
    repeater: p.repeater, delay: p.delay,
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
