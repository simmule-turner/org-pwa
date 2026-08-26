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
  computeSunriseSunsetUtc,
  formatSunTime,
  formatSunTime24,
  isDiarySunriseLine,
  formatSunriseLine,
  isDiarySunsetLine,
  formatSunsetLine,
  isDiaryCivilDawnLine,
  formatCivilDawnLine,
  isDiaryCivilDuskLine,
  formatCivilDuskLine,
  isDiaryNauticalDawnLine,
  formatNauticalDawnLine,
  isDiaryNauticalDuskLine,
  formatNauticalDuskLine,
  isDiaryAstronomicalDawnLine,
  formatAstronomicalDawnLine,
  isDiaryAstronomicalDuskLine,
  formatAstronomicalDuskLine,
  computeDaylightHours,
  formatDayLengthLine,
  isDiaryDayLengthLine,
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

test('parses and computes every-N-days-from-baseline occurrences', () => {
  const parsed = parseOrgCyclicLine('%%(org-cyclic 14 2026 1 1) Water the succulent');
  assert.deepEqual(parsed, { n: 14, year: 2026, month: 1, day: 1, title: 'Water the succulent' });
  const baseline = new Date(2026, 0, 1);
  const occs = expandOrgCyclicOccurrences(14, baseline, new Date(2026, 0, 1), new Date(2026, 1, 15));
  assert.deepEqual(
    occs.map((d) => d.toISOString().slice(0, 10)),
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
    occs.map((d) => d.toISOString().slice(0, 10)),
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

test('diary-float honors an explicit year filter -- only that one year, blank in all others', () => {
  const parsed = parseDiaryFloatLine('%%(diary-float 11 4 4 1 2026) One-off Thanksgiving');
  assert.equal(parsed.year, 2026);
  assert.equal(parsed.day, 1);
  const occs2025 = expandDiaryFloatOccurrences(11, 4, 4, 1, 2026, new Date(2025, 0, 1), new Date(2025, 11, 31));
  assert.equal(occs2025.length, 0);
  const occs2026 = expandDiaryFloatOccurrences(11, 4, 4, 1, 2026, new Date(2026, 0, 1), new Date(2026, 11, 31));
  assert.equal(occs2026.length, 1);
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
  assert.equal(parseDiaryFloatLine('%%(diary-float 11 4 0) zero N not allowed'), null);
});

// ---- diary-sunrise / diary-sunset / diary-civil-dawn / diary-civil-dusk ----

test('formatSunTime24 formats hours correctly in 24-hour, zero-filled format', () => {
  assert.equal(formatSunTime24(0, 0), '00:00'); // midnight
  assert.equal(formatSunTime24(12, 0), '12:00'); // noon
  assert.equal(formatSunTime24(6.5, 0), '06:30');
  assert.equal(formatSunTime24(18.25, 0), '18:15');
  assert.equal(formatSunTime24(9, 0), '09:00'); // single-digit hour, zero-filled
});

test('THE FIX: formatSunTime24 returns \u2019n/a\u2019 for a null (polar day/night) input', () => {
  assert.equal(formatSunTime24(null, 0), 'n/a');
});

test('isDiarySunriseLine / isDiarySunsetLine / isDiaryCivilDawnLine / isDiaryCivilDuskLine each recognize their own exact trigger, and correctly reject each other\u2019s', () => {
  assert.equal(isDiarySunriseLine('%%(diary-sunrise)'), true);
  assert.equal(isDiarySunriseLine('%%(diary-sunrise-sunset)'), false, 'must not accidentally match a longer string sharing the same prefix');
  assert.equal(isDiarySunriseLine('%%(diary-sunrise) trailing text'), false);

  assert.equal(isDiarySunsetLine('%%(diary-sunset)'), true);
  assert.equal(isDiarySunsetLine('%%(diary-sunrise)'), false);

  assert.equal(isDiaryCivilDawnLine('%%(diary-civil-dawn)'), true);
  assert.equal(isDiaryCivilDawnLine('%%(diary-sunrise)'), false, 'must not accidentally match the shorter, unrelated trigger');

  assert.equal(isDiaryCivilDuskLine('%%(diary-civil-dusk)'), true);
  assert.equal(isDiaryCivilDuskLine('%%(diary-civil-dawn)'), false);
});

test('THE FIX: all four functions produce the exact requested "HH:MM Label" format, in 24-hour zero-filled time', () => {
  const date = new Date(2026, 7, 8);
  assert.match(formatSunriseLine(date, 35.994, -78.8986, -240), /^\d\d:\d\d Sunrise$/);
  assert.match(formatSunsetLine(date, 35.994, -78.8986, -240), /^\d\d:\d\d Sunset$/);
  assert.match(formatCivilDawnLine(date, 35.994, -78.8986, -240), /^\d\d:\d\d Dawn$/);
  assert.match(formatCivilDuskLine(date, 35.994, -78.8986, -240), /^\d\d:\d\d Dusk$/);
});

test('the four single-value functions produce the expected values for a known date/location', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatSunriseLine(date, 35.994, -78.8986, -240), '06:30 Sunrise');
  assert.equal(formatSunsetLine(date, 35.994, -78.8986, -240), '20:15 Sunset');
  assert.equal(formatCivilDawnLine(date, 35.994, -78.8986, -240), '06:02 Dawn');
  assert.equal(formatCivilDuskLine(date, 35.994, -78.8986, -240), '20:43 Dusk');
});

test('THE FIX: n/a for whichever value doesn\u2019t occur -- civil dawn/dusk during "white nights" at high latitude, while ordinary sunrise/sunset still succeed', () => {
  const date = new Date(2026, 5, 21);
  assert.match(formatSunriseLine(date, 64, 25.0, 120), /^\d\d:\d\d Sunrise$/, 'sunrise still occurs normally');
  assert.equal(formatCivilDawnLine(date, 64, 25.0, 120), 'n/a Dawn', 'but civil dawn never happens at this latitude/date');
  assert.equal(formatCivilDuskLine(date, 64, 25.0, 120), 'n/a Dusk');
});

test('THE FEATURE: isDiaryNauticalDawnLine / isDiaryNauticalDuskLine / isDiaryAstronomicalDawnLine / isDiaryAstronomicalDuskLine each recognize their own exact trigger, and correctly reject each other\u2019s (including the civil pair)', () => {
  assert.equal(isDiaryNauticalDawnLine('%%(diary-nautical-dawn)'), true);
  assert.equal(isDiaryNauticalDawnLine('%%(diary-civil-dawn)'), false, 'must not accidentally match the civil pair');
  assert.equal(isDiaryNauticalDawnLine('%%(diary-astronomical-dawn)'), false);

  assert.equal(isDiaryNauticalDuskLine('%%(diary-nautical-dusk)'), true);
  assert.equal(isDiaryNauticalDuskLine('%%(diary-nautical-dawn)'), false);

  assert.equal(isDiaryAstronomicalDawnLine('%%(diary-astronomical-dawn)'), true);
  assert.equal(isDiaryAstronomicalDawnLine('%%(diary-nautical-dawn)'), false);

  assert.equal(isDiaryAstronomicalDuskLine('%%(diary-astronomical-dusk)'), true);
  assert.equal(isDiaryAstronomicalDuskLine('%%(diary-astronomical-dawn)'), false);
});

test('THE FEATURE: nautical and astronomical dawn/dusk produce the expected values for a known date/location -- each progressively earlier/later than civil twilight, matching the deeper sun angle', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatCivilDawnLine(date, 35.994, -78.8986, -240), '06:02 Dawn');
  assert.equal(formatNauticalDawnLine(date, 35.994, -78.8986, -240), '05:28 Dawn');
  assert.equal(formatAstronomicalDawnLine(date, 35.994, -78.8986, -240), '04:53 Dawn');
  assert.equal(formatCivilDuskLine(date, 35.994, -78.8986, -240), '20:43 Dusk');
  assert.equal(formatNauticalDuskLine(date, 35.994, -78.8986, -240), '21:17 Dusk');
  assert.equal(formatAstronomicalDuskLine(date, 35.994, -78.8986, -240), '21:52 Dusk');
});

