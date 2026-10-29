#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-tables.json: what Emacs's org-table-recalculate-buffer-tables does to every table of
 * tools/oracle-tables-cases.mjs (a Lisp error is kept as "ERROR message"). test/oracle-tables.test.js holds the app to it.
 *   node tools/gen-oracle-tables.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './oracle-tables-cases.mjs';

const el = `
(require 'org) (require 'json)
(setq org-table-formula-use-constants t)
(defun run-case (org)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t) (message-log-max nil))
      (condition-case e (progn (org-table-recalculate-buffer-tables) (buffer-string))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otables-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
/** Runs a list of cases in one Emacs; null when it does not finish in `limit` ms (a Calc call that never returns). */
function runBatch(cases, limit) {
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
  fs.rmSync(path.join(dir, 'out.json'), { force: true });
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: limit, killSignal: 'SIGKILL' });
  if (r.status !== 0) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
}
const out = [];
for (let i = 0; i < CASES.length; i += 40) {
  const chunk = CASES.slice(i, i + 40);
  const res = runBatch(chunk, 60000);
  if (res) out.push(...res);
  else for (const c of chunk) out.push((runBatch([c], 15000) || ['ERROR TIMEOUT'])[0]);
  process.stdout.write(`${Math.min(i + 40, CASES.length)}/${CASES.length}\r`);
}
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-tables.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((org, i) => ({ org, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}, ${out.filter((x) => x.startsWith('ERROR')).length} errors`);
