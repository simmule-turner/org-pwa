#!/usr/bin/env node
/**
 * Writes test/fixtures/footnote-oracle.json: what Emacs 29.3's org-footnote commands leave (org-footnote-new,
 * -normalize, -renumber-fn:N, -sort, -delete) for a set of texts.
 *   node tools/gen-footnote-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXTS = [
  // plain notes, definitions after the paragraph, at the end, in a section
  'Text[fn:1] and more[fn:2].\n\n[fn:1] One.\n\n[fn:2] Two.\n',
  '* H\nText[fn:b] and[fn:a].\n\n* Footnotes\n[fn:a] A.\n\n[fn:b] B.\n',
  '* H\nText[fn:b] and[fn:a].\n\n* Footnotes\n\n[fn:a] A.\n[fn:b] B.\n\n* After\nx\n',
  '* H\nText[fn:1].\n\n* Footnotes\n** Sub\n[fn:1] A.\n',
  'Text[fn:1]\n\n[fn:1] one\nsecond line\n\nnext paragraph\n',
  'Text[fn:1]\n\n[fn:1] one\n\n\nafter two blanks\n',
  '* A\nOne[fn:1].\n** B\nTwo[fn:2].\n\n[fn:2] Two.\n\n[fn:1] One.\n',
  '[fn:1] def first\n\nText[fn:1] after.\n',
  'Text[fn:1]',
  'Text[fn:1]\n\n[fn:1] def at eof',
  // inline and anonymous
  'A[fn::inline text] and B[fn:x:named inline] and C[fn:x].\n',
  'A[fn::one [fn:2] nested].\n\n[fn:2] two\n',
  'A[fn:a:long inline\nspanning lines] end.\n',
  // contexts where a reference is or is not a footnote
  '* H\nSee [[https://x.org/a[fn:1]][link]] here.\n\n[fn:1] one\n',
  'In ~code[fn:1]~ and =verb[fn:1]= text[fn:1].\n\n[fn:1] one\n',
  '#+begin_src sh\necho "[fn:1]"\n#+end_src\nText[fn:1].\n\n[fn:1] one\n',
  '#+begin_quote\nQuote[fn:1].\n#+end_quote\n\n[fn:1] one\n',
  '# comment [fn:1]\nText[fn:1].\n\n[fn:1] one\n',
  ': fixed [fn:1]\nText[fn:1].\n\n[fn:1] one\n',
  '* H\n:PROPERTIES:\n:X: [fn:1]\n:END:\nText[fn:1].\n\n[fn:1] one\n',
  '#+TITLE: T[fn:1]\nText[fn:1].\n\n[fn:1] one\n',
  '| a | b[fn:1] |\n| c | d |\n\n[fn:1] note\n',
  '- item[fn:1]\n- item two\n\n[fn:1] note\n',
  '- item\n  [fn:1] indented\n\nText[fn:1].\n',
  '* Head[fn:1] title\nbody\n\n[fn:1] note\n',
  '* TODO Head :tag:\nbody[fn:1]\n\n[fn:1] note\n',
  // labels
  'A[fn:é] B[fn:a-b] C[fn:a_b] D[fn:1x].\n\n[fn:é] e\n\n[fn:a-b] ab\n\n[fn:a_b] ab2\n\n[fn:1x] one x\n',
  'A[fn:1] B[fn:10] C[fn:2].\n\n[fn:10] ten\n\n[fn:2] two\n\n[fn:1] one\n',
  'A[fn:z] B[fn:y] C[fn:z].\n\n[fn:y] why\n\n[fn:z] zed\n',
  'A[fn:1] unknown[fn:nodef] B[fn:2].\n\n[fn:2] two\n\n[fn:3] unused\n',
  'A[fn:1] B[fn:1].\n\n[fn:1] one\n\n[fn:1] dup\n',
  // several headings, sections
  '* One\nA[fn:1].\n\n[fn:1] a\n\n* Two\nB[fn:2].\n\n[fn:2] b\n\n* Footnotes\n[fn:3] c\n',
  '* One\nA[fn:1].\n\n* Footnotes\n\n[fn:1] a\n\n** Not part\nstuff\n',
  '* One\nA.\n\n* FOOTNOTES\n',
  '* Footnotes :tag:\nA.\n',
  'A[fn:1].\n\n* Footnotes\n[fn:1] one\ncontinued\n\npara two of def\n',
];
const ops = [];
const add = (op, text, args = {}) => ops.push({ op, text, ...args });
for (const t of TEXTS) {
  add('normalize', t, { section: 'Footnotes' });
  add('normalize', t, { section: null });
  add('renumber', t);
  add('sort', t, { section: 'Footnotes' });
  const labels = [...new Set([...t.matchAll(/\[fn:([^\]:\s]+)[\]:]/g)].map((m) => m[1]))];
  for (const l of labels.slice(0, 2)) for (const autoAdjust of ['nil', 'renumber']) add('delete', t, { label: l, autoAdjust });
  // new references: after a few word ends, with an anonymous, an existing and a new label
  const spots = [...t.matchAll(/\S(?= |\n|$)/g)].map((m) => m.index + 1).filter((_, i) => i % 3 === 0).slice(0, 5);
  for (const pos of spots) for (const label of ['', 'new', labels[0] ?? '1']) add('new', t, { pos, label, autoAdjust: 'nil', defineInline: false, section: 'Footnotes' });
  if (spots.length) {
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'renumber', defineInline: false, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'sort', defineInline: false, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'nil', defineInline: true, section: 'Footnotes' });
    add('new', t, { pos: spots[0], label: 'zz', autoAdjust: 'nil', defineInline: false, section: null });
  }
}
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-footnote) (require 'cl-lib) (require 'json)
(defun run (op text args)
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
const jsonArgs = (a) => JSON.stringify(a);
const calls = ops.map((o) => {
  const { op, text, ...args } = o;
  return `(push (run ${q(op)} ${q(text)} (json-parse-string ${q(jsonArgs(args))} :object-type 'alist :null-object nil :false-object :false)) out)`;
});
const full = el.replace(/\(org-footnote-define-inline \(eq t[^\n]*\n/, "(org-footnote-define-inline (eq t (alist-get 'defineInline args)))\n") + `\n(let (out)\n${calls.join('\n')}\n(princ (json-encode (vconcat (nreverse out)))))\n`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, full);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-3000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/footnote-oracle.json', import.meta.url), JSON.stringify(ops.map((o, i) => ({ ...o, emacs: outs[i] })), null, 1) + '\n');
console.log(`${ops.length} cases`);
