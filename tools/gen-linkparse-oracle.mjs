#!/usr/bin/env node
/**
 * Writes test/fixtures/linkparse-oracle.json: the links Emacs (org-element) finds in a line of text, each with its type,
 * path, raw link, format (plain, angle or bracket) and description.
 *   node tools/gen-linkparse-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lines = [
  'a [[https://x.org][desc]] b', '[[https://x.org]]', '[[file:a.org::*h][t]]', '[[file:a.org::12]]', '[[file:~/a.org]]', '[[./rel.png]]', '[[~/x.org]]', '[[/abs/path.org]]',
  '[[*heading]]', '[[#custom]]', '[[id:abc-123][y]]', '[[id:abc-123]]', '[[fuzzy words]]', '[[(coderef)]]', '[[attachment:f.png]]', '[[a\\]b]]', '[[a\\\\]]', '[[x][y\\]z]]',
  '[[https://x.org/a b]]', '[[https://x.org/path?a=1&b=2#frag][q]]', '[[mailto:a@b.c][mail]]', '[[shell:ls][run]]', '[[elisp:(foo)][e]]', '[[doi:10.1/x][d]]',
  'see https://example.org/path_(x), ok', 'plain https://example.org. end', 'https://example.org/a_(b)_c done', 'text https://example.org/a;b?c=d! more',
  '<https://x.org> and mailto:a@b.c', '<file:a.org> next', 'mailto:someone@example.org, then', 'https://x.org/a,b. https://y.org)', '(https://x.org)', '"https://x.org"',
  'file:foo.org and file:bar.org::*h', 'ftp://host/file.txt.', 'http://a.b/c-d_e~f', 'https://example.org/#sec-1.2,', 'news:comp.emacs end', 'id:abc-123 plain', 'doi:10.1/x plain',
  '[[https://x.org][desc with *bold* and [[nested]]]]', '[[https://x.org][]]', '[[ spaced ]]', '[[https://x.org][desc]][[https://y.org]]', 'adjacent[[https://x.org]]text',
  'tel:+1234 and  xmpp:me@x.org', '[[  https://x.org  ][d]]', '[[file:a b.org][sp]]', '[[https://x.org][desc ]] after', '[fn:1] not link [[https://x.org]]',
  '[[https://example.org/a%20b][pct]]', '[[https://example.org/(paren)][p]]', 'a [[x]] [[y]] [[z]]', '[[file:a.org::/re/][r]]', '[[file:a.org::(ref)][c]]',
];
const cases = lines.map((l) => ({ line: l }));
const el = `
(require 'org) (require 'org-element) (require 'org-attach) (require 'json)
(defun run-case (line)
  (with-temp-buffer
    (insert line "\\n") (org-mode) (goto-char (point-min))
    (let ((tree (org-element-parse-buffer)) (out nil))
      (org-element-map tree 'link
        (lambda (l)
          (push (list (cons 'type (org-element-property :type l))
                      (cons 'path (org-element-property :path l))
                      (cons 'raw (org-element-property :raw-link l))
                      (cons 'format (symbol-name (org-element-property :format l)))
                      (cons 'begin (- (org-element-property :begin l) 1))
                      (cons 'end (- (org-element-property :end l) 1))
                      (cons 'desc (and (org-element-property :contents-begin l)
                                       (buffer-substring-no-properties (org-element-property :contents-begin l) (org-element-property :contents-end l)))))
                out)))
      (vconcat (nreverse out)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'line c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/linkparse-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases');
