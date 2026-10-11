import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrg } from '../src/org-parser.js';
import { tangleDocument, interpretFileMode } from '../src/tangle.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tangle');
const tangle = (text, name = 'doc.org') => tangleDocument(parseOrg(text), { documentName: name });

// Expected output files were written by Emacs 29.3 (org-babel-tangle) from the same .org files.
for (const name of ['t1', 't2', 'c1', 'n1']) {
  test(`tangle ${name}.org gives the files Emacs gives`, () => {
    const r = tangle(fs.readFileSync(path.join(dir, name + '.org'), 'utf8'), name + '.org');
    for (const f of r.files) {
      const expectedPath = path.join(dir, 'expected', f.path);
      assert.ok(fs.existsSync(expectedPath), `Emacs wrote no ${f.path}`);
      assert.equal(f.text, fs.readFileSync(expectedPath, 'utf8'), f.path);
    }
  });
}

test('tangle: file modes follow shebang and :tangle-mode', () => {
  const r = tangle(fs.readFileSync(path.join(dir, 't1.org'), 'utf8'), 't1.org');
  assert.equal(r.files.find((f) => f.path === 'out/main.js').mode, 0o755);
  const t2 = tangle(fs.readFileSync(path.join(dir, 't2.org'), 'utf8'), 't2.org');
  assert.equal(t2.files.find((f) => f.path === 'out/mode.js').mode, 0o700);
  assert.equal(interpretFileMode('(identity #o644)'), 0o644);
});

test('tangle: COMMENT and ARCHIVE subtrees and :tangle no are skipped', () => {
  const r = tangle('* COMMENT x\n#+begin_src js :tangle a.js\n1\n#+end_src\n* y :ARCHIVE:\n#+begin_src js :tangle a.js\n2\n#+end_src\n* z\n#+begin_src js :tangle no\n3\n#+end_src\n');
  assert.equal(r.files.length, 0);
});

test('tangle: unsafe paths are refused', () => {
  for (const p of ['/etc/x', '../x', '~/x', 'a/../../x']) {
    assert.throws(() => tangle(`#+begin_src js :tangle ${p}\n1\n#+end_src\n`), /path|folder|absolute|\.\./i, p);
  }
});

test('noweb: unresolved and circular references are errors', () => {
  assert.throws(() => tangle('#+begin_src js :tangle a.js :noweb yes\n<<nope>>\n#+end_src\n'), /nope/);
  assert.throws(() => tangle('#+NAME: a\n#+begin_src js :noweb yes\n<<b>>\n#+end_src\n#+NAME: b\n#+begin_src js :noweb yes :tangle a.js\n<<a>>\n#+end_src\n'), /circle/);
});

test('noweb: a CUSTOM_ID heading can be referenced', () => {
  const r = tangle('* Notes\n:PROPERTIES:\n:CUSTOM_ID: n\n:END:\ntext line\n* Code\n#+begin_src js :tangle a.js :noweb yes\n// <<n>>\n#+end_src\n');
  assert.equal(r.files[0].text, '// text line\n');
});

test(':comments noweb: a block referenced twice is wrapped both times, linked to itself', () => {
  const r = tangle('* Top\n#+NAME: h\n#+begin_src js :tangle no\nh();\n#+end_src\n#+begin_src js :tangle a.js :noweb yes :comments noweb\n<<h>>\nx();\n<<h>>\n#+end_src\n', 'd.org');
  const lines = r.files[0].text.split('\n');
  assert.equal(lines.filter((l) => l === '// [[file:d.org::h][h]]').length, 2);
  assert.equal(lines.filter((l) => l === '// h ends here').length, 2);
});
