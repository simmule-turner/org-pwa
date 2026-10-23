import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ordinalSuffix,
  parseOrgAnniversaryLine,
  expandOrgAnniversaryOccurrences,
  formatOrgAnniversaryTitle,
  parseOrgCyclicLine,
  expandOrgCyclicOccurrences,
  parseOrgBlockLine,
  expandOrgBlockOccurrences,
  enumerateDays,
  parseDiaryFloatLine,
  monthSpecMatches,
  nthWeekdayOfMonth,
  expandDiaryFloatOccurrences,
  computeDaylightHours,
  solarSunriseSunset,
  solarDaylight,
} from '../src/diary-sexp.js';

// ---- ordinalSuffix ------------------------------------------------------

test('ordinalSuffix: 1st, 2nd, 3rd, 4th', () => {
  assert.equal(ordinalSuffix(1), 'st');
  assert.equal(ordinalSuffix(2), 'nd');
  assert.equal(ordinalSuffix(3), 'rd');
  assert.equal(ordinalSuffix(4), 'th');
});

test('ordinalSuffix: 11th/12th/13th are always "th", the standard English exception', () => {
  assert.equal(ordinalSuffix(11), 'th');
  assert.equal(ordinalSuffix(12), 'th');
  assert.equal(ordinalSuffix(13), 'th');
});

test('ordinalSuffix: 21st/22nd/23rd (the exception doesn\u2019t apply outside 11-13)', () => {
  assert.equal(ordinalSuffix(21), 'st');
  assert.equal(ordinalSuffix(22), 'nd');
  assert.equal(ordinalSuffix(23), 'rd');
});

test('ordinalSuffix: 111th/112th/113th -- the 11-13 exception also applies to their multiples of 100', () => {
  assert.equal(ordinalSuffix(111), 'th');
  assert.equal(ordinalSuffix(112), 'th');
  assert.equal(ordinalSuffix(113), 'th');
});

// ---- org-anniversary -------------------------------------------------------

test('THE WORKED EXAMPLE: parses and computes the exact Org manual example ("Arthur Dent is %d years old")', () => {
  const parsed = parseOrgAnniversaryLine('%%(org-anniversary 1956 5 14) Arthur Dent is %d years old');
  assert.deepEqual(parsed, { year: 1956, month: 5, day: 14, template: 'Arthur Dent is %d years old' });
  const occ = expandOrgAnniversaryOccurrences(5, 14, new Date(2026, 0, 1), new Date(2026, 11, 31))[0];
  assert.equal(occ.getMonth(), 4);
  assert.equal(occ.getDate(), 14);
  assert.equal(formatOrgAnniversaryTitle(parsed.template, occ.getFullYear() - parsed.year), 'Arthur Dent is 70 years old');
});

test('org-anniversary supports the %d%s ordinal-suffix placeholder, confirmed against diary-anniversary\u2019s own docstring', () => {
  assert.equal(formatOrgAnniversaryTitle('%d%s wedding anniversary', 21), '21st wedding anniversary');
  assert.equal(formatOrgAnniversaryTitle('%d%s wedding anniversary', 11), '11th wedding anniversary');
  assert.equal(formatOrgAnniversaryTitle('%d%s wedding anniversary', 22), '22nd wedding anniversary');
});

test('org-anniversary: February 29 is treated as March 1 in a non-leap year', () => {
  const occ = expandOrgAnniversaryOccurrences(2, 29, new Date(2026, 0, 1), new Date(2026, 11, 31))[0];
  assert.equal(occ.getMonth(), 2); // March
  assert.equal(occ.getDate(), 1);
});

test('org-anniversary: February 29 occurs normally in a leap year', () => {
  const occ = expandOrgAnniversaryOccurrences(2, 29, new Date(2028, 0, 1), new Date(2028, 11, 31))[0];
  assert.equal(occ.getMonth(), 1); // February
  assert.equal(occ.getDate(), 29);
});

test('parseOrgAnniversaryLine returns null for malformed input', () => {
  assert.equal(parseOrgAnniversaryLine('%%(org-anniversary 1956 13 14) bad month'), null);
  assert.equal(parseOrgAnniversaryLine('not a sexp at all'), null);
});

// ---- org-cyclic ---------------------------------------------------------

// These dates are local midnights, so they are read back with local fields; toISOString() would shift them by the zone.
const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('parses and computes every-N-days-from-baseline occurrences', () => {
  const parsed = parseOrgCyclicLine('%%(org-cyclic 14 2026 1 1) Water the succulent');
  assert.deepEqual(parsed, { n: 14, year: 2026, month: 1, day: 1, title: 'Water the succulent' });
  const baseline = new Date(2026, 0, 1);
  const occs = expandOrgCyclicOccurrences(14, baseline, new Date(2026, 0, 1), new Date(2026, 1, 15));
  assert.deepEqual(
    occs.map((d) => localYmd(d)),
    ['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12']
  );
});

test('org-cyclic never occurs before the baseline date', () => {
  const baseline = new Date(2026, 5, 1);
  const occs = expandOrgCyclicOccurrences(7, baseline, new Date(2026, 0, 1), new Date(2026, 4, 31));
  assert.equal(occs.length, 0);
});

