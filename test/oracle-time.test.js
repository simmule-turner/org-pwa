import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as conv from '../src/calendar-conv.js';
import * as chinese from '../src/calendar-chinese.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { evaluateSexpr, parseSexpr } from '../src/sexp-eval.js';
import { parseOrgTimestamp } from '../src/org-timestamp.js';
import { KNOWN_TIME } from './support/oracle-time-known.js';

// Emacs 29.3 answered every case (tools/gen-oracle-time.mjs): calendar conversions from an absolute day number, to one from valid
// and invalid dates, the day of the week, and org-duration-to-minutes.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-time.json', import.meta.url), 'utf8'));

/** Runs `fn`; a thrown error or a non-finite number is "ERROR", as the generator records Emacs's errors. */
const attempt = (/** @type {() => any} */ fn) => {
  try {
    const v = fn();
    return typeof v === 'number' && !Number.isFinite(v) ? 'ERROR' : v;
  } catch {
    return 'ERROR';
  }
};

const FROM = /** @type {const} */ ({
  g: conv.gregorianFromAbsolute,
  j: conv.julianFromAbsolute,
  h: conv.hebrewFromAbsolute,
  i: conv.islamicFromAbsolute,
  b: conv.bahaiFromAbsolute,
  c: chinese.chineseFromAbsolute,
});

const TO = /** @type {Record<string, (d: number[]) => number>} */ ({
  gregorian: (d) => conv.absoluteFromGregorian(/** @type {any} */ (d)),
  julian: (d) => conv.julianToAbsolute(/** @type {any} */ (d)),
  hebrew: (d) => conv.hebrewToAbsolute(/** @type {any} */ (d)),
  islamic: (d) => conv.islamicToAbsolute(/** @type {any} */ (d)),
  bahai: (d) => conv.bahaiToAbsolute(/** @type {any} */ (d)),
  chinese: (d) => chinese.chineseToAbsolute(/** @type {any} */ (d)),
});

const same = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(a) === JSON.stringify(b);
const known = (/** @type {string} */ kind, /** @type {any} */ c) => KNOWN_TIME.find((r) => r.kind === kind && r.match(c));

test('a day number becomes the date Emacs gives in each calendar, and the weekday', () => {
  const bad = [];
  for (const d of oracle.days) {
    for (const key of /** @type {const} */ (['g', 'j', 'h', 'i', 'b', 'c'])) {
      const got = attempt(() => Array.from(FROM[key](d.abs)));
      if (!same(got, d[key] === undefined ? 'ERROR' : Array.from(d[key]).length === 1 && d[key][0] === 'ERROR' ? 'ERROR' : d[key]) && !known('from-' + key, d)) bad.push({ abs: d.abs, key, got, want: d[key] });
    }
    const dow = attempt(() => conv.dayOfWeek(d.abs));
    if (dow !== d.dow && !known('dow', d)) bad.push({ abs: d.abs, key: 'dow', got: dow, want: d.dow });
  }
  assert.equal(bad.length, 0, `${bad.length} differ\n` + JSON.stringify(bad.slice(0, 6)));
});

test('valid and invalid dates become the day number Emacs gives', () => {
  const bad = [];
  for (const o of oracle.odd) {
    const got = attempt(() => TO[o.cal](o.date));
    if (!same(got, o.abs) && !known('to-abs', o)) bad.push({ cal: o.cal, date: o.date, got, want: o.abs });
  }
  assert.equal(bad.length, 0, `${bad.length} differ\n` + JSON.stringify(bad.slice(0, 8)));
});

test('org-duration-to-minutes: the same minutes, and an error where Emacs signals one', () => {
  const bad = [];
  for (const c of oracle.durations) {
    const v = parseOrgDuration(c.text);
    const got = v === null ? 'ERROR' : v;
    const ok = c.minutes === 'ERROR' || got === 'ERROR' ? got === c.minutes : Math.abs(got - c.minutes) < 1e-6;
    if (!ok && !known('duration', c)) bad.push({ text: c.text, got, want: c.minutes });
  }
  assert.equal(bad.length, 0, `${bad.length} differ\n` + JSON.stringify(bad.slice(0, 12)));
});

