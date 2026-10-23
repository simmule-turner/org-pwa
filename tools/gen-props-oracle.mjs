#!/usr/bin/env node
/**
 * Writes test/fixtures/props-oracle.json: the text Emacs leaves after setting a heading's tags (org-set-tags) and after
 * setting or deleting a property (org-entry-put, org-entry-delete), for headings with and without planning, a property
 * drawer, a logbook, a body and children.
 *   node tools/gen-props-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headings = {
  plain: '* H\n',
  body: '* H\nbody text\n',
  planning: '* H\nSCHEDULED: <2026-10-11 Sun>\nbody\n',
  drawer: '* H\n:PROPERTIES:\n:A: 1\n:B: 2\n:END:\nbody\n',
  drawerOne: '* H\n:PROPERTIES:\n:A: 1\n:END:\nbody\n',
  drawerPadded: '* H\n:PROPERTIES:\n:ID:       abc\n:CUSTOM_ID: x\n:END:\n',
  logbook: '* H\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 10:00] \\\\\n  hi\n:END:\nbody\n',
  planningLogbook: '* H\nSCHEDULED: <2026-10-11 Sun>\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 10:00] \\\\\n  hi\n:END:\n',
  child: '* H\n** C\ntext\n',
  tagged: '* H :a:b:\nbody\n',
  todo: '* TODO [#A] Title with words :work:\nbody\n',
  long: '* A rather long heading title that goes close to the tags column of the buffer\n',
  nested: '** Level two\nbody\n',
  inheritedFrom: '* P :p:\n** H :c:\n',
};
const tagSets = [['x'], ['x', 'y'], ['b', 'a'], [], ['work', 'home', 'urgent']];
const propOps = [
  ['put', 'KEY', 'val'], ['put', 'key', 'val'], ['put', 'A', 'new'], ['put', 'a', 'new'], ['put', 'KEY', ''],
  ['put', 'ID', 'abc-123'], ['put', 'A+', 'more'], ['put', 'LONGERPROPERTYNAME', 'v'], ['put', 'KEY', 'two words'],
  ['delete', 'A'], ['delete', 'B'], ['delete', 'NOPE'], ['delete', 'ID'],
];
const cases = [];
for (const [name, org] of Object.entries(headings)) {
  for (const tags of tagSets) cases.push({ heading: name, org, op: 'tags', args: tags });
  for (const [op, ...args] of propOps) cases.push({ heading: name, org, op, args });
}
const el = `
(require 'org) (require 'json)
(defun run-case (org op args)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (cond ((string= op "tags") (org-set-tags args))
            ((string= op "put") (org-entry-put (point) (car args) (cadr args)))
            ((string= op "delete") (org-entry-delete (point) (car args))))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'org c)) (cdr (assq 'op c)) (cdr (assq 'args c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/props-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases,', res.filter((x) => x.startsWith('ERROR')).length, 'errors');
