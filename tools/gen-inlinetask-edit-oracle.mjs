#!/usr/bin/env node
/**
 * Writes test/fixtures/inlinetask-edit-oracle.json: what org-inlinetask-promote, -demote and -insert-task do in Emacs 29.3 (Org 9.6.15), for a
 * minimum level of 3, with org-adapt-indentation nil and t. Promote and demote run on each heading line of a text of tasks; insert-task runs
 * at the end of the text of each heading, with and without a default state.
 *   node tools/gen-inlinetask-edit-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN = 3;
const SHIFT_TEXTS = [
  '* A\n*** T\n*** END\n* B\n',
  '* A\n*** T TODO\nbody\n  more\n*** END\n** C\n',
  '*** T\n*** END\n*** U\n*** END\n',
  '* A\n*** T\n:PROPERTIES:\n:ID: 1\n:END:\ntext\n  indented\n*** END\nafter\n',
  '* A\n**** Deep\nbody\n**** END\n',
  '* A\n*** Lone\nbody\n* B\n',
  '* A\n*** Lone\n*** Next\n*** END\n',
  '* A\n*** T\nSCHEDULED: <2024-01-01 Mon>\n  text\n*** end  \n',
  '*** T\n*** T2\n*** END\n',
  '*** END\n*** T\n*** END\n',
  '* A\n*** T\n*** END',
  '* A\n*** Lone',
];
const INSERT_TEXTS = ['* H\nbody\n', '* H\nbody\n** C\n', '* H\n*** T\nx\n*** END\nafter\n', '*** T\nbody\n*** END\n', '* H\n*** Lone\n', '* A\n*** END\n', '* A\n*** T\n*** END\n*** U\n*** END\n* B\n', '* H', '* H\n:PROPERTIES:\n:ID: 1\n:END:\ntext\n** C\n'];
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-inlinetask) (require 'json)
(defun shift-at (text line fn adapt)
  (with-temp-buffer
    (org-mode) (insert text)
    (let ((org-inlinetask-min-level ${MIN}) (org-adapt-indentation adapt) (org-odd-levels-only nil))
      (goto-char (point-min)) (forward-line line)
      (condition-case err (progn (funcall fn) (buffer-string)) (error (concat "ERROR " (error-message-string err)))))))
(defun insert-at (text line state nostate)
  (with-temp-buffer
    (org-mode) (insert text)
    (let ((org-inlinetask-min-level ${MIN}) (org-odd-levels-only nil) (org-inlinetask-default-state state))
      (goto-char (point-min)) (forward-line line)
      ;; the end of the heading's own text: the start of the next heading line, or the end of the buffer
      (end-of-line)
      (if (re-search-forward "^\\\\*+ " nil t) (beginning-of-line) (goto-char (point-max)))
      (condition-case err (progn (org-inlinetask-insert-task nostate) (buffer-string)) (error (concat "ERROR " (error-message-string err)))))))
(let (shifts inserts)
  ${SHIFT_TEXTS.flatMap((t, ti) => [false, true].flatMap((adapt) => ['org-inlinetask-promote', 'org-inlinetask-demote'].map((fn) => `(push (list ${ti} ${q(fn)} ${adapt ? 't' : 'nil'} (let (r) (dotimes (i ${t.split('\n').length}) (push (shift-at ${q(t)} i '${fn} ${adapt ? 't' : 'nil'}) r)) (nreverse r))) shifts)`))).join('\n  ')}
  ${INSERT_TEXTS.flatMap((t, ti) => [[null, false], ['TODO', false], ['TODO', true]].map(([state, nostate]) => `(push (list ${ti} ${state ? q(state) : 'nil'} ${nostate ? 't' : 'nil'} (let (r) (dotimes (i ${t.split("\n").length}) (push (insert-at ${q(t)} i ${state ? q(state) : 'nil'} ${nostate ? 't' : 'nil'}) r)) (nreverse r))) inserts)`)).join('\n  ')}
  (princ (json-encode (list (cons 'shifts (vconcat (mapcar (lambda (x) (list (nth 0 x) (nth 1 x) (if (nth 2 x) t :json-false) (vconcat (nth 3 x)))) (nreverse shifts))))
                            (cons 'inserts (vconcat (mapcar (lambda (x) (list (nth 0 x) (nth 1 x) (if (nth 2 x) t :json-false) (vconcat (nth 3 x)))) (nreverse inserts))))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-edit-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el); if (process.env.KEEP) console.error(file);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\{.*\}$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
const shifts = out.shifts.map(([ti, fn, adapt, results]) => ({ text: SHIFT_TEXTS[ti], fn, adapt, results }));
const inserts = out.inserts.map(([ti, state, nostate, results]) => ({ text: INSERT_TEXTS[ti], state, noState: nostate, results }));
fs.writeFileSync(new URL('../test/fixtures/inlinetask-edit-oracle.json', import.meta.url), JSON.stringify({ min: MIN, shifts, inserts }) + '\n');
console.log(`${shifts.length} shift groups, ${inserts.length} insert groups`);
