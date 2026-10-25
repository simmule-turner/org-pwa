#!/usr/bin/env node
/**
 * Writes test/fixtures/calendar/holidays-{default,all,2000-2060}.txt and holidays-all-2000-2060.txt.gz: what Emacs 29.3's
 * `calendar-holiday-list` gives for the displayed month of every month of a range, the general, Christian, Hebrew, Islamic, Bahá'í and
 * Chinese groups ("all" is with every all-holidays flag on). A line is "YYYY-MM-DD name".
 *
 *   node tools/gen-holidays-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const FLAGS = '(setq calendar-christian-all-holidays-flag t calendar-hebrew-all-holidays-flag t calendar-islamic-all-holidays-flag t calendar-bahai-all-holidays-flag t calendar-chinese-all-holidays-flag t)';

/** @param {string} flags @param {number} from @param {number} to @param {boolean} insideOnly  keep only holidays in the month displayed */
function run(flags, from, to, insideOnly) {
  const lisp = `(progn ${flags} (require 'calendar) (require 'holidays) (defvar displayed-month) (defvar displayed-year)
    (setq calendar-holidays (append holiday-general-holidays holiday-christian-holidays holiday-hebrew-holidays holiday-islamic-holidays holiday-bahai-holidays holiday-oriental-holidays))
    (let ((seen (make-hash-table :test 'equal)))
      (dotimes (i ${(to - from + 1) * 12})
        (let* ((displayed-year (+ ${from} (/ i 12))) (displayed-month (1+ (% i 12))))
          (dolist (h (calendar-holiday-list))
            (let ((d (car h)))
              (when ${insideOnly ? '(and (= (nth 2 d) displayed-year) (= (nth 0 d) displayed-month))' : 't'}
                (puthash (format "%d-%02d-%02d %s" (nth 2 d) (nth 0 d) (nth 1 d) (substring-no-properties (cadr h))) t seen))))))
      (maphash (lambda (k _) (princ k) (princ "\\n")) seen)))`;
  const r = spawnSync('emacs', ['--batch', '-Q', '--eval', lisp], { env: { ...process.env, TZ: 'America/New_York', LC_ALL: 'C.UTF-8' }, encoding: 'utf8', maxBuffer: 1e9 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split('\n').filter((l) => /^\d{4}-/.test(l)).sort().join('\n') + '\n';
}

const dir = 'test/fixtures/calendar/';
fs.writeFileSync(`${dir}holidays-default.txt`, run('', 2024, 2027, false));
fs.writeFileSync(`${dir}holidays-all.txt`, run(FLAGS, 2024, 2027, false));
fs.writeFileSync(`${dir}holidays-2000-2060.txt`, run('', 2000, 2060, true));
fs.writeFileSync(`${dir}holidays-all-2000-2060.txt.gz`, zlib.gzipSync(run(FLAGS, 2000, 2060, true)));
console.log('written');
