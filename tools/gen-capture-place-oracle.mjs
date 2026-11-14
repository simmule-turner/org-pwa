#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-place-oracle.json: the file Emacs's org-capture leaves after filing an already-expanded template
 * (entry, item, table-line, plain) at an existing heading or at the top of a file, with :prepend, :empty-lines* and :table-line-pos.
 *   node tools/gen-capture-place-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TR = ['Tr'];
const cases = [];
const add = (init, type, template, olp, opts = {}) => cases.push({ init, type, template, olp, opts });
const EL = [{}, { emptyLines: 1 }, { emptyLines: 2 }, { emptyLinesBefore: 2 }, { emptyLinesAfter: 1 }, { emptyLinesBefore: 1, emptyLinesAfter: 0 }];
const withP = (o) => [o, { ...o, prepend: true }];

for (const base of EL) for (const o of withP(base)) {
  add('* Tr\n** A\n** B\n', 'entry', '* New', TR, o);
  add('* Tr\nbody\n\n** A\nabody\n\n** B\nbbody\n\n* Z\n', 'entry', '* New\nnbody', TR, o);
  add('* Tr\n', 'entry', '* New', TR, o);
  add('a\n\n* Z\n\n* Y\n', 'entry', '* New', [], o);
  add('* Tr\n', 'plain', 'text', TR, o);
  add('* Tr\nbody\n\n** A\n', 'plain', 'text', TR, o);
  add('* Tr\nbody\n\n* Z\n', 'plain', 'text', TR, o);
  add('* Tr\n:PROPERTIES:\n:ID: x\n:END:\nbody\n** A\n', 'plain', 'text', TR, o);
  add('* Tr\n', 'plain', '* X\nbody', TR, o); // plain text is put in as written, headings and all: Emacs does not shift their levels
  add('* Tr\nbody\n\n** A\nabody\n\n* Z\n', 'plain', '** Deep\nbody', TR, o);
  add('a\n\n* Z\n', 'plain', '* X\nbody', [], o);
  add('* Tr\n', 'item', 'new', TR, o);
  add('* Tr\nintro\n', 'item', 'new', TR, o);
  add('* Tr\n- i1\n- i2\n', 'item', 'new', TR, o);
  add('* Tr\nx\n- i1\n- i2\n\ntext\n', 'item', 'new', TR, o);
  add('* Tr\n- i1\n\n- i2\n\n** A\n', 'item', 'new', TR, o);
  add('* Tr\n:PROPERTIES:\n:ID: x\n:END:\n', 'item', 'new', TR, o);
  add('* Tr\n| a | b |\n', 'table-line', '| c | d |', TR, o);
}
for (const o of withP({})) {
  add('* Tr\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n', 'table-line', '| a | b | c |', TR, o);
  add('* Tr\ntext\n** A\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n\ntext\n\n** A\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n| h1 | h2 |\n|----+----|\n| x | y |\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n| x | y |\n| z | w |\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n| h1 | h2 |\n|----+----|\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n| h1 | h2 |\n|----+----|\n| x | y |\n|----+----|\n| t | u |\n', 'table-line', '| a | b |', TR, o);
  add('* Tr\n| x | y |\n\n| z | w |\n', 'table-line', '| a | b |', TR, o);
  add('| x | y |\n\n* Tr\n', 'table-line', '| a | b |', [], o);
  add('* Tr\n#+TBLFM: $2=1\n| x | y |\n#+TBLFM: $2=1\n', 'table-line', '| a | b |', TR, o);
  // several rows in the template, formulas that name rows, tables with an indent, a table at the top of the file
  add('* Tr\n| x | y |\n| z | w |\n', 'table-line', '| a | b |\n| c | d |', TR, o);
  add('* Tr\n| h | h |\n|---+---|\n| x | y |\n', 'table-line', '| a | b |\n|---+---|\n| c | d |', TR, o);
  add('* Tr\n| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9\n', 'table-line', '| 2 |', TR, o);
  add('* Tr\n| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9::@3$1=@2$1+1\n', 'table-line', '| 2 |\n| 3 |', TR, o);
  add('* Tr\n  | a | b |\n  | c | d |\n', 'table-line', '| e | f |', TR, o);
  add('* Tr\n  | h1 | h2 |\n  |----+----|\n  | c | d |\n', 'table-line', '| e | f |\n| g | h |', TR, o);
  add('* Tr\n\t| a | b |\n', 'table-line', '| e | f |', TR, o);
  add('| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9\n', 'table-line', '| 2 |', [], o);
  add('| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9\n', 'table-line', '| 2 |\n| 3 |', [], o);
}
for (const pos of ['I-1', 'I+1']) {
  add('* Tr\n| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9\n', 'table-line', '| 2 |', TR, { tableLinePos: pos });
  add('* Tr\n| 1 |\n|---|\n| 9 |\n#+TBLFM: @2$1=9\n', 'table-line', '| 2 |\n| 3 |', TR, { tableLinePos: pos });
  add('* Tr\n  | 1 |\n  |---|\n  | 9 |\n', 'table-line', '| 2 |', TR, { tableLinePos: pos });
}
for (const pos of ['I+1', 'I+2', 'I-1', 'I+0', 'II+1', 'II-1', 'III+1', 'I+9', 'I-9']) {
  add('* Tr\n| h1 | h2 |\n|----+----|\n| x | y |\n| z | w |\n|----+----|\n| t | u |\n', 'table-line', '| a | b |', TR, { tableLinePos: pos });
}
add('* Tr\n| x | y |\n', 'table-line', '| a | b |', TR, { tableLinePos: 'I+1' });
add('* Tr\n', 'table-line', '| a | b |', TR, { tableLinePos: 'I+1' });

