#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-datetree-oracle.json: the file Emacs's org-capture leaves after filing a template under a
 * file+olp+datetree target (the day, week or month tree of a date), for a spread of documents, dates, capture types and options.
 *   node tools/gen-capture-datetree-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = [];
const add = (init, type, template, olp, ymd, opts = {}) => cases.push({ init, type, template, olp, ymd, opts });

const DATES = [[2026, 11, 7], [2026, 1, 1], [2024, 12, 30], [2027, 1, 3], [2026, 12, 31], [2026, 2, 28]];
const TREE = '* 2026\n** 2026-11 November\n*** 2026-11-05 Thursday\n**** x\n*** 2026-11-09 Monday\n**** y\n';
const DOCS = [
  '', '\n', 'pre\n', 'pre', '#+TITLE: t\n', '#+TITLE: t\n\n', '#+TITLE: t\n\npre\n\n', 'pre\n\n* Z\n', 'pre\n* 2027\n',
  '* Foo\n', '* Foo', '* Foo\n\n', '* Foo   \n', '* Foo\nbody', '* Foo\nbody\n', '* Foo\nbody  \n', '* Foo\nbody\n\n\n',
  '* Foo\nbody\n\n* Bar\n', '* Foo\n\nbody\n\n* Bar\nb2\n', '* Foo\n** Sub\n\n* Bar\n', '* Foo\n:PROPERTIES:\n:ID: x\n:END:\n',
  TREE, TREE.replace(/\n(?=\*)/g, '\n\n'), TREE + '\n', TREE.slice(0, -1),
  '* 2026\n', '* 2026\n\n', '* 2026\n** 2026-11 November\n', '* 2026\n** 2026-10 October\n', '* 2026\n** 2026-12 December\n',
  '* 2026\n** 2026-11 November\n*** 2026-11-07 Saturday\n', '* 2026\n** 2026-11 November\n*** 2026-11-07 Saturday\nnote\n',
  '* 2025\n* 2027\n', '* 2025\n\n* 2027\n', '* 2027\n', '* 2025\n', '* 2025\n\n', '* 2026 :tag:\n', '* 2026   \n',
  '* 2025\n** 2025-12 December\n*** 2025-12-31 Wednesday\n* 2027\n',
  '* Foo\n* 2026\n** 2026-11 November\n* Bar\n',
  '* 2026-W45\n', '* 2026\n** 2026-W44\n*** 2026-10-31 Saturday\n** 2026-W46\n',
  '* Inbox\n:PROPERTIES:\n:DATE_TREE: t\n:END:\n** other\n', '* Z\n* Inbox\n:PROPERTIES:\n:WEEK_TREE: t\n:END:\n',
  '* Journal\n** 2026\n*** 2026-11 November\n', '* TODO 2026\n',
];
const OLP_DOCS = [
  ['* Journal\n', ['Journal']], ['* Journal\n** other\n', ['Journal']], ['* Journal\n\n* Z\n', ['Journal']], ['* Z\n* Journal\nbody\n', ['Journal']],
  ['* Journal\n** 2026\n*** 2026-11 November\n**** 2026-11-05 Thursday\n* Z\n', ['Journal']], ['* Journal\n** 2026\n** 2025\n', ['Journal']],
  ['* A\n** Journal\n*** x\n', ['A', 'Journal']], ['* A\n** Journal\n\n* Z\n', ['A', 'Journal']], ['* A\n** Journal\n', ['A', 'Journal']],
  ['* Journal\n\n** 2026\n\n*** 2026-11 November\n\n**** 2026-11-05 Thursday\n\n', ['Journal']],
];

