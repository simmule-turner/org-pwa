#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-lists.json: what Emacs 29.3 leaves after list edits (toggle a checkbox, M-RET, M-S-RET, delete
 * an item, org-list-repair), after org-update-statistics-cookies, and after the org-footnote commands, for the corpus in
 * tools/oracle-lists-cases.mjs.  test/oracle-lists.test.js holds the app to it.
 *   node tools/gen-oracle-lists.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COOKIES, FOOTNOTES, LISTS, LIST_OPS } from './oracle-lists-cases.mjs';

const itemRe = /^\s*([-+*]|\d+[.)])(\s|$)/;
const listCases = [];
for (const [name, org] of Object.entries(LISTS)) {
  org.split('\n').forEach((l, i) => {
    if (!itemRe.test(l) || /^\* /.test(l)) return;
    for (const op of LIST_OPS) {
      if (op === 'toggle' && !/^\s*([-+*]|\d+[.)])\s+\[[ xX-]\]/.test(l)) continue;
      listCases.push({ list: name, org, line: i, op });
    }
  });
}
const fnOps = [];
const add = (op, text, args = {}) => fnOps.push({ op, text, ...args });
for (const t of FOOTNOTES) {
  add('normalize', t, { section: 'Footnotes' });
  add('normalize', t, { section: null });
  add('renumber', t);
  add('sort', t, { section: 'Footnotes' });
  const labels = [...new Set([...t.matchAll(/\[fn:([^\]:\s]+)[\]:]/g)].map((m) => m[1]))];
  for (const l of labels.slice(0, 2)) for (const autoAdjust of ['nil', 'renumber']) add('delete', t, { label: l, autoAdjust });
  const spots = [...t.matchAll(/\S(?= |\n|$)/g)].map((m) => m.index + 1).filter((_, i) => i % 3 === 0).slice(0, 4);
  for (const pos of spots) for (const label of ['', 'new', labels[0] ?? '1']) add('new', t, { pos, label, autoAdjust: 'nil', defineInline: false, section: 'Footnotes' });
  if (spots.length) {
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'renumber', defineInline: false, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'sort', defineInline: false, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'nil', defineInline: true, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'nil', defineInline: false, section: null });
  }
}

const TAG_HEADS = ['* H :tag:', '* TODO H [1/2] :a:b:', '* A long long long long long long long title that goes on and on :t:', '* 日本語 :x:', '* H  :tag:', '** Sub :tag:', '* [#A] Pri :p:', '* :only:', '* H :tag:with:many:tags:here:'];
const tagCases = [];
for (const col of [0, 1, -1, 5, -5, 20, -20, 40, -40, 77, -77, 100, -100]) for (const head of TAG_HEADS) tagCases.push({ col, head });
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-footnote) (require 'json) (require 'cl-lib)
(defun list-case (org line op)
  (condition-case err
      (with-temp-buffer
        (insert org) (org-mode) (goto-char (point-min))
        (let ((inhibit-message t))
          (forward-line line) (end-of-line)
          (cond ((string= op "toggle") (org-toggle-checkbox))
                ((string= op "insert-after") (org-meta-return))
                ((string= op "insert-todo") (org-insert-todo-heading nil))
                ((string= op "repair") (org-list-repair))
                ((string= op "cut") (beginning-of-line)
                 ;; Org has no command that deletes one item, so: delete the item with its sub-items and text, then repair the list from
                 ;; the item that took its place (or the one above when it was the last)
                 (let* ((struct (org-list-struct)) (item (point)) (end (org-list-get-item-end item struct)))
                   (delete-region item end)
                   (goto-char (min item (point-max)))
                   (while (and (> (point) (point-min)) (not (org-at-item-p))) (forward-line -1))
                   (when (org-at-item-p) (org-list-repair)))))
          (substring-no-properties (buffer-string))))
    (error (concat "ERROR " (error-message-string err)))))
(defun tags-case (col head)
  (with-temp-buffer
    (insert head "\nbody\n") (org-mode)
    (let ((org-tags-column col))
      (goto-char (point-min)) (org-align-tags)
      (buffer-substring-no-properties (point-min) (line-end-position)))))
(defun cookie-case (org)
  (with-temp-buffer
    (insert org) (org-mode)
    (condition-case err
        (progn
          (org-with-wide-buffer (goto-char (point-min)) (while (re-search-forward org-heading-regexp nil t) (end-of-line) (org-update-checkbox-count)))
          (org-map-region #'org-update-parent-todo-statistics (point-min) (point-max))
          (substring-no-properties (buffer-string)))
      (error (concat "ERROR " (error-message-string err))))))
(defun fn-case (op text args)
  (condition-case err
      (with-temp-buffer
        (insert text) (org-mode)
        (let ((org-footnote-section (let ((s (alist-get 'section args 'none))) (if (eq s 'none) "Footnotes" s)))
              (org-footnote-auto-adjust (intern (or (alist-get 'autoAdjust args) "nil")))
              (org-footnote-define-inline (eq t (alist-get 'defineInline args)))
              (org-footnote-auto-label 'confirm))
          (cl-letf (((symbol-function 'org-edit-footnote-reference) (lambda () nil))
                    ((symbol-function 'completing-read) (lambda (&rest _) (alist-get 'label args))))
            (pcase op
              ("normalize" (org-footnote-normalize))
              ("renumber" (org-footnote-renumber-fn:N))
              ("sort" (org-footnote-sort))
              ("delete" (org-footnote-delete (alist-get 'label args)))
              ("new" (goto-char (1+ (alist-get 'pos args))) (org-footnote-new))))
          (substring-no-properties (buffer-string))))
    (error (concat "ERROR " (error-message-string err)))))
`;
const calls = [
  ...listCases.map((c) => `(push (list-case ${q(c.org)} ${c.line} ${q(c.op)}) out)`),
  ...COOKIES.map((c) => `(push (cookie-case ${q(c)}) out)`),
  ...tagCases.map((c) => `(push (tags-case ${c.col} ${q(c.head)}) out)`),
  ...fnOps.map(({ op, text, ...args }) => `(push (fn-case ${q(op)} ${q(text)} (json-parse-string ${q(JSON.stringify(args))} :object-type 'alist :null-object nil :false-object :false)) out)`),
];
const full = el + `\n(let (out)\n${calls.join('\n')}\n(princ (json-encode (vconcat (nreverse out)))))\n`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-lists-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, full);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28, input: '' });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-3000)); process.exit(1); }
const outs = JSON.parse(m[0]);
let k = 0;
const out = {
  emacs: '29.3',
  lists: listCases.map((c) => ({ ...c, emacs: outs[k++] })),
  cookies: COOKIES.map((org) => ({ org, emacs: outs[k++] })),
  tags: tagCases.map((c) => ({ ...c, emacs: outs[k++] })),
  footnotes: fnOps.map((o) => ({ ...o, emacs: outs[k++] })),
};
fs.writeFileSync('test/fixtures/oracle-lists.json', JSON.stringify(out, null, 1) + '\n');
const errs = (a) => a.filter((x) => String(x.emacs).startsWith('ERROR')).length;
console.log(`lists ${out.lists.length} (${errs(out.lists)} errors), cookies ${out.cookies.length} (${errs(out.cookies)}), footnotes ${out.footnotes.length} (${errs(out.footnotes)})`);
