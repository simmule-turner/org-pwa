#!/usr/bin/env node
/**
 * Writes test/fixtures/format-time-oracle.json: what real Emacs's format-time-string (time zone America/New_York, and UTC)
 * makes of a long list of formats at several instants.  test/format-time.test.js holds src/format-time.js to it.
 *
 *   node tools/gen-format-time-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const specs = 'aAbBcCdDeFgGhHIjklmMnNpPrRsStTuUVwWxXyYzZ%QqEfJL'.split('');
const formats = new Set();
for (const s of specs) {
  formats.add(`%${s}`);
  for (const flag of ['-', '_', '0', '^', '#']) formats.add(`%${flag}${s}`);
  for (const w of ['1', '3', '12']) {
    formats.add(`%${w}${s}`);
    formats.add(`%_${w}${s}`);
    formats.add(`%-${w}${s}`);
  }
}
for (const f of ['%3N', '%6N', '%12N', '%:z', '%::z', '%:::z', '%Ey', '%Od', '%EY', '%-d/%-m/%y', '%Y-%m-%dT%H:%M:%S%z', '%A, %B %e', '100%', '%', '%5', '%-', '%^a %^b', '%#Z', '%_H', '%-H', '%10F', '%^c', 'plain', '', '%a%a', '%x %X', '%_5z', '%-z', '%:::-z']) formats.add(f);

// instants as [sec, min, hour, day, month, year, milliseconds] in New York: DST on and off, midnight, noon, year ends, ISO-week edges, a leap day
process.env.TZ = 'America/New_York';
const instants = [
  [7, 30, 14, 5, 3, 2025, 0], [0, 0, 0, 1, 1, 2026, 0], [59, 59, 23, 31, 12, 2024, 999], [0, 5, 12, 15, 7, 2026, 123], [30, 15, 9, 29, 2, 2024, 50],
  [1, 2, 3, 1, 1, 2021, 7], [0, 0, 1, 31, 12, 2018, 500], [45, 45, 21, 4, 11, 2024, 0], [0, 0, 13, 3, 1, 2027, 100],
].map(([s, mi, h, d, mo, y, ms]) => [s, mi, h, d, mo, y, ms, new Date(y, mo - 1, d, h, mi, s, ms).getTime()]);
const list = [...formats];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-oracle-'));
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ formats: list, instants }));
const lisp = `(progn (require 'json) (setenv "TZ" "America/New_York")
 (let* ((in (json-parse-string (with-temp-buffer (insert-file-contents "${dir}/in.json") (buffer-string)) :object-type 'alist))
        (formats (append (alist-get 'formats in) nil)) (instants (append (alist-get 'instants in) nil)) (out nil))
  (dolist (i instants)
    (let* ((v (append i nil)) (time (cons (* (nth 7 v) 1000000) 1000000000)))
      (dolist (f formats)
        (push (vector (format-time-string f time) (format-time-string f time t)) out))))
  (with-temp-file "${dir}/out.json" (insert (json-encode (vconcat (nreverse out)))))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'inherit' });
const flat = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const results = instants.map((_, k) => flat.slice(k * list.length, (k + 1) * list.length));
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'format-time-oracle.json'), JSON.stringify({ zone: 'America/New_York', formats: list, instants, results }) + '\n');
console.log(`${list.length} formats x ${instants.length} instants`);
