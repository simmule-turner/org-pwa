#!/usr/bin/env node
/**
 * Writes test/fixtures/format-spec-oracle.json: what Emacs 29.3 `format-spec` gives for a set of formats (flags, widths, precisions,
 * unknown letters, bad strings), for test/format-spec.test.js.
 *   node tools/gen-format-spec-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const spec = { t: 'abcdef', s: '', a: 'Ünï', v: '日本' };
const formats = [
  '', 'plain', '%t', '%%', '100%% of %t', '%t|%s|%a', '%-8t|', '%8t|', '%08t|', '%-08t|', '%<3t', '%>3t', '%.2t', '%<.2t', '%>.2t', '%^t', '%_a', '%^a', '%5.2t|',
  '%10a|', '%-10a|', '%v', '%6v|', '%<3v', '%>3v', '%.3v', '%<.3v', '%<2t%>2t', '% t', '%0-t', '%^_t', '%x', '%tx%y', '%', 'a%', '%1', '%-', '%.t', '%5',
  '%t%%%t', '%%t', '%%%t', '%s|%s', '<p>%t</p>%n', '%<10a|', '%>10a|', '%.0t|', '%0t',
];
const lisp = `(progn (require 'format-spec) (require 'json)
  (let ((spec (list (cons ?t "abcdef") (cons ?s "") (cons ?a (string 220 110 239)) (cons ?v (string 26085 26412)))) (out nil))
    (dolist (f (json-parse-string ${JSON.stringify(JSON.stringify(formats))} :array-type 'list))
      (push (condition-case e (list "ok" (format-spec f spec)) (error (list "error" (error-message-string e)))) out))
    (princ (json-encode (vconcat (mapcar #'vconcat (nreverse out)))))))`;
const r = spawnSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(r.stderr || 'emacs failed');
const results = JSON.parse(r.stdout);
fs.writeFileSync(new URL('../test/fixtures/format-spec-oracle.json', import.meta.url), JSON.stringify({ spec, cases: formats.map((format, i) => ({ format, kind: results[i][0], result: results[i][1] })) }) + '\n');
console.log(`${formats.length} cases`);
