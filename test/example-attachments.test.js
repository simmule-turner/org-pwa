// examples/attachments.org holds what Emacs 29.3 gave for a heading's attachment folder, and left after org-attach-attach and
// org-attach-delete-all (tools/gen-example-attachments.mjs). The app must give the same, apart from the differences pinned at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { resolveAttachmentDirectory } from '../src/link-resolve.js';
import { addAttachTag, removeAttachTag, attachmentPath, sanitizeAttachmentFilename } from '../src/attach.js';
import { getProperty } from '../src/archive-model.js';

const text = readFileSync(new URL('../examples/attachments.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');
const DOC = '/home/me/org/notes.org';
const sample = unescape(/The outline:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/.exec(text)?.[1] || '') + '\n';
const rel = (/** @type {string | null} */ p) => (p === null ? '(none)' : p.replace('/home/me/org/', ''));

/** @param {import('../src/types.js').Heading[]} nodes @param {string} title @returns {import('../src/types.js').Heading} */
function find(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = find(n.children, title);
    if (f) return f;
  }
  return /** @type {never} */ (undefined);
}
const tagsOf = (/** @type {string} */ t) => t.replace(/^(\*+ .*?)\s+(:[^\s]+:)$/gm, '$1 $2');

test('attachments.org: the folder of a heading is the one Emacs names', () => {
  const doc = parseOrg(sample);
  let n = 0;
  for (const m of text.split('* Attaching')[0].matchAll(/^- =(.+?)= :: (.*)$/gm)) {
    assert.equal(rel(resolveAttachmentDirectory(doc, find(doc.children, m[1]), DOC)), m[2], m[1]);
    n++;
  }
  assert.equal(n, 6);
});

test('attachments.org: attaching adds the ATTACH tag and puts the files where Emacs puts them', () => {
  const sections = [...text.matchAll(/^Attach (.+?) to =(.+?)=:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC\nFiles:\n((?:- .*\n)+)/gm)];
  assert.equal(sections.length, 4);
  for (const [, label, heading, outline, files] of sections) {
    const doc = parseOrg(sample);
    const h = find(doc.children, heading);
    addAttachTag(h);
    const shown = serializeOrg(doc).split('\n').filter((l) => /^\*+ /.test(l)).join('\n');
    assert.equal(tagsOf(shown), tagsOf(unescape(outline)), heading);
    const folder = rel(resolveAttachmentDirectory(doc, h, DOC));
    // the path the app writes for each name is the path Emacs wrote
    const written = [...files.matchAll(/^- (.*)$/gm)].map((f) => f[1]).sort();
    const attached = [...label.matchAll(/=(.+?)=/g)].map((f) => f[1]);
    const mine = attached.map((name) => `${folder}/${sanitizeAttachmentFilename(name)}`).sort();
    assert.deepEqual(mine, written, heading);
    const id = getProperty(h, 'ID');
    if (id) assert.equal(folder, rel(attachmentPath(id, 'x', DOC)).replace(/\/x$/, ''));
  }
});

test('attachments.org: deleting all attachments removes the tag', () => {
  const m = /then delete all:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/.exec(text);
  assert.ok(m);
  const doc = parseOrg(sample);
  const h = find(doc.children, 'Taxes');
  addAttachTag(h);
  removeAttachTag(h);
  const shown = serializeOrg(doc).split('\n').filter((l) => /^\*+ /.test(l)).join('\n');
  assert.equal(tagsOf(shown), tagsOf(unescape(m[1])));
});

test('attachments.org: a name already in the folder is refused, and a parent\'s folder is used only with property inheritance', () => {
  assert.match(text, /File already exists/);
  const doc = parseOrg(sample);
  assert.equal(rel(resolveAttachmentDirectory(doc, find(doc.children, 'Form 1040'), DOC)), '(none)');
  assert.equal(rel(resolveAttachmentDirectory(doc, find(doc.children, 'Form 1040'), DOC, true)), 'data/7a/3b9c4e-5d6f-4a8b-9c0d-1e2f3a4b5c6d'); // org-use-property-inheritance t
  assert.equal(sanitizeAttachmentFilename('a?b.txt'), 'a?b.txt');
  assert.equal(sanitizeAttachmentFilename('my report (final).pdf'), 'my report (final).pdf');
});

test('attachments.org: where the app differs from Emacs', () => {
  assert.match(text, /^\* Where the app differs from Emacs\n- \*Link text\*/m);
});