for (const init of DOCS) {
  for (const ymd of DATES.slice(0, 3)) add(init, 'entry', '* New', [], ymd);
  add(init, 'entry', '* New', [], [2026, 11, 7], { prepend: true });
  add(init, 'entry', '* New', [], [2026, 11, 7], { treeType: 'week' });
  add(init, 'entry', '* New', [], [2026, 11, 7], { treeType: 'month' });
}
for (const [init, olp] of OLP_DOCS) {
  for (const ymd of DATES) add(init, 'entry', '* New', olp, ymd);
  for (const treeType of ['week', 'month']) for (const ymd of DATES.slice(0, 4)) add(init, 'entry', '* New', olp, ymd, { treeType });
  add(init, 'entry', '* New', olp, [2026, 11, 7], { prepend: true });
  add(init, 'entry', '* New\nbody', olp, [2026, 11, 7], { emptyLines: 1 });
  for (const [type, template] of [['item', 'new'], ['checkitem', 'c'], ['plain', 'text'], ['table-line', '| a | b |']]) {
    add(init, type, template, olp, [2026, 11, 7]);
    add(init, type, template, olp, [2026, 11, 7], { prepend: true });
  }
}
for (const [init, olp] of [OLP_DOCS[2], OLP_DOCS[5], OLP_DOCS[7]]) {
  for (const o of [{ emptyLines: 1 }, { emptyLines: 2 }, { emptyLinesBefore: 2 }, { emptyLinesAfter: 1 }, { emptyLines: 1, prepend: true }]) add(init, 'table-line', '| a | b |', olp, [2026, 11, 7], o);
}
for (const init of [TREE, '* 2026\n** 2026-11 November\n*** 2026-11-07 Saturday\n- i1\n- i2\n', '* 2026\n** 2026-11 November\n*** 2026-11-07 Saturday\n| x | y |\n', '', '* Foo\n']) {
  for (const [type, template] of [['item', 'new'], ['checkitem', 'c'], ['plain', 'text'], ['table-line', '| a | b |'], ['entry', '* N\nbody']]) {
    for (const o of [{}, { prepend: true }, { emptyLines: 1 }, { emptyLines: 1, prepend: true }]) add(init, type, template, [], [2026, 11, 7], o);
    add(init, type, template, [], [2026, 11, 7], { treeType: 'month' });
  }
}

const q = (s) => JSON.stringify(s);
const kw = (o) => [o.prepend ? ':prepend t' : '', o.emptyLines !== undefined ? `:empty-lines ${o.emptyLines}` : '', o.emptyLinesBefore !== undefined ? `:empty-lines-before ${o.emptyLinesBefore}` : '', o.emptyLinesAfter !== undefined ? `:empty-lines-after ${o.emptyLinesAfter}` : '', o.treeType ? `:tree-type ${o.treeType}` : ''].filter(Boolean).join(' ');
const el = `
(require 'org) (require 'org-capture) (require 'json)
(defun run-case (init type template olp ymd kw)
  (let* ((f (make-temp-file "dt" nil ".org"))
         (org-overriding-default-time (encode-time (list 0 0 12 (nth 2 ymd) (nth 1 ymd) (nth 0 ymd) nil -1 nil)))
         (target (append (list 'file+olp+datetree f) olp))
         (org-capture-templates (list (append (list "t" "T" type target template) kw (list :immediate-finish t)))))
    (with-temp-file f (insert init))
    (condition-case err
        (progn (org-capture nil "t")
               (with-current-buffer (find-buffer-visiting f)
                 (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
      (error (concat "ERROR " (error-message-string err))))))
(let (out)
  ${cases.map((c) => `(push (run-case ${q(c.init)} '${c.type} ${q(c.template)} '${q(c.olp).replace(/^\[/, '(').replace(/\]$/, ')').replace(/,/g, ' ')} '(${c.ymd.join(' ')}) (car (read-from-string ${q(`(${kw(c.opts)})`)}))) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datetree-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/capture-datetree-oracle.json', import.meta.url), JSON.stringify({ cases: cases.map((c, i) => ({ ...c, emacs: outs[i] })) }, null, 1) + '\n');
console.log(`${cases.length} cases`);
