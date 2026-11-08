// examples/capture-datetree.org holds what Emacs 29.3 left after org-capture filed a template under a date tree
// (tools/gen-example-capture-datetree.mjs). The app must read the template and file it the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { fileCapture, resolveOlpTarget } from '../src/capture-template.js';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';

const text = readFileSync(new URL('../examples/capture-datetree.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');
const block = (/** @type {string} */ sec, /** @type {string} */ label, /** @type {string} */ lang) => {
  const m = new RegExp(`^${label}:\\n#\\+BEGIN_SRC ${lang}\\n([\\s\\S]*?)\\n?#\\+END_SRC`, 'm').exec(sec);
  assert.ok(m, `${label} in ${sec.split('\n')[0]}`);
  return m[1];
};

const sections = text.split(/^\* /m).slice(1).filter((s) => /^Captured on /m.test(s));

test('the file has its eight cases', () => {
  assert.equal(sections.length, 8);
});

for (const sec of sections) {
  const title = sec.split('\n')[0];
  test(`capture-datetree.org, "${title}": the template is read and files as Emacs filed it`, () => {
    const date = /^Captured on (\d+)-(\d+)-(\d+) /m.exec(sec);
    assert.ok(date);
    const lisp = block(sec, 'Template, in the Lisp init', 'emacs-lisp');
    const { templates, notes } = captureTemplatesFromLisp(lisp);
    assert.deepEqual(notes, []);
    assert.equal(templates.length, 1);
    const t = templates[0];
    const doc = parseOrg(unescape(block(sec, 'Before, journal.org', 'org')).replace(/$/, '\n').replace(/^\n$/, ''));
    const target = resolveOlpTarget(doc, t.olp, { now: new Date(+date[1], +date[2] - 1, +date[3], 12), datetree: !!t.datetree, treeType: t.treeType });
    fileCapture(doc, target, t.type, t.template, !!t.prepend, {});
    assert.equal(serializeOrg(doc), unescape(block(sec, 'After, journal.org', 'org')) + '\n');
  });
}
