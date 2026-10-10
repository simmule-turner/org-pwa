import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrg } from '../src/org-parser.js';
import { prepareBabelExport } from '../src/babel-export.js';
import { exportToAscii } from '../src/export-ascii.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'babel');
const ascii = (text) => exportToAscii(prepareBabelExport(parseOrg(text)), null, 72);

// export-1.org was exported by Emacs 29.3 (ox-ascii, org-export-use-babel t, :eval no), which showed exactly:
// "a(); R();", "b(); <<ref>>" and "2", "3", "e(); R();", "f(); <<ref>>" and the table "1 2" (the results line named
// "named" belongs to no block); the :exports none blocks and their results were gone.
test('export honours :exports and :noweb the way Emacs does', () => {
  const out = ascii(fs.readFileSync(path.join(dir, 'export-1.org'), 'utf8'));
  const shown = out.split('\n').map((l) => l.trim()).filter((l) => l && l !== '[SRC]' && !/^(1\. H|=+)$/.test(l));
  assert.deepEqual(shown, ['a(); R();', 'b(); <<ref>>', ': 2', ': 3', 'e(); R();', 'f(); <<ref>>', '| 1 | 2 |']);
});

test('export: default shows the code and hides the stored results', () => {
  const out = ascii('* H\n#+begin_src js\nx();\n#+end_src\n\n#+RESULTS:\n: 42\n');
  assert.match(out, /x\(\);/);
  assert.doesNotMatch(out, /42/);
});

test('export: strip-export removes references, and nothing is mutated', () => {
  const doc = parseOrg('* H\n#+begin_src js :noweb strip-export\nx(); <<y>>\n#+end_src\n');
  const before = JSON.stringify(doc);
  const out = exportToAscii(prepareBabelExport(doc), null, 72);
  assert.match(out, /x\(\);/);
  assert.doesNotMatch(out, /<<y>>/);
  assert.equal(JSON.stringify(doc), before);
});
