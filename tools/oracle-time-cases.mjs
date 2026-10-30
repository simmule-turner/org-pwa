// Case lists for tools/gen-oracle-time.mjs: absolute day numbers, odd dates for the to-absolute functions, and duration strings.
let seed = 20261029;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Absolute day numbers: every day of 2026-2027, a spread over the years Emacs and the app both support, and the edges. */
export function absoluteDays() {
  const out = new Set();
  for (let a = 739617; a <= 739617 + 730; a++) out.add(a); // 2026-01-01 .. 2027-12-31 (the absolute number of 2026-01-01 is 739617)
  for (let i = 0; i < 900; i++) out.add(1000 + Math.floor(rnd() * 880000));
  for (const a of [1, 2, 7, 365, 366, 730, 100000, 365 * 400 + 97, 693596, 693597, 693598, 719162, 730120, 767009, 800000]) out.add(a);
  return [...out].sort((x, y) => x - y);
}

/** Dates handed to the *-to-absolute functions, valid and not: [calendar, [..fields]] */
export function oddDates() {
  const out = [];
  for (const d of [[1, 1, 2026], [2, 29, 2024], [2, 29, 2023], [2, 30, 2026], [13, 1, 2026], [0, 1, 2026], [12, 32, 2026], [1, 0, 2026], [1, -1, 2026], [3, 1, 1], [1, 1, 1], [12, 31, 1999], [2, 29, 1900], [2, 29, 2000], [1, 1, 0], [6, 15, 100], [7, 4, 1776]]) out.push(['gregorian', d]);
  for (const d of [[1, 1, 2026], [2, 29, 1900], [2, 29, 2024], [2, 30, 2026], [3, 1, 1], [13, 1, 2026], [12, 25, 1582]]) out.push(['julian', d]);
  for (const d of [[7, 1, 5787], [1, 1, 5787], [13, 29, 5787], [12, 29, 5787], [13, 29, 5784], [13, 1, 5787], [8, 30, 5787], [9, 30, 5787], [9, 29, 5787], [6, 30, 5787], [6, 29, 5786], [2, 31, 5787], [7, 1, 1], [7, 1, 3761], [14, 1, 5787]]) out.push(['hebrew', d]);
  for (const d of [[1, 1, 1448], [12, 30, 1448], [12, 29, 1448], [12, 30, 1447], [1, 31, 1448], [9, 1, 1], [0, 1, 1448], [13, 1, 1448], [6, 30, 1448], [1, 1, 1]]) out.push(['islamic', d]);
  for (const d of [[1, 1, 183], [19, 1, 183], [19, 5, 183], [19, 4, 183], [18, 19, 183], [1, 1, 1], [20, 1, 183]]) out.push(['bahai', d]);
  for (const d of [[78, 43, 12, 12], [78, 43, 1, 1], [78, 43, 5, 1], [78, 43, 4.5, 1], [78, 43, 1, 30], [78, 43, 1, 31], [78, 1, 1, 1], [77, 60, 12, 29], [79, 1, 1, 1]]) out.push(['chinese', d]);
  return out;
}

/** Strings for org-duration-to-minutes. */
export const durationStrings = [
  '', ' ', '0', '30', '1', '0.5', '2.35', '1.5h', '1,5h', '3:12', '0:45', '10:00', '1:23:45', '0:00:30', '1:2', '1:60', '1:99', '100:00', ':30', '3:', '24:00:01',
  '1h', '2h', '2.5h', '1d', '1w', '1m', '1y', '1min', '15min', '90min', '1h30min', '1h 30min', '1d3h5min', '1d 3h 5min', '1y 3d 3h 4min', '1w2d', '1m1w', '3d 13:35', '1d 0:30', '1h 0:30', '2 d', '2 h', '1H', '1D', '1MIN', '1Min', '1 min',
  '1h1h', '1h 1h', '1d1d', '3h 1d', 'h', 'd', '1x', '1 foo', 'abc', '--1', '-1', '-1h', '+1h', '1e3', '1e3h', '1.h', '.5h', '.5', '1..5', '1:30h', '1h 1:30', '1:30 1h', '1:30:15.5', '1:5', '01:05', '001:005',
  '0h', '0d', '0min', '00', '000:000', '999999', '1h-1min', '1h,30min', '1h;30m', '1 h 30 m', '1hr', '1hrs', '1hour', '1hours', '2days', '2day', '1week', '1month', '1year', '1y1m1w1d1h1min',
  '5 minutes', '5 mins', '5m', '2s', '30s', '1h30s', '1.5d', '0.25w', '1.5y', '12:34:56', '12:34:56:78', '1/2h', '½h', '１h', '1h\n', '\t1h', '1h\t30min',
];