for (const o of withP({}).concat(withP({ emptyLines: 1 }))) {
  add('* Tr\n+ a\n+ b\n', 'item', 'new', TR, o);
  add('* Tr\n1. a\n2. b\n', 'item', 'new', TR, o);
  add('* Tr\n  - a\n  - b\n', 'item', 'new', TR, o);
  add('* Tr\n- a\n  - sub\n- b\n  more\n', 'item', 'l1\nl2', TR, o);
  add('* A\nt\n** B\n- i\n* C\n- j\n', 'item', 'new', [], o);
  add('* A\ntext\n* B\ntext\n', 'item', 'new', [], o);
  add('pre\n* A\ntext\n* B\ntext\n', 'plain', 'text', [], o);
  add('pre\n* A\ntext\n* B\ntext\n', 'entry', '* New', [], o);
  add('* A\n| x | y |\n* B\n| z | w |\n', 'table-line', '| a | b |', [], o);
  add('* A\ntext\n* B\ntext\n', 'table-line', '| a | b |', [], o);
  add('* Tr\n:LOGBOOK:\n- note\n:END:\ntext\n', 'plain', 'new', TR, o);
  add('* Tr\n:MYDRAWER:\nx\n:END:\n\ntext\n', 'plain', 'new', TR, o);
  add('* Tr\nSCHEDULED: <2026-01-01 Thu>\n:PROPERTIES:\n:ID: x\n:END:\n\ntext\n', 'plain', 'new', TR, o);
  add('* Tr\nSCHEDULED: <2026-01-01 Thu>\n:PROPERTIES:\n:ID: x\n:END:\n\ntext\n', 'item', 'new', TR, o);
  add('* Tr\n#+begin_src sh\n- not a list\n#+end_src\ntext\n', 'item', 'new', TR, o);
  // a list that is indented takes every line of the item as indented, and the continuation lines too
  add('* Tr\n  - a\n  - b\n', 'item', '- X\n  Line 2', TR, o);
  add('* Tr\n  - a\n  - b\n', 'item', 'X\nLine 2', TR, o);
  add('* Tr\n- a\n- b\n', 'item', '- X\n  Line 2\n  Line 3', TR, o);
}
add('* Tr\n    + a\n', 'item', '- X\n  Line 2', TR, {}); // only appended: put first, Emacs re-indents the old first item (4 spaces) as a child of the new one, which is not matched
add('* Tr\n', 'entry', '** ', TR, {});
add('* Tr\n', 'entry', '** ', TR, { prepend: true });

const q = (s) => JSON.stringify(s);
const kw = (o) => [
  o.prepend ? ':prepend t' : '', o.emptyLines !== undefined ? `:empty-lines ${o.emptyLines}` : '',
  o.emptyLinesBefore !== undefined ? `:empty-lines-before ${o.emptyLinesBefore}` : '', o.emptyLinesAfter !== undefined ? `:empty-lines-after ${o.emptyLinesAfter}` : '',
  o.tableLinePos ? `:table-line-pos ${q(o.tableLinePos)}` : '',
].filter(Boolean).join(' ');
const el = `
(require 'org) (require 'org-capture) (require 'json)
(defun run-case (init type template headline kw)
  (let* ((f (make-temp-file "place" nil ".org"))
         (target (if headline (list 'file+headline f headline) (list 'file f)))
         (org-capture-templates (list (append (list "t" "T" type target template) kw (list :immediate-finish t)))))
    (with-temp-file f (insert init))
    (condition-case err
        (progn (org-capture nil "t")
               (with-current-buffer (find-buffer-visiting f)
                 (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
      (error (concat "ERROR " (error-message-string err))))))
(let (out)
  ${cases.map((c, i) => `(push (run-case ${q(c.init)} '${c.type} ${q(c.template)} ${c.olp.length ? q(c.olp[0]) : 'nil'} (car (read-from-string ${q(`(${kw(c.opts)})`)}))) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/capture-place-oracle.json', import.meta.url), JSON.stringify({ cases: cases.map((c, i) => ({ ...c, emacs: outs[i] })) }, null, 1) + '\n');
console.log(`${cases.length} cases`);