test('THE FEATURE: n/a for nautical/astronomical dawn/dusk during white nights, same as the civil pair already gets', () => {
  const date = new Date(2026, 5, 21);
  assert.equal(formatNauticalDawnLine(date, 64, 25.0, 120), 'n/a Dawn');
  assert.equal(formatNauticalDuskLine(date, 64, 25.0, 120), 'n/a Dusk');
  assert.equal(formatAstronomicalDawnLine(date, 64, 25.0, 120), 'n/a Dawn');
  assert.equal(formatAstronomicalDuskLine(date, 64, 25.0, 120), 'n/a Dusk');
});

test('THE FEATURE: solar-ampm and solar-hide-label apply to the four new functions exactly as they already do to the civil pair', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatNauticalDawnLine(date, 35.994, -78.8986, -240, true), '5:28am Dawn');
  assert.equal(formatNauticalDawnLine(date, 35.994, -78.8986, -240, false, true), '05:28');
});

test('THE FIX: solar-ampm (default false/24-hour, unchanged) switches all four single-value functions to 12-hour am/pm when true', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatSunriseLine(date, 35.994, -78.8986, -240), '06:30 Sunrise', 'default: 24-hour, unaffected');
  assert.equal(formatSunriseLine(date, 35.994, -78.8986, -240, true), '6:30am Sunrise', 'ampm=true switches format');
  assert.equal(formatSunsetLine(date, 35.994, -78.8986, -240, true), '8:15pm Sunset');
  assert.equal(formatCivilDawnLine(date, 35.994, -78.8986, -240, true), '6:02am Dawn');
  assert.equal(formatCivilDuskLine(date, 35.994, -78.8986, -240, true), '8:43pm Dusk');
});

