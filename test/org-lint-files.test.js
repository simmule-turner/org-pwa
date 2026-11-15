// org-lint's file checks in the app's file model (src/org-lint-files.js), held to Emacs 29.3 on the cases of
// test/fixtures/org-lint-oracle.json: with the storage listing the files Emacs's working directory has, the reports are Emacs's,
// except where the app cannot know (test/support/org-lint-known.js FILE_RULES).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { missingFiles, orgLintInStorage, storagePathOf } from '../src/org-lint-files.js';
import { fileRuleFor, FILE_RULES } from './support/org-lint-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-lint-oracle.json', import.meta.url), 'utf8'));
// a WebDAV folder that is not there lists as empty
const listFolder = async (/** @type {string} */ folder) => (folder === '' ? Object.keys(oracle.files) : []);
const options = { readFile: (/** @type {string} */ f) => (Object.hasOwn(oracle.files, f) ? oracle.files[f] : null), idExists: () => false };

test('a file is missing only when its folder is listed and the name is not there', async () => {
  const lists = async (/** @type {string} */ folder) => (folder === 'notes' ? ['a.org', 'sub'] : folder === '' ? ['x.org'] : null);
  const missing = await missingFiles(['a.org', './b.org', '../x.org', 'y.org', '/etc/passwd', '~/z.org', 'sub', 'other/c.org'], 'notes/doc.org', lists);
  assert.deepEqual([...missing].sort(), ['./b.org', 'y.org']);
  assert.equal(storagePathOf('./a.org', 'notes/doc.org'), 'notes/a.org');
  assert.equal(storagePathOf('/etc/passwd', 'doc.org'), null);
});

test('a folder that cannot be listed leaves its files as existing', async () => {
  const missing = await missingFiles(['a.org'], 'doc.org', async () => { throw new Error('offline'); });
  assert.equal(missing.size, 0);
});

test('the reports are Emacs\'s when the storage lists the files Emacs\'s working directory had, except for the listed limits', async () => {
  const bad = [];
  for (const c of oracle.cases) {
    if (typeof c.emacs === 'string') continue;
    let got;
    try {
      got = (await orgLintInStorage(c.text, null, options, 'doc.org', listFolder)).map((r) => [r.line, r.trust, r.message, r.checker]);
    } catch {
      continue; // the ERROR cases are compared by test/org-lint-oracle.test.js
    }
    if (JSON.stringify(got) !== JSON.stringify(c.emacs)) bad.push({ text: c.text.length > 200 ? c.text.slice(0, 200) + '...' : c.text, got, want: c.emacs });
  }
  const unexplained = bad.filter((c) => !fileRuleFor(c));
  assert.equal(unexplained.length, 0, `${unexplained.length} differ without a rule\n` + JSON.stringify(unexplained.slice(0, 3), null, 1));
  for (const r of FILE_RULES) assert.ok(bad.some((c) => fileRuleFor(c) === r), `rule "${r.id}" matches no differing case: remove it`);
});
