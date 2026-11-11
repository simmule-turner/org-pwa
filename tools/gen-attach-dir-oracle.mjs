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
