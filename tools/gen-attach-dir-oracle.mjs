// Writes test/fixtures/attach-dir-oracle.json: where Emacs 29.3 puts the folder a DIR property names, for a document in /org-pwa/.
// Run: node tools/gen-attach-dir-oracle.mjs   (needs emacs on the path)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CASES = ['files/report', './files/', 'files//report', 'sub/../x', '../x', '../../x', '../../../x', '/shared/docs', 'a/./b', 'x/y/', '..', '.'];
const lisp = `(dolist (d '(${CASES.map((c) => JSON.stringify(c)).join(' ')})) (princ (format "%s\\t%s\\n" d (directory-file-name (expand-file-name d "/org-pwa/")))))`;
const out = execFileSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8' });
const result = {};
for (const line of out.trim().split('\n')) { const [dir, path] = line.split('\t'); result[dir] = path; }
writeFileSync(new URL('../test/fixtures/attach-dir-oracle.json', import.meta.url), `${JSON.stringify(result, null, 1)}\n`);
console.log(result);

// Which folder a heading's attachments are in when the DIR or ID is inherited (org-attach-use-inheritance t): a DIR anywhere up the
// chain comes before any ID. Paths are relative to the document's folder; null where Emacs finds no folder.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const prop = (k, v) => `:PROPERTIES:\n:${k}: ${v}\n:END:\n`;
const INHERIT = [
  { org: `* P\n${prop('DIR', 'att1')}** C\n${prop('ID', 'abcd12345')}*** G\n`, heading: 'C' },
  { org: `* P\n${prop('DIR', 'att1')}** C\n${prop('ID', 'abcd12345')}*** G\n`, heading: 'G' },
  { org: `* P\n${prop('ID', 'abcd12345')}** C\n${prop('DIR', 'mine')}*** G\n`, heading: 'G' },
  { org: `* P\n${prop('ID', 'abcd12345')}** C\n*** G\n`, heading: 'G' },
  { org: `* P\n${prop('ID', 'abcd12345')}** C\n${prop('ID', 'wxyz98765')}*** G\n`, heading: 'G' },
  { org: `* P\n** C\n*** G\n`, heading: 'G' },
  { org: `* P\n${prop('DIR', 'top')}** C\n${prop('DIR', 'mid')}*** G\n${prop('ID', 'abcd12345')}`, heading: 'G' },
];
const tmp = mkdtempSync(join(tmpdir(), 'attach-inherit-'));
for (const id of ['abcd12345', 'wxyz98765']) mkdirSync(join(tmp, 'data', id.slice(0, 2), id.slice(2)), { recursive: true });
INHERIT.forEach((c, i) => writeFileSync(join(tmp, `${i}.org`), c.org));
const inheritLisp = `(progn (require 'org) (require 'org-attach)
 (let ((org-attach-use-inheritance t))
  ${INHERIT.map((c, i) => `(with-current-buffer (find-file-noselect ${JSON.stringify(join(tmp, `${i}.org`))}) (org-mode) (goto-char (point-min)) (re-search-forward ${JSON.stringify(`^\\*+ ${c.heading}$`)}) (princ (format "%s\\n" (or (org-attach-dir nil t) "nil"))))`).join('\n  ')}))`;
const inheritOut = execFileSync('emacs', ['--batch', '-Q', '--eval', inheritLisp], { encoding: 'utf8' }).trim().split('\n');
writeFileSync(new URL('../test/fixtures/attach-inherit-oracle.json', import.meta.url), `${JSON.stringify(INHERIT.map((c, i) => ({ ...c, emacs: inheritOut[i] === 'nil' ? null : inheritOut[i].replace(`${tmp}/`, '').replace(/\/$/, '') })), null, 1)}\n`);