test('org-cyclic correctly resumes mid-range, not just from the very first rangeStart', () => {
  const baseline = new Date(2026, 0, 1);
  const occs = expandOrgCyclicOccurrences(10, baseline, new Date(2026, 0, 15), new Date(2026, 0, 31));
  // baseline + 10 = Jan 11 (before range), +20 = Jan 21, +30 = Jan 31
  assert.deepEqual(
    occs.map((d) => localYmd(d)),
    ['2026-01-21', '2026-01-31']
  );
});

test('parseOrgCyclicLine returns null for malformed input', () => {
  assert.equal(parseOrgCyclicLine('%%(org-cyclic 0 2026 1 1) bad interval'), null);
  assert.equal(parseOrgCyclicLine('%%(org-cyclic 14 2026 13 1) bad month'), null);
});

// ---- org-block -----------------------------------------------------------

test('flags every day within an inclusive date range', () => {
  const parsed = parseOrgBlockLine('%%(org-block 2026 1 1 2026 1 5) Winter break');
  const occs = expandOrgBlockOccurrences(parsed.dateA, parsed.dateB, new Date(2026, 0, 1), new Date(2026, 0, 31));
  assert.equal(occs.length, 5);
  assert.equal(occs[0].getDate(), 1);
  assert.equal(occs[4].getDate(), 5);
});

test('org-block is order-independent -- a block written with the end date first still works', () => {
  const parsed = parseOrgBlockLine('%%(org-block 2026 1 5 2026 1 1) Winter break (backwards)');
  const occs = expandOrgBlockOccurrences(parsed.dateA, parsed.dateB, new Date(2026, 0, 1), new Date(2026, 0, 31));
  assert.equal(occs.length, 5);
});

test('org-block correctly clips to the requested agenda range, not the full block', () => {
  const parsed = parseOrgBlockLine('%%(org-block 2026 1 1 2026 1 31) Whole month');
  const occs = expandOrgBlockOccurrences(parsed.dateA, parsed.dateB, new Date(2026, 0, 10), new Date(2026, 0, 15));
  assert.equal(occs.length, 6); // just the 10th-15th, not the whole month
});

// ---- diary-float -----------------------------------------------------------

test('THE WORKED EXAMPLE: Thanksgiving (4th Thursday in November)', () => {
  const parsed = parseDiaryFloatLine('%%(diary-float 11 4 4) Thanksgiving');
  assert.deepEqual(parsed, { monthSpec: 11, dayname: 4, n: 4, day: null, year: null, title: 'Thanksgiving' });
  const occs = expandDiaryFloatOccurrences(11, 4, 4, null, null, new Date(2026, 0, 1), new Date(2026, 11, 31));
  assert.equal(occs.length, 1);
  assert.equal(occs[0].getMonth(), 10);
  assert.equal(occs[0].getDate(), 26); // real-world Thanksgiving 2026
});

test('THE WORKED EXAMPLE: US Election Day, "Tuesday after the first Monday in November"', () => {
  // If Nov 1 is a Tuesday, election day is Nov 8 -- exactly as specified.
  const parsed = parseDiaryFloatLine('%%(diary-float 11 2 1 2) US Election Day');
  assert.deepEqual(parsed, { monthSpec: 11, dayname: 2, n: 1, day: 2, year: null, title: 'US Election Day' });
  // 2022: November 1 was a real, historical Tuesday.
  const occs = expandDiaryFloatOccurrences(11, 2, 1, 2, null, new Date(2022, 0, 1), new Date(2022, 11, 31));
  assert.equal(occs.length, 1);
  assert.equal(occs[0].getMonth(), 10);
  assert.equal(occs[0].getDate(), 8); // the actual historical 2022 US election date
});

test('diary-float supports a list of months for quarterly-style recurrence', () => {
  const parsed = parseDiaryFloatLine('%%(diary-float (1 4 7 10) 5 1) Quarterly review');
  assert.deepEqual(parsed.monthSpec, [1, 4, 7, 10]);
  const occs = expandDiaryFloatOccurrences(parsed.monthSpec, 5, 1, null, null, new Date(2026, 0, 1), new Date(2026, 11, 31));
  assert.equal(occs.length, 4);
});

test('diary-float supports "t" for every month', () => {
  const parsed = parseDiaryFloatLine('%%(diary-float t 5 1) First Friday');
  assert.equal(parsed.monthSpec, 't');
  const occs = expandDiaryFloatOccurrences('t', 5, 1, null, null, new Date(2026, 0, 1), new Date(2026, 2, 31));
  assert.equal(occs.length, 3); // Jan, Feb, Mar
});

test('diary-float negative N counts backward from the end of the month', () => {
  const occ = nthWeekdayOfMonth(2026, 3, 5, -1, null); // last Friday of March 2026
  assert.equal(occ.getDate(), 27);
});

