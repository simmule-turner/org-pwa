#!/usr/bin/env node
/**
 * Writes test/fixtures/crypt-oracle.json: what org-crypt (Emacs 29.3) does to a buffer. The cipher is replaced by a reversible fake
 * (the "message" holds a counter, the recipient and the text in hex), so the fixture holds exactly the editing: which text is
 * encrypted, where the message goes, what comes back on decrypting, and when a message is reused.
 *   node tools/gen-crypt-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BODY = `#+TITLE: Secrets
* Plain
Nothing here.
* Bank :crypt:
:PROPERTIES:
:ID: abc
:END:
Account: 12345
PIN: 0000

** Child one
Child text
** Child two :crypt:
More child text.
* After
After text
`;
const PLANNED = `* TODO Taxes :crypt:
DEADLINE: <2026-04-15 Wed>
:PROPERTIES:
:Owner: me
:END:
:LOGBOOK:
CLOCK: [2026-04-01 Wed 09:00]--[2026-04-01 Wed 10:00] =>  1:00
:END:

Secret text
  indented secret
* Next
`;
const EMPTYBODY = `* Empty :crypt:
* Only props :crypt:
:PROPERTIES:
:ID: x
:END:
* Last :crypt:
text at the end of the file`;
const KEYED = `* A :crypt:
:PROPERTIES:
:CRYPTKEY: bob
:END:
text a
* B :crypt:
text b
* C :crypt:
:PROPERTIES:
:CRYPTKEY: nil
:END:
text c
* D :crypt:
:PROPERTIES:
:CRYPTKEY: nobody
:END:
text d
`;
const cases = [];
const add = (name, text, ops, options = {}) => cases.push({ name, text, ops, ...options });
add('encrypt a heading with a crypt tag', BODY, [{ do: 'encrypt-entry', line: 3 }]);
add('encrypt entry works without the tag (command on the heading)', BODY, [{ do: 'encrypt-entry', line: 1 }]);
add('encrypt a heading from a line of its body', BODY, [{ do: 'encrypt-entry', line: 7 }]);
add('encrypt entries', BODY, [{ do: 'encrypt-entries' }]);
add('encrypt entries then decrypt entries', BODY, [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }]);
add('encrypt entries twice does nothing the second time', BODY, [{ do: 'encrypt-entries' }, { do: 'encrypt-entries' }]);
add('decrypt then encrypt again reuses the message', BODY, [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }, { do: 'encrypt-entries' }]);
add('a change after decrypting is encrypted anew', BODY, [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }, { do: 'replace', from: 'PIN: 0000', to: 'PIN: 1111' }, { do: 'encrypt-entries' }]);
add('encrypt a heading and decrypt it by hand', BODY, [{ do: 'encrypt-entry', line: 3 }, { do: 'decrypt-entry', line: 3 }]);
add('planning, properties and logbook stay outside', PLANNED, [{ do: 'encrypt-entries' }]);
add('planning, properties and logbook: decrypt', PLANNED, [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }]);
add('empty bodies and the end of the file', EMPTYBODY, [{ do: 'encrypt-entries' }]);
add('empty bodies and the end of the file: decrypt', EMPTYBODY, [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }]);
add('a key from org-crypt-key', BODY, [{ do: 'encrypt-entries' }], { key: 'alice' });
add('a key that matches nothing falls back to symmetric', BODY, [{ do: 'encrypt-entries' }], { key: 'nobody' });
add('no key at all (nil) is symmetric', BODY, [{ do: 'encrypt-entries' }], { key: null });
add('the CRYPTKEY property', KEYED, [{ do: 'encrypt-entries' }], { key: 'alice' });
add('another tag matcher', BODY, [{ do: 'encrypt-entries' }], { matcher: 'crypt|Plain' });
add('blank lines only below the heading', '* A :crypt:\n\n\n* B\n', [{ do: 'encrypt-entries' }]);
add('blank lines before and after the text', '* A :crypt:\n\n\ntext\n\n\n* B\n', [{ do: 'encrypt-entries' }, { do: 'decrypt-entries' }]);
add('a message indented by the list or the heading', '* A\n  -----BEGIN PGP MESSAGE-----\n\n  317c7c68690a\n  -----END PGP MESSAGE-----\n', [{ do: 'decrypt-entry', line: 0 }]);
add('decrypt a heading that is not encrypted', BODY, [{ do: 'decrypt-entry', line: 1 }]);
add('encrypt before the first heading does nothing useful', BODY, [{ do: 'encrypt-entries' }, { do: 'decrypt-entry', line: 0 }]);

const lisp = (s) => JSON.stringify(s);
const script = `
(require 'org)
(require 'org-crypt)
(require 'epg)
(require 'json)
(defvar my-counter 0)
(defun my-hex (s) (mapconcat (lambda (c) (format "%02x" c)) (encode-coding-string s 'utf-8) ""))
(defun my-unhex (h) (decode-coding-string (apply #'unibyte-string (let (r) (dotimes (i (/ (length h) 2)) (push (string-to-number (substring h (* 2 i) (+ 2 (* 2 i))) 16) r)) (nreverse r))) 'utf-8))
(defun my-keys (name) (cond ((string= name "alice") (list "alice")) ((string= name "bob") (list "bob")) ((string= name "carol") (list "carol")) (t nil)))
(cl-letf (((symbol-function 'epg-list-keys) (lambda (_c &optional name &rest _) (my-keys (or name ""))))
          ((symbol-function 'epg-encrypt-string)
           (lambda (_c plain recipients &rest _)
             (setq my-counter (1+ my-counter))
             (format "-----BEGIN PGP MESSAGE-----\\n\\n%s\\n-----END PGP MESSAGE-----\\n"
                     (my-hex (format "%d|%s|%s" my-counter (mapconcat #'identity recipients ",") plain)))))
          ((symbol-function 'epg-decrypt-string)
           (lambda (_c cipher)
             (let* ((m (string-match "\\n\\n\\\\([0-9a-f]+\\\\)\\n-----END" cipher))
                    (s (my-unhex (match-string 1 cipher)))
                    (i (string-match "|" s)) (j (string-match "|" s (1+ i))))
               (encode-coding-string (substring s (1+ j)) 'utf-8)))))
  (let ((out nil))
    (dolist (c (json-parse-string (with-temp-buffer (insert-file-contents (getenv "CASES")) (buffer-string)) :object-type 'alist :array-type 'list))
      (setq my-counter 0)
      (let* ((text (alist-get 'text c)) (ops (alist-get 'ops c))
             (org-crypt-key (if (assq 'key c) (let ((k (alist-get 'key c))) (if (eq k :null) nil k)) ""))
             (org-crypt-tag-matcher (or (alist-get 'matcher c) "crypt"))
             (org-crypt-disable-auto-save nil)
             (result nil))
        (with-temp-buffer
          (org-mode)
          (insert text)
          (setq-local epa-file-encrypt-to (alist-get 'encryptTo c))
          (condition-case err
              (dolist (op ops)
                (let ((kind (alist-get 'do op)))
                  (cond
                   ((string= kind "replace")
                    (goto-char (point-min))
                    (search-forward (alist-get 'from op))
                    (replace-match (alist-get 'to op) t t))
                   ((string= kind "encrypt-entries") (org-encrypt-entries))
                   ((string= kind "decrypt-entries") (org-decrypt-entries))
                   (t (goto-char (point-min)) (forward-line (alist-get 'line op))
                      (if (string= kind "encrypt-entry") (org-encrypt-entry) (org-decrypt-entry))))))
            (error (setq result (concat "ERROR " (error-message-string err)))))
          (push (list (cons 'name (alist-get 'name c)) (cons 'result (or result (buffer-substring-no-properties (point-min) (point-max))))) out))))
    (princ (json-encode (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypt-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases.map((c) => ({ ...c, key: c.key === undefined ? undefined : c.key }))));
fs.writeFileSync(path.join(dir, 'run.el'), script);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, CASES: path.join(dir, 'cases.json') }, encoding: 'utf8', maxBuffer: 1 << 26 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
const results = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
const out = cases.map((c, i) => ({ ...c, expected: results[i].result }));
fs.writeFileSync(path.join(import.meta.dirname, '..', 'test', 'fixtures', 'crypt-oracle.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.length} cases`);
void lisp;
