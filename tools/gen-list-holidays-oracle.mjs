#!/usr/bin/env node
/**
 * Writes test/fixtures/list-holidays.json: what Emacs 29.3's `list-holidays` prints for a few year ranges (time zone America/New_York).
 *
 *   node tools/gen-list-holidays-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ALL = '(setq calendar-christian-all-holidays-flag t calendar-hebrew-all-holidays-flag t calendar-islamic-all-holidays-flag t calendar-bahai-all-holidays-flag t calendar-chinese-all-holidays-flag t)';
// [first year, last year, init text evaluated before listing]
// the sun-related holidays of years far from now depend on the system's historic time zone rules, so those ranges leave them out
const NO_SOLAR = ' (setq holiday-solar-holidays nil)';
const ranges = [[2026, 2026, ''], [2025, 2027, ''], [2024, 2024, ''], [1999, 2000, ''], [2031, 2031, ''],
  [2026, 2026, ALL], [2023, 2024, ALL], [1899, 1901, ALL + NO_SOLAR], [1950, 1952, ALL + NO_SOLAR], [1601, 1602, ALL + NO_SOLAR], [2099, 2101, ALL + NO_SOLAR], [1925, 1930, '(setq calendar-chinese-all-holidays-flag t holiday-solar-holidays nil)']];
const out = ranges.map(([a, b, init]) => {
  const r = spawnSync('emacs', ['--batch', '-Q', '--eval', `(progn ${init} (require 'calendar) (require 'holidays) (list-holidays ${a} ${b}) (with-current-buffer "*Holidays*" (princ (buffer-string))))`], { env: { ...process.env, TZ: 'America/New_York', LC_ALL: 'C.UTF-8' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return { from: a, to: b, init, text: r.stdout.split('\n').filter((l) => l && !l.startsWith('Computing')).join('\n') + '\n' };
});
fs.writeFileSync('test/fixtures/list-holidays.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.map((o) => `${o.from}-${o.to}: ${o.text.split('\n').length - 1} lines`).join('\n'));