test('the fifth argument of diary-float is a face, as in Emacs, and does not limit the year', () => {
  const parsed = parseDiaryFloatLine('%%(diary-float 11 4 4 1 2026) Thanksgiving');
  assert.equal(parsed.day, 1);
  assert.equal(expandDiaryFloatOccurrences(11, 4, 4, 1, 2026, new Date(2025, 0, 1), new Date(2025, 11, 31)).length, 1);
  assert.equal(expandDiaryFloatOccurrences(11, 4, 4, 1, 2026, new Date(2026, 0, 1), new Date(2026, 11, 31)).length, 1);
});

test('the Nth weekday after a day may fall in the next month, as in Emacs', () => {
  const days = expandDiaryFloatOccurrences(3, 4, 3, 15, null, new Date(2026, 0, 1), new Date(2026, 11, 31));
  assert.deepEqual(days.map((d) => `${d.getMonth() + 1}/${d.getDate()}`), ['4/2']);
});

test('monthSpecMatches handles all three forms', () => {
  assert.equal(monthSpecMatches('t', 7), true);
  assert.equal(monthSpecMatches([1, 4, 7], 7), true);
  assert.equal(monthSpecMatches([1, 4, 7], 5), false);
  assert.equal(monthSpecMatches(11, 11), true);
  assert.equal(monthSpecMatches(11, 5), false);
});

test('nthWeekdayOfMonth returns null when the occurrence doesn\u2019t exist (N too large)', () => {
  // No month has a 6th occurrence of any single weekday.
  assert.equal(nthWeekdayOfMonth(2026, 1, 4, 6, null), null);
});

test('parseDiaryFloatLine returns null for malformed input', () => {
  assert.equal(parseDiaryFloatLine('%%(diary-float 13 4 4) bad month'), null);
  assert.equal(parseDiaryFloatLine('%%(diary-float 11 7 4) bad dayname'), null);
});

// ---- day length -------------------------------------------------------------














// ---- solar-sunrise-sunset ----------------------------------------------------





test('THE FIX: computeDaylightHours correctly disambiguates polar day (24 hours) from polar night (0 hours) -- verified against the standard solar-noon-elevation formula, not assumed', () => {
  assert.equal(computeDaylightHours(new Date(2026, 5, 21), 75, 25.0), 24, 'high-latitude midsummer: continuous daylight');
  assert.equal(computeDaylightHours(new Date(2026, 11, 21), 75, 25.0), 0, 'same latitude, midwinter: continuous night');
});

test('summer solstice has more daylight hours than winter solstice, computed via computeDaylightHours directly (not just the two independent sunrise/sunset values, as the earlier, already-existing test does)', () => {
  const summer = computeDaylightHours(new Date(2026, 5, 21), 35.994, -78.8986);
  const winter = computeDaylightHours(new Date(2026, 11, 21), 35.994, -78.8986);
  assert.ok(summer > winter);
});



// ---- enumerateDays -----------------------------------------------------------

test('enumerateDays returns every day in an inclusive range', () => {
  const days = enumerateDays(new Date(2026, 0, 1), new Date(2026, 0, 3));
  assert.equal(days.length, 3);
});

test('enumerateDays returns a single day when start equals end', () => {
  const days = enumerateDays(new Date(2026, 0, 1), new Date(2026, 0, 1));
  assert.equal(days.length, 1);
});

test('solarDaylight truncates to "H:MM" as Emacs’s solar-daylight does', () => {
  assert.equal(solarDaylight(13.5), '13:30');
  assert.equal(solarDaylight(13.999), '13:59');
  assert.equal(solarDaylight(0), '0:00');
  assert.equal(solarDaylight(24), '24:00');
});

test('solarSunriseSunset: local rise and set in decimal hours, the zone, and the daylight', () => {
  const day = new Date(2026, 5, 21);
  const sun = solarSunriseSunset(day, 35.994, -78.8986);
  assert.ok(sun.rise !== null && sun.set !== null);
  assert.match(sun.daylight, /^14:\d\d$/);
  assert.equal(typeof sun.zone, 'string');
  assert.ok(Math.abs((((sun.set - sun.rise) % 24) + 24) % 24 - computeDaylightHours(day, 35.994, -78.8986)) < 0.05);
});

test('solarSunriseSunset: the height argument gives the twilights, earlier the lower the sun', () => {
  const day = new Date(2026, 2, 20);
  const rise = solarSunriseSunset(day, 40, -75).rise;
  const civil = solarSunriseSunset(day, 40, -75, -6).rise;
  const nautical = solarSunriseSunset(day, 40, -75, -12).rise;
  const astronomical = solarSunriseSunset(day, 40, -75, -18).rise;
  const apart = (/** @type {number} */ from, /** @type {number} */ to) => (((to - from) % 24) + 24) % 24;
  assert.ok(apart(astronomical, nautical) > 0 && apart(nautical, civil) > 0 && apart(civil, rise) > 0);
});

test('solarSunriseSunset: null for the events a polar day lacks, with the daylight 0:00 or 24:00', () => {
  const night = solarSunriseSunset(new Date(2026, 11, 21), 80, 0);
  assert.equal(night.rise, null);
  assert.equal(night.set, null);
  assert.equal(night.daylight, '0:00');
  assert.equal(solarSunriseSunset(new Date(2026, 5, 21), 80, 0).daylight, '24:00');
});
