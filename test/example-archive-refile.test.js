// examples/archive-refile.org holds what Emacs 29.3 left after org-archive-subtree, org-toggle-archive-tag and org-refile
// (tools/gen-example-archive-refile.mjs). The app must give the same text, apart from the differences listed in the last section
// of that file (the column the tags are aligned to, and the restore command that Org does not have).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { buildArchivedClone, buildRestoredClone, getArchiveLocation, insertAtArchiveLocation, parseArchiveLocation, resolveArchiveFileId, archiveInPlace, appendRefiled, shiftLevels } from '../src/archive-model.js';
import { removeHeading } from '../src/heading-edit.js';

const text = readFileSync(new URL('../examples/archive-refile.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');
const DIR = '/home/me/org';
const nowNY = () => new Date(2026, 9, 11, 16, 30);

/** @typedef {{ title: string, op: string, find: string, to: string | null, toFile: string | null, before: Record<string, string>, after: Record<string, string> }} Section */
/** @returns {Section[]} */
function sections() {
  return text.split(/^\* /m).slice(1).filter((s) => /^(Archive|Toggle|Refile)/m.test(s)).map((sec) => {
    const op = /^(Archive|Toggle the archive tag on|Refile) the heading =(.*?)=(?: to the heading =(.*?)=(?: in =(.*?)=)?)?\./m.exec(sec);
    assert.ok(op, sec.split('\n')[0]);
    /** @type {Record<string, string>} */ const before = {};
    /** @type {Record<string, string>} */ const after = {};
    for (const m of sec.matchAll(/^(Before|After), (\S+):\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/gm)) (m[1] === 'Before' ? before : after)[m[2]] = unescape(m[3]) + '\n';
    return { title: sec.split('\n')[0], op: op[1], find: op[2], to: op[3] || null, toFile: op[4] || null, before, after };
  });
}

/** Finds a heading by title. @param {import('../src/types.js').Heading[]} nodes @param {string} title @returns {import('../src/types.js').Heading | undefined} */
function find(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = find(n.children, title);
    if (f) return f;
  }
  return undefined;
}

/** What the app writes for a section: the files by name. @param {Section} s */
function appResult(s) {
  const prev = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    /** @type {Record<string, import('../src/types.js').Doc>} */
    const docs = {};
    for (const [name, t] of Object.entries(s.before)) docs[name] = parseOrg(t);
    const src = docs['notes.org'];
    const heading = /** @type {import('../src/types.js').Heading} */ (find(src.children, s.find));
    if (s.op === 'Toggle the archive tag on') archiveInPlace(heading, { now: nowNY() });
    else if (s.op === 'Refile') {
      const doc = docs[s.toFile || 'notes.org'];
      removeHeading(src, heading);
      const target = /** @type {import('../src/types.js').Heading} */ (find(doc.children, /** @type {string} */ (s.to)));
      appendRefiled(doc, target, heading);
    } else {
      const { filePart, headlinePart } = parseArchiveLocation(getArchiveLocation(src, heading));
      const targetId = resolveArchiveFileId(filePart, DIR + '/notes.org');
      const infile = targetId === null || targetId === DIR + '/notes.org';
      const clone = buildArchivedClone(src, heading, DIR + '/notes.org', { now: nowNY(), infile });
      removeHeading(src, heading);
      const name = targetId === null ? 'notes.org' : targetId.split('/').pop() || '';
      const created = !(name in docs);
      docs[name] ||= parseOrg('');
      insertAtArchiveLocation(docs[name], clone, headlinePart, { sourceFileId: DIR + '/notes.org', targetFileId: targetId ?? DIR + '/notes.org', created });
    }
    return Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, serializeOrg(d)]));
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

/** The text with the one difference left out: Emacs aligns the tags of a heading to a column, the app writes one space. @param {string} t */
function canon(t) {
  return t
    .split('\n')
    .map((l) => (/^\*+ /.test(l) ? l.replace(/\s+(:[^\s]+:)$/, ' $1') : l))
    .join('\n')
    .trimEnd();
}

for (const s of sections()) {
  test(`archive-refile.org: ${s.title}`, () => {
    const got = appResult(s);
    for (const name of Object.keys(s.after)) assert.equal(canon(got[name]), canon(s.after[name]), `${name}: ${s.title}`);
  });
}

test('archive-refile.org: Emacs aligns tags to a column, the app writes one space', () => {
  const [first] = sections();
  assert.match(first.after['notes.org_archive'], /File taxes {2,}:tax:\n/);
  assert.match(appResult(first)['notes.org_archive'], /File taxes :tax:\n/);
});

test('archive-refile.org: in place, only the tag is added', () => {
  const inPlace = sections().find((x) => x.op === 'Toggle the archive tag on');
  assert.ok(inPlace);
  assert.doesNotMatch(appResult(inPlace)['notes.org'], /ARCHIVE_TIME/);
});

test('archive-refile.org: restoring an archived subtree (the app only)', () => {
  const block = (/** @type {string} */ label) => unescape(new RegExp(label + ':\\n#\\+BEGIN_SRC org\\n([\\s\\S]*?)\\n#\\+END_SRC').exec(text)?.[1] || '') + '\n';
  const archived = parseOrg(block('Before, notes\\.org_archive').replace(/^(\* TODO .*)$/m, '$1'));
  const only = parseOrg('* x\n');
  only.children = [buildRestoredClone(archived.children[0])];
  assert.equal(serializeOrg(only), block('After, restored'));
});

test('archive-refile.org: restoring puts back the level, and takes off the tags the subtree took on from its parents', () => {
  const tags = sections().find((x) => x.title === 'Tags and category of the subtree');
  assert.ok(tags);
  const doc = parseOrg(appResult(tags)['notes.org']);
  const done = /** @type {import('../src/types.js').Heading} */ (find(doc.children, 'Done'));
  const archived = done.children[0];
  assert.deepEqual(archived.tags, ['office', 'work', 'tax', 'money']);
  const restored = buildRestoredClone(archived);
  assert.deepEqual(restored.tags, ['tax', 'money']);
  const q4 = /** @type {import('../src/types.js').Heading} */ (find(doc.children, 'Q4'));
  shiftLevels(restored, q4.level + 1);
  assert.equal(restored.level, 3);
});