const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('diary expressions match on the days Emacs matches, with the text Emacs gives', () => {
  const bad = [];
  for (const [src, days] of Object.entries(oracle.sexps)) {
    /** @type {Record<string, string>} */ const got = {};
    for (let d = new Date(2026, 0, 1); d <= new Date(2029, 11, 31); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      let result;
      try {
        result = evaluateSexpr(parseSexpr(src), { candidateDate: d, today: new Date(2026, 9, 11), entryText: 'ENTRY', timeZone: 'America/New_York' });
      } catch {
        result = false;
      }
      if (result) got[iso(d)] = typeof result === 'string' && result !== 'ENTRY' ? result : 't';
    }
    const want = Object.fromEntries(Object.entries(days).map(([d, v]) => [d, v === 'ENTRY' ? 't' : v]));
    if (!same(got, want) && !known('sexp', { src })) {
      const dates = [...new Set([...Object.keys(got), ...Object.keys(want)])].sort().filter((k) => got[k] !== want[k]);
      bad.push({ src, n: dates.length, first: dates.slice(0, 2).map((k) => [k, got[k], want[k]]) });
    }
  }
  assert.equal(bad.length, 0, `${bad.length} expressions differ\n` + JSON.stringify(bad.slice(0, 12)));
});

const UNIT = { hour: 'h', day: 'd', week: 'w', month: 'm', year: 'y' };
const REPEAT_MARK = { cumulate: '+', 'catch-up': '++', restart: '.+' };

/** What Emacs found, in the terms parseOrgTimestamp reports. @param {any} e */
function expectedStamp(e) {
  const hasTime = e.hs !== false;
  return {
    active: e.type.startsWith('active'),
    y: e.ys, mo: e.ms, d: e.ds,
    h: hasTime ? e.hs : null, min: hasTime ? e.is : null,
    endH: hasTime && (e.he !== e.hs || e.ie !== e.is) ? e.he : null,
    endMin: hasTime && (e.he !== e.hs || e.ie !== e.is) ? e.ie : null,
    // @ts-ignore -- keyed by what org-element reports
    repeater: e.rt ? `${REPEAT_MARK[e.rt]}${e.rv}${UNIT[e.ru]}` : null,
    // @ts-ignore
    delay: e.wt ? `${e.wt === 'first' ? '--' : '-'}${e.wv}${UNIT[e.wu]}` : null,
  };
}

/** The same fields from the app's reading, or null when it does not read a timestamp. @param {string} text */
function ourStamp(text) {
  const p = parseOrgTimestamp(text);
  if (!p) return null;
  return {
    active: p.active,
    y: p.date.getFullYear(), mo: p.date.getMonth() + 1, d: p.date.getDate(),
    h: p.hasTime ? p.date.getHours() : null, min: p.hasTime ? p.date.getMinutes() : null,
    endH: p.endDate ? p.endDate.getHours() : null, endMin: p.endDate ? p.endDate.getMinutes() : null,
    // a habit's "/4d" range is the app's own addition, and Emacs gives the number, not its spelling
    repeater: p.repeater && p.repeater.replace(/\/.*/, '').replace(/^([.+]+)0*(\d)/, '$1$2'),
    delay: p.delay && p.delay.replace(/^(-+)0*(\d)/, '$1$2'),
  };
}

/** Whether every number Emacs read is one a Date can hold: a real day, an hour under 24 and minutes under 60. @param {any} w */
function inRange(w) {
  const real = new Date(w.y, w.mo - 1, w.d);
  const dateOk = w.y >= 100 && real.getMonth() === w.mo - 1 && real.getDate() === w.d;
  return dateOk && [w.h, w.endH].every((h) => h === null || h < 24) && [w.min, w.endMin].every((m) => m === null || m < 60);
}

test('odd timestamps are read, or refused, the way Emacs reads them', () => {
  const bad = [];
  for (const c of oracle.timestamps) {
    if (c.emacs && c.emacs.type === 'diary') continue; // a diary sexp is not a plain timestamp: src/diary-sexp.js reads those
    if (c.emacs && c.emacs.type.endsWith('range')) continue; // a date range is two timestamps joined by "--": read piecewise
    let got = ourStamp(c.ts);
    let want = c.emacs ? expectedStamp(c.emacs) : null;
    if (got && want && !inRange(want)) {
      // a Date cannot hold February 30 or 25:99, so such numbers are compared only for being read, with the same marks
      got = { active: got.active, repeater: got.repeater, delay: got.delay };
      want = { active: want.active, repeater: want.repeater, delay: want.delay };
    }
    if (!same(got, want) && !known('timestamp', c)) bad.push({ ts: c.ts, got, want });
  }
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.timestamps.length} differ\n` + JSON.stringify(bad.slice(0, 10)));
});

test('every known-deviation rule still matches a case the app gets wrong', () => {
  assert.deepEqual(KNOWN_TIME.filter((r) => !r.stillWrong()).map((r) => r.id), []);
});