/** Diary sexp expressions, each judged by Emacs on every day of 2026-2029 (date bound to (month day year), entry to "ENTRY"). */
export function sexpExpressions() {
  const out = [];
  const months = ['t', '1', '2', '11', "'(1 4 7 10)", "'(2 3)", '13', '0'];
  for (const m of months) for (const dow of [0, 3, 6]) for (const n of [1, 2, 4, 5, -1, -2]) out.push(`(diary-float ${m} ${dow} ${n})`);
  for (const [m, dow, n, day, year] of [[3, 0, 2, 'nil', 'nil'], [3, 0, 2, 8, 'nil'], [3, 0, -1, 25, 'nil'], [2, 1, 1, 'nil', 2027], [2, 1, 1, 15, 2027], ['t', 5, 1, 13, 'nil'], ['t', 2, -1, 'nil', 'nil'], [1, 4, 3, 1, 2028], [12, 6, 1, -1, 'nil'], [6, 0, 3, 0, 'nil'], [6, 7, 1, 'nil', 'nil'], [6, -1, 1, 'nil', 'nil']]) out.push(`(diary-float ${m} ${dow} ${n} ${day} ${year})`);
  for (const a of ['3 1 2026 3 9 2026', '12 30 2026 1 3 2027', '1 5 2027 1 5 2027', '3 9 2026 3 1 2026', '2 28 2028 3 1 2028', '2 29 2027 3 1 2027', '13 1 2026 1 5 2027', '1 1 2026 12 31 2029', '1 1 2025 1 1 2026']) out.push(`(diary-block ${a})`);
  for (const a of ['2026 3 1 2026 3 9', '2026 12 30 2027 1 3', '2027 1 5 2027 1 5', '2026 3 9 2026 3 1']) out.push(`(org-block ${a})`);
  for (const a of ['1 2026 1 1', '2 2026 1 1', '3 2026 1 1', '7 2026 1 1', '14 2026 2 14', '30 2025 12 25', '365 2026 6 1', '1 2026 3 1', '10 2030 1 1', '5 2024 2 29', '0 2026 1 1', '-3 2026 1 1']) { out.push(`(diary-cyclic ${a.replace(/^(\S+) (\S+) (\S+) (\S+)$/, '$1 $3 $4 $2')})`); out.push(`(org-cyclic ${a})`); }
  for (const a of ['10 31 t', 't 15 t', '1 t 2026', 't t 2027', '2 29 t', "'(1 7) 4 t", "10 31 '(2026 2028)", "'(1 2) '(5 6) 2026", '12 25 2026', '2 30 t', '13 1 t', '0 5 t', 't 0 t']) out.push(`(diary-date ${a})`);
  for (const a of ['10 31 1948', '2 29 2000', '1 1 2026', '1 1 2027', '12 31 2025', '3 1 2026', '10 31 1948 "*"', '10 31 1948 nil', '2 29 1900', '6 12 2001']) out.push(`(diary-anniversary ${a})`);
  for (const a of ['2001 6 12', '2000 2 29', '2026 1 1', '2027 1 1', '2025 12 31', '1900 2 29']) out.push(`(org-anniversary ${a})`);
  for (const a of ['2026 1 1', '2026 6 1', '2026 6 1 nil', '2026 12 31']) out.push(`(org-date ${a})`);
  for (const f of ['diary-day-of-year', 'diary-iso-date', 'diary-julian-date', 'diary-astro-day-number', 'diary-islamic-date', 'diary-hebrew-date', 'diary-bahai-date', 'diary-chinese-date']) out.push(`(${f})`);
  for (const a of ["'(diary-date 3 14 t) 1", "'(diary-float 5 1 -1) -2", "'(diary-float t 1 1) 7", "'(diary-date 12 25 t) '(1 2 3)", "'(diary-date 1 1 t) 3", "'(diary-date 7 4 t) -1", "'(diary-date 2 28 t) 1"]) { out.push(`(diary-remind ${a})`); out.push(`(diary-offset ${a.replace(/^('\(.*\)) (.*)$/, '$1 $2')})`); }
  for (const e of ['(+ 1 2)', '(calendar-extract-year date)', '(calendar-day-name date)', '(calendar-month-name (car date))', '(calendar-day-name date t)', '(calendar-month-name (car date) t)', '(calendar-day-number date)', '(calendar-last-day-of-month 2 (nth 2 date))', '(calendar-leap-year-p (nth 2 date))', '(= 1 (calendar-day-of-week (list 3 1 (nth 2 date))))', '(calendar-date-equal date (list 3 1 2027))', '(calendar-date-is-valid-p date)', '(calendar-date-is-valid-p (list 2 29 (nth 2 date)))', '(calendar-dayname-on-or-before 1 (calendar-absolute-from-gregorian date))', '(= (calendar-dayname-on-or-before 1 (calendar-absolute-from-gregorian date)) (calendar-absolute-from-gregorian date))', '(calendar-hebrew-leap-year-p (nth 2 (calendar-hebrew-from-absolute (calendar-absolute-from-gregorian date))))', '(equal (calendar-islamic-from-absolute (calendar-absolute-from-gregorian date)) (list 9 1 (nth 2 (calendar-islamic-from-absolute (calendar-absolute-from-gregorian date)))))', '(= 1 (nth 1 (calendar-hebrew-from-absolute (calendar-absolute-from-gregorian date))))', '(= 1 (nth 1 (calendar-julian-from-absolute (calendar-absolute-from-gregorian date))))']) out.push(e);
  return out;
}