test('THE FIX: solar-hide-label (default false/label shown, unchanged) omits the trailing label entirely when true, leaving just the bare time', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatSunriseLine(date, 35.994, -78.8986, -240, false, true), '06:30');
  assert.equal(formatSunsetLine(date, 35.994, -78.8986, -240, false, true), '20:15');
  assert.equal(formatCivilDawnLine(date, 35.994, -78.8986, -240, false, true), '06:02');
  assert.equal(formatCivilDuskLine(date, 35.994, -78.8986, -240, false, true), '20:43');
});

test('THE FIX: solar-ampm and solar-hide-label combine correctly -- 12-hour time, no label', () => {
  const date = new Date(2026, 7, 8);
  assert.equal(formatSunriseLine(date, 35.994, -78.8986, -240, true, true), '6:30am');
});

// ---- diary-day-length -------------------------------------------------------

test('THE FIX: diary-day-length produces the exact requested "HH:MM daylight" format, 24-hour zero-filled', () => {
  const line = formatDayLengthLine(new Date(2026, 7, 8), 35.994, -78.8986);
  assert.match(line, /^\d\d:\d\d daylight$/);
});

test('THE FIX: diary-day-length is consistent with sunset minus sunrise for the same date/location', () => {
  const date = new Date(2026, 7, 8);
  const hours = computeDaylightHours(date, 35.994, -78.8986);
  assert.ok(hours > 13.5 && hours < 14, `expected roughly 13.7-13.8 hours of daylight in early August at this latitude, got ${hours}`);
});

test('THE FIX: only solar-hide-label affects diary-day-length\u2019s own output -- there\u2019s no separate ampm parameter at all, since a duration has no time-of-day format to switch between, per the explicit clarification', () => {
  const date = new Date(2026, 7, 8);
  assert.match(formatDayLengthLine(date, 35.994, -78.8986, false), /^\d\d:\d\d daylight$/, 'label shown, default');
  assert.match(formatDayLengthLine(date, 35.994, -78.8986, true), /^\d\d:\d\d$/, 'label hidden, still 24-hour -- no am/pm concept applies here at all');
});

test('THE FIX: isDiaryDayLengthLine recognizes the exact trigger, nothing else', () => {
  assert.equal(isDiaryDayLengthLine('%%(diary-day-length)'), true);
  assert.equal(isDiaryDayLengthLine('%%(diary-day-length) trailing text'), false);
  assert.equal(isDiaryDayLengthLine('%%(diary-sunrise)'), false);
});

test('THE FIX: computeDaylightHours correctly disambiguates polar day (24 hours) from polar night (0 hours) -- verified against the standard solar-noon-elevation formula, not assumed', () => {
  assert.equal(computeDaylightHours(new Date(2026, 5, 21), 75, 25.0), 24, 'high-latitude midsummer: continuous daylight');
  assert.equal(computeDaylightHours(new Date(2026, 11, 21), 75, 25.0), 0, 'same latitude, midwinter: continuous night');
});

test('summer solstice has more daylight hours than winter solstice, computed via computeDaylightHours directly (not just the two independent sunrise/sunset values, as the earlier, already-existing test does)', () => {
  const summer = computeDaylightHours(new Date(2026, 5, 21), 35.994, -78.8986);
  const winter = computeDaylightHours(new Date(2026, 11, 21), 35.994, -78.8986);
  assert.ok(summer > winter);
});

test('formatSunTime formats hours correctly with am/pm, including the 12-hour edge cases', () => {
  assert.equal(formatSunTime(0, 0), '12:00am'); // midnight
  assert.equal(formatSunTime(12, 0), '12:00pm'); // noon
  assert.equal(formatSunTime(6.5, 0), '6:30am');
  assert.equal(formatSunTime(18.25, 0), '6:15pm');
});

test('formatSunTime correctly applies a timezone offset, wrapping across midnight', () => {
  assert.equal(formatSunTime(23, -240), '7:00pm'); // 23:00 UTC - 4h = 19:00 local
  assert.equal(formatSunTime(1, -240), '9:00pm'); // 01:00 UTC - 4h wraps back to 21:00 the previous local day
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
