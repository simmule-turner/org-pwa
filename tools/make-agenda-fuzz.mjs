#!/usr/bin/env node
/**
 * Writes test/fixtures/agenda/f1.org: a seeded random mix of timestamps, SCHEDULED and DEADLINE lines with every kind of
 * repeater, warning and delay, date ranges and times, for tools/gen-agenda-oracle.mjs f1 to ask Emacs about.
 *
 *   node tools/make-agenda-fuzz.mjs [seed] [count]
 */
import fs from 'node:fs';

let state = Number(process.argv[2] || 7) >>> 0;
const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const count = Number(process.argv[3] || 220);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const today = Date.UTC(2026, 9, 11);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const day = (ms) => DAYS[new Date(ms).getUTCDay()];
const date = () => {
  // mostly near today, some at month ends and leap days, which repeaters treat in their own way
  const r = rnd();
  if (r < 0.1) return Date.UTC(pick([2024, 2025, 2026]), pick([0, 1, 2, 4, 9, 11]), pick([28, 29, 30, 31]));
  if (r < 0.15) return Date.UTC(2024, 1, 29);
  return today + int(-45, 70) * 86400000;
};
const repeater = () => pick(['', '', '', '+1d', '+2d', '+3d', '+1w', '+2w', '+1m', '+2m', '+1y', '++1d', '++3d', '++1w', '++2w', '++1m', '++1y', '.+1d', '.+2d', '.+1w', '.+1m', '.+1y', '+6h', '++12h', '.+4h', '+1d/3d', '+1w/2w', '++1d/2d']);
const warn = () => pick(['', '', '', '', '-1d', '-3d', '-7d', '-14d', '-30d', '-1w', '-2w', '-1m', '-0d']);
const delay = () => pick(['', '', '', '', '', '--1d', '--3d', '--7d', '--1w', '--1m']);
const time = () => pick(['', '', '', ' 09:00', ' 14:30', ' 23:30', ' 00:15', ' 08:00-09:30', ' 22:00-23:59']);
const stamp = (kind, ms = date()) => {
  const rep = repeater();
  const w = warn(), d = delay();
  const tail = [rep, kind === 'SCHEDULED' ? d : w].filter(Boolean).join(' ');
  return `<${iso(ms)} ${day(ms)}${time()}${tail ? ' ' + tail : ''}>`;
};
const out = [];
for (let i = 0; i < count; i++) {
  const todo = pick(['', '', 'TODO ', 'TODO ', 'NEXT ', 'DONE ', 'DONE ']);
  const title = `h${i}`;
  const lines = [`* ${todo}${title}`];
  const kind = pick(['sched', 'dead', 'both', 'plain', 'range', 'body', 'inactive', 'plain']);
  if (kind === 'sched') lines.push(`SCHEDULED: ${stamp('SCHEDULED')}`);
  else if (kind === 'dead') lines.push(`DEADLINE: ${stamp('DEADLINE')}`);
  else if (kind === 'both') lines.push(`DEADLINE: ${stamp('DEADLINE')} SCHEDULED: ${stamp('SCHEDULED')}`);
  else if (kind === 'plain') lines.push(`${stamp('')}`);
  else if (kind === 'range') {
    const a = date();
    lines.push(`<${iso(a)} ${day(a)}>--<${iso(a + int(1, 9) * 86400000)} ${day(a + 1)}>`.replace(/(<[^>]*>)--<(\d{4}-\d\d-\d\d) \w+>/, (m, x, d2) => `${x}--<${d2} ${day(Date.parse(d2 + 'T00:00:00Z'))}>`));
  } else if (kind === 'body') lines.push(`Some text ${stamp('')} more`);
  else lines.push(`[${iso(date())}]`);
  out.push(lines.join('\n'));
}
fs.writeFileSync(new URL('../test/fixtures/agenda/f1.org', import.meta.url), out.join('\n') + '\n');
console.log(`${count} headings`);