/** Timestamp strings whose digits, words or punctuation are odd; Emacs (org-element) says whether and how each reads. */
export function oddTimestamps() {
  const out = new Set();
  const dates = ['2026-02-30', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '0000-01-01', '0001-01-01', '9999-12-31', '2026-1-5', '2026-01-5', '2026-1-05', '26-10-11', '12026-10-11', '2026/10/11', '2026-10-11', '2024-02-29', '2023-02-29', '2100-02-29', '１２３４-10-11', '2026-10-11x'];
  const times = ['', ' 24:00', ' 25:00', ' 99:99', ' 10:60', ' 10:99', ' 0:00', ' 00:00', ' 1:5', ' 1:05', ' 001:05', ' 10:00:30', ' 10.00', ' 10h00', ' 10:00am', ' 10:00 PM', ' 10:00-', ' 10:00-11', ' 10:00-11:00', ' 10:00-09:00', ' 10:00-10:00', ' 23:59-24:00', ' 10:00--11:00', ' 10:00 - 11:00', ' 10:00-11:00-12:00'];
  for (const d of dates) for (const t of times) out.add(`<${d}${t}>`);
  const weekdays = [' Mon', ' mon', ' MON', ' Monday', ' Mo.', ' 日', ' lun.', ' sáb', ' M-F', ' Mon Tue', ' x', ' _', ' ?', ' Mon,'];
  for (const w of weekdays) for (const t of ['', ' 10:00']) { out.add(`<2026-10-12${w}${t}>`); out.add(`[2026-10-12${w}${t}]`); }
  const reps = [' +1d', ' ++1d', ' .+1d', ' +0d', ' +00d', ' +1000d', ' +1D', ' +1x', ' +1', ' +d', ' + 1d', ' +1d/3d', ' +1d/', ' +1d/3', ' +1d/3x', ' .+2d/4d', ' ++1w/2w', ' +1h', ' +1y', ' +1m', ' +1w', ' +1 d', ' +1.5d', ' +-1d', ' ++', ' .+', ' -1d', ' --1d', ' -0d', ' -1', ' -d', ' -1D', ' - 1d', ' -1d/3d', ' +1d -1d', ' -1d +1d', ' +1d +1d', ' -1d -1d', ' +1d --1d', ' ++1d -2w', ' .+1d --3d', ' +1d x', ' x +1d'];
  for (const r of reps) for (const base of ['<2026-10-12 Mon', '<2026-10-12 Mon 10:00', '[2026-10-12 Mon']) out.add(`${base}${r}${base.startsWith('<') ? '>' : ']'}`);
  for (const s of ['<2026-10-12 Mon +1d 10:00>', '<2026-10-12 +1d Mon>', '<2026-10-12 10:00 Mon>', '<2026-10-12 -1d 10:00 Mon>', '<2026-10-12 Mon 10:00 +1d -1d>',
    '<2026-10-12>', '<2026-10-12 >', '< 2026-10-12>', '<2026-10-12\tMon>', '<2026-10-12  Mon  10:00>', '<2026-10-12 Mon>', '<2026-10-12 Mon\n>', '<2026-10-12 Mon', '2026-10-12 Mon>', '<2026-10-12 Mon]', '[2026-10-12 Mon>', '<<2026-10-12 Mon>>', '[[2026-10-12 Mon]]', '<2026-10-12 Mon><2026-10-13 Tue>', '<2026-10-12 Mon>--<2026-10-13 Tue>', '[2026-10-12 Mon]--[2026-10-13 Tue]', '<2026-10-12 Mon>--[2026-10-13 Tue]', '<2026-10-12 Mon>-<2026-10-13 Tue>', '<2026-10-12 Mon>---<2026-10-13 Tue>', '<2026-10-12 Mon> -- <2026-10-13 Tue>', '<2026-10-13 Tue>--<2026-10-12 Mon>', '<2026-10-12 Mon 10:00>--<2026-10-12 Mon 12:00>', '<%%(diary-float t 1 1)>', '<%%(org-anniversary 2000 1 1) text>', '<2026-10-12 Mon>text', 'text<2026-10-12 Mon>', ' <2026-10-12 Mon>', '<2026-10-12 Mon> ', '<>', '[]', '<2026>', '<2026-10>', '<2026-10-12 Mon 10>', '<10:00>', '<now>', '<today>', '<+1d>', '<2026-10-12 Mon CLOSED>']) out.add(s);
  return [...out];
}
