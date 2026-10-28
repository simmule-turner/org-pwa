// examples/export-latex.org and examples/citations.org: every section holds an Org text, its settings, and the LaTeX body Emacs 29.3
// wrote for it (tools/gen-latex-examples.mjs); the app must write the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToLatex } from '../src/export-latex.js';
import { cacheBibliography } from '../src/cite.js';

const read = (/** @type {string} */ name) => readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8');
cacheBibliography('refs.bib', read('refs.bib'));

/** The body of a .tex file, with the label hashes numbered by first use (as in tools/gen-latex-examples.mjs). @param {string} tex */
function bodyOf(tex) {
  const ids = new Map();
  const a = tex.indexOf('\\begin{document}');
  const body = a < 0 ? tex : tex.slice(a + '\\begin{document}'.length, tex.lastIndexOf('\\end{document}'));
  return body
    .replace(/^\\(maketitle|tableofcontents)\s*$/gm, '')
    .replace(/\\(bibliography|addbibresource)\{[^}]*\/(refs(?:\.bib)?)\}/g, '\\$1{$2}')
    .replace(/org[0-9a-f]{7}/g, (id) => {
      if (!ids.has(id)) ids.set(id, 'org' + String(ids.size + 1).padStart(7, '0'));
      return /** @type {string} */ (ids.get(id));
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const unescape = (/** @type {string} */ t) => t.replace(/^,(\s*(\*|#\+))/gm, '$1');

for (const file of ['export-latex.org', 'citations.org']) {
  const text = read(file);
  const sections = text.split(/^\* /m).slice(1);
  let checked = 0;
  for (const section of sections) {
    const title = section.split('\n')[0];
    const blocks = [...section.matchAll(/^#\+begin_src (\S+)\n([\s\S]*?)^#\+end_src$/gm)].map((m) => ({ lang: m[1], text: unescape(m[2].replace(/\n$/, '')) }));
    const org = blocks.find((b) => b.lang === 'org');
    const want = blocks.find((b) => b.lang === 'latex');
    if (!org || !want) continue;
    const init = blocks.find((b) => b.lang === 'emacs-lisp')?.text;
    checked++;
    test(`${file}: ${title}`, () => {
      let got;
      try {
        got = bodyOf(exportToLatex(parseOrg(org.text + '\n'), null, { defaults: { init, file: { name: 'example.org', mtime: new Date(2026, 5, 15) } } }));
      } catch (e) {
        got = 'ERROR ' + /** @type {Error} */ (e).message;
      }
      assert.equal(got, want.text);
    });
  }
  test(`${file} has its sections`, () => assert.ok(checked >= 6));
}
