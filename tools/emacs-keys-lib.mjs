// @ts-check
/**
 * Shared by tools/gen-emacs-keys-oracle.mjs and tools/fuzz-emacs-keys.mjs: runs key sequences in Emacs 29.3 (execute-kbd-macro in an Org buffer)
 * and runs the same keys through the app's own key reader and command runner.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { feedKey, newKeyInput } from '../src/emacs-keymap.js';
import { foldedExecute } from '../src/emacs-fold.js';
import { answerDisabled } from '../src/emacs-edit.js';

const EL = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(transient-mark-mode 1)
(setq line-move-visual nil)
(defvar orig-dcf disabled-command-function)
(defun run-case (c)
  (setq disabled-command-function orig-dcf) (put 'upcase-region 'disabled t) (put 'downcase-region 'disabled t)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (mark (cdr (assq 'mark c)))
        (keys (cdr (assq 'keys c))) (ring (cdr (assq 'kill c))) (err nil))
    (with-temp-buffer
      (switch-to-buffer (current-buffer))
      (insert text)
      (org-mode)
      (buffer-enable-undo)
      (setq buffer-undo-list nil)
      (setq kill-ring (copy-sequence ring) kill-ring-yank-pointer kill-ring)
      (goto-char (1+ pos))
      (when mark (set-mark (1+ mark)) (activate-mark))
      (setq last-command nil this-command nil)
      (with-current-buffer (get-buffer-create "*Messages*") (let ((inhibit-read-only t)) (erase-buffer)))
      (setq command-error-function (lambda (data _ctx _caller) (unless err (setq err (error-message-string data)))))
      (let ((inhibit-message t) (message-log-max 1000))
        (condition-case e (execute-kbd-macro (kbd keys)) (quit (unless err (setq err "Quit"))) (error (unless err (setq err (error-message-string e))))))
      (let ((msg (with-current-buffer "*Messages*" (car (last (split-string (string-trim (buffer-string)) "\\n" t))))))
        (list (cons 'text (buffer-string)) (cons 'pos (1- (point)))
              (cons 'mark (if (mark t) (1- (mark t)) :null))
              (cons 'kill (vconcat kill-ring)) (cons 'error (or err :null))
              (cons 'message (if err "" (or msg ""))) (cons 'active (if mark-active "t" "nil")))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;

/** @typedef {{ text: string, pos: number, mark?: number, keys: string, kill: string[] }} KeyCase */
/** @typedef {{ text: string, pos: number, mark: number | 'null', kill: string[], error: string, message: string, active: string }} EmacsResult */

/** Runs the cases in one Emacs and returns what it did for each (positions as UTF-16 offsets, as the app counts). A batch that does not finish
 * (a key that waits for input) is split until the case that hangs is found; its result has `hang: true`.
 * @param {KeyCase[]} cases @returns {(EmacsResult & { hang?: boolean })[]} */
export function runEmacs(cases) {
  const timeout = 4000 + cases.length * 15; // a case takes about 5 ms; one that waits for input never ends
  const done = tryEmacs(cases, timeout);
  if (done) return done;
  if (cases.length > 1 && process.env.FUZZ_VERBOSE) console.error(`  splitting ${cases.length} cases (one waits for input)`);
  if (cases.length === 1) return [{ text: cases[0].text, pos: cases[0].pos, mark: 'null', kill: [], error: 'HANG', message: '', active: 'nil', hang: true }];
  const half = Math.ceil(cases.length / 2);
  return [...runEmacs(cases.slice(0, half)), ...runEmacs(cases.slice(half))];
}

/** @param {KeyCase[]} cases @param {number} timeout @returns {EmacsResult[] | null} null when Emacs did not finish in time */
export function tryEmacs(cases, timeout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-keys-'));
  const elFile = path.join(dir, 'run.el');
  fs.writeFileSync(elFile, EL);
  const chars = (/** @type {string} */ text, /** @type {number} */ at) => [...text.slice(0, at)].length;
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases.map((c) => ({ ...c, pos: chars(c.text, c.pos), ...(c.mark === undefined ? {} : { mark: chars(c.text, c.mark) }) }))));
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { input: '', timeout, killSignal: 'SIGKILL', env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (/** @type {any} */ (r.error)?.code === 'ETIMEDOUT') {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  if (!fs.existsSync(path.join(dir, 'out.json'))) { // Emacs quit while a key waited for input (end of stdin)
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  if (r.status !== 0) throw new Error(`emacs failed: ${r.stderr || r.error}`);
  const units = (/** @type {string} */ text, /** @type {number} */ at) => [...text].slice(0, at).join('').length;
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')).map((/** @type {any} */ x) => ({ ...x, pos: units(x.text, x.pos), mark: x.mark === 'null' ? x.mark : units(x.text, x.mark) }));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

/** Types the keys of a case as the editor does: the key reader, then the command. Stops at the first error, as a keyboard macro does.
 * @param {KeyCase} c @returns {any} */
export function typeKeys(c) {
  /** @type {any} */
  let s = { text: c.text, pos: c.pos, mark: c.mark ?? null, active: c.mark !== undefined, kill: [...c.kill], last: undefined, goal: null };
  let input = newKeyInput();
  // "C-u 12 C-f" types 1 and 2; "M-12" is M-1 and 2
  const tokens = c.keys.split(' ').filter((/** @type {string} */ t) => t !== '').flatMap((/** @type {string} */ t) => {
    const m = /^((?:[CM]-)+)?([0-9]{2,})$/.exec(t);
    return m ? [`${m[1] ?? ''}${m[2][0]}`, ...m[2].slice(1)] : [t];
  });
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i] === 'SPC' ? ' ' : tokens[i];
    if (s.asking) { // a disabled command waits for y, SPC, ! or n
      s = answerDisabled(s, key) ?? s;
      if (s.error) return s;
      continue;
    }
    const fed = feedKey(input, key);
    input = fed.input;
    const r = fed.result;
    if (r.type === 'pending') continue;
    if (r.type === 'run') {
      s = foldedExecute(s, [], r.command, r.char, r.prefix);
      if (s.error) return s;
      if (r.again) tokens.splice(i + 1, 0, r.again); // the key that ended a character code is typed as itself
      continue;
    }
    return { ...s, error: r.type === 'error' ? r.message : `${key} is undefined` };
  }
  return s;
}

/** Whether what the app did is what Emacs did: the text, caret, mark, kill ring and whether there was an error. The echo area is not compared
 * (Emacs prints nothing for Mark set and the like while a keyboard macro runs).
 * @param {any} got @param {EmacsResult} e */
export const sameAsEmacs = (got, e) => got.text === e.text && got.pos === e.pos && (got.mark ?? 'null') === e.mark
  && JSON.stringify(got.kill) === JSON.stringify(e.kill) && Boolean(got.error) === (e.error !== 'null');
