#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-clock-oracle.json: the file Emacs 29.3 leaves after a capture with :clock-in, :clock-keep and :clock-resume,
 * with and without a clock running before (timestamps and durations are normalized by the test, which runs at another time).
 *   node tools/gen-capture-clock-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FLAGS = [[], [':clock-in t'], [':clock-in t :clock-keep t'], [':clock-in t :clock-resume t'], [':clock-in t :clock-keep t :clock-resume t'], [':clock-keep t'], [':clock-resume t']];
const cases = [];
for (const type of ['entry', 'item', 'plain', 'checkitem']) {
  const text = type === 'entry' ? '* TODO hi' : type === 'item' ? '- hi' : type === 'plain' ? 'hi' : '- [ ] hi';
  for (const previous of [false, true]) {
    for (const flags of FLAGS) cases.push({ type, text, previous, flags: flags.join(' '), init: '* Inbox\nbody\n* Work\n' });
  }
}
cases.push({ type: 'entry', text: '* TODO hi', previous: 'Inbox', flags: ':clock-in t :clock-resume t', init: '* Inbox\nbody\n* Work\n' }); // the clock running is on the heading the capture goes under
cases.push({ type: 'entry', text: '* TODO hi', previous: 'Inbox', flags: ':clock-in t :clock-keep t', init: '* Inbox\nbody\n* Work\n' });

const q = (s) => JSON.stringify(s);
const el = (dir) => `
(require 'cl-lib) (require 'org-capture) (require 'org-clock) (require 'json)
(setq org-clock-persist nil)
(defun run-case (n type text previous flags init)
  (let* ((f (expand-file-name (format "c%d.org" n) ${q(dir)}))
         (org-capture-templates (list (append (list "x" "x" (intern type) (list 'file+headline f "Inbox") text) (car (read-from-string (concat "(" flags ")")))))))
    (with-temp-file f (insert init))
    (when previous
      (with-current-buffer (find-file-noselect f)
        (goto-char (point-min)) (re-search-forward (concat "^\\\\* " (if (stringp previous) previous "Work")))
        (org-back-to-heading) (org-clock-in)))
    (org-capture nil "x") (org-capture-finalize)
    (prog1 (with-temp-buffer (insert-file-contents f) (buffer-string))
      (when (org-clocking-p) (org-clock-cancel)))))
(princ (json-encode (vconcat (list ${cases.map((c, i) => `(run-case ${i} ${q(c.type)} ${q(c.text)} ${c.previous === true ? 't' : c.previous ? q(c.previous) : 'nil'} ${q(c.flags)} ${q(c.init)})`).join('\n  ')}))))
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clkor-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el(dir));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/capture-clock-oracle.json', import.meta.url), JSON.stringify({ emacs: spawnSync('emacs', ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0], cases: cases.map((c, i) => ({ ...c, emacs: outs[i] })) }, null, 1) + '\n');
console.log(`${cases.length} cases`);
