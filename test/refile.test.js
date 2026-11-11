import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseRefileTargets, parseRefileTargetsWithErrors, resolveEntryFileIds, getRefileCandidates, findHeadingByOutlinePath } from '../src/refile.js';

// ---- parseRefileTargets ----------------------------------------------------

test('an unset (empty) value defaults to current file, level 1 -- matching real org\u2019s own documented nil-default exactly', () => {
  assert.deepEqual(parseRefileTargets(''), [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]);
  assert.deepEqual(parseRefileTargets(null), [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]);
  assert.deepEqual(parseRefileTargets(undefined), [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]);
  assert.deepEqual(parseRefileTargets('   '), [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]);
});

test('parses a single explicit entry, with or without the leading quote', () => {
  assert.deepEqual(parseRefileTargets('((nil :maxlevel . 3))'), [{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] }]);
  assert.deepEqual(parseRefileTargets("'((nil :maxlevel . 3))"), [{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] }]);
});

test('parses several entries: nil, org-agenda-files, a file name, a list of file names', () => {
  const result = parseRefileTargets('((nil :maxlevel . 3) ("notes.org" :maxlevel . 2) (org-agenda-files :level . 1) (("a.org" "b.org") :tag . "x"))');
  assert.deepEqual(result, [
    { fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] },
    { fileSpec: 'notes.org', criteria: [{ kind: 'maxlevel', n: 2 }] },
    { fileSpec: 'agenda-files', criteria: [{ kind: 'level', n: 1 }] },
    { fileSpec: 'a.org', criteria: [{ kind: 'tag', name: 'x' }] },
    { fileSpec: 'b.org', criteria: [{ kind: 'tag', name: 'x' }] },
  ]);
});

test('whitespace, newlines and comments between entries are tolerated', () => {
  const result = parseRefileTargets('(\n  (nil :maxlevel . 3) ; the current file\n  ("notes.org" :level . 1)\n)');
  assert.equal(result.length, 2);
});

test('the old text syntax is reported, not guessed at', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('current maxlevel=3; notes.org level=1');
  assert.deepEqual(entries, []);
  assert.match(errors[0].message, /list of \(FILES :KEY \. VALUE\)/);
});

// ---- resolveEntryFileIds ----------------------------------------------------

test('resolveEntryFileIds: "current" resolves to the current file only', () => {
  assert.deepEqual(resolveEntryFileIds({ fileSpec: 'current' }, 'notes.org', []), ['notes.org']);
});

test('THE EXACT REQUEST: "agenda-files" resolves to the configured Agenda Files list, with the "scheme:" prefix stripped -- confirmed as the actual root cause of a real, reported bug: agendaFilesConfig\u2019s own raw entries are "scheme:path" strings, but every document lookup throughout the app (docsById\u2019s own keys in particular) uses the bare path only, so returning the prefixed strings verbatim meant every "agenda-files" refile-target lookup silently found nothing at all', () => {
  assert.deepEqual(
    resolveEntryFileIds({ fileSpec: 'agenda-files' }, 'notes.org', ['github:work.org', 'webdav:personal.org']),
    ['work.org', 'personal.org']
  );
});

test('resolveEntryFileIds: "agenda-files" with none configured resolves to an empty list, not an error', () => {
  assert.deepEqual(resolveEntryFileIds({ fileSpec: 'agenda-files' }, 'notes.org', []), []);
  assert.deepEqual(resolveEntryFileIds({ fileSpec: 'agenda-files' }, 'notes.org', undefined), []);
});

test('resolveEntryFileIds: a bare filename resolves as a SIBLING of the current file (no "/"), matching resolveCaptureFileId exactly', () => {
  assert.deepEqual(resolveEntryFileIds({ fileSpec: 'archive.org' }, 'projects/notes.org', []), ['projects/archive.org']);
});

test('resolveEntryFileIds: a path containing "/" is used as-is, not resolved relative to the current file', () => {
  assert.deepEqual(resolveEntryFileIds({ fileSpec: 'other/team.org' }, 'projects/notes.org', []), ['other/team.org']);
});

// ---- getRefileCandidates ----------------------------------------------------

const SAMPLE_DOC = parseOrg('* Project A\n** Task A1\n*** Subtask A1a\n* Project B\n** Task B1\n');

test('level: only exactly matching headings become candidates', () => {
  const candidates = getRefileCandidates([{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }], { 'x.org': SAMPLE_DOC }, 'x.org', []);
  assert.deepEqual(
    candidates.map((c) => c.outlinePath.join(' / ')),
    ['Project A', 'Project B']
  );
});

test('maxlevel: this level and everything shallower become candidates, but not deeper', () => {
  const candidates = getRefileCandidates([{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 2 }] }], { 'x.org': SAMPLE_DOC }, 'x.org', []);
  assert.deepEqual(
    candidates.map((c) => c.outlinePath.join(' / ')),
    ['Project A', 'Project A / Task A1', 'Project B', 'Project B / Task B1']
  );
});

test('a heading deeper than maxlevel is correctly excluded, but its shallower descendants underneath a non-matching ancestor still aren\u0027t reachable (since maxlevel bounds the whole tree, not per-branch)', () => {
  const candidates = getRefileCandidates([{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 2 }] }], { 'x.org': SAMPLE_DOC }, 'x.org', []);
  assert.ok(!candidates.some((c) => c.outlinePath.join(' / ').includes('Subtask A1a')));
});

test('THE EXACT REQUEST: "agenda-files level=2" finds candidates across both configured agenda files, end to end, with realistic "scheme:path" config -- exactly the reported scenario', () => {
  const contactsDoc = parseOrg('* Contacts\n** Jane\n** Bob\n');
  const journalDoc = parseOrg('* Journal\n** Entry 1\n');
  const agendaFilesConfig = ['github:contacts.org', 'github:journal.org'];
  const targetsSpec = parseRefileTargets('((org-agenda-files :level . 2))');
  const docsById = { 'contacts.org': contactsDoc, 'journal.org': journalDoc };
  const candidates = getRefileCandidates(targetsSpec, docsById, 'main.org', agendaFilesConfig);
  assert.deepEqual(
    candidates.map((c) => `${c.documentId} / ${c.outlinePath.join(' / ')}`),
    ['contacts.org / Contacts / Jane', 'contacts.org / Contacts / Bob', 'journal.org / Journal / Entry 1']
  );
});

test('excludeHeading: the heading itself and its own descendants are excluded, unrelated headings are not', () => {
  const projectA = SAMPLE_DOC.children[0];
  const candidates = getRefileCandidates(
    [{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] }],
    { 'x.org': SAMPLE_DOC },
    'x.org',
    [],
    projectA
  );
  assert.deepEqual(
    candidates.map((c) => c.outlinePath.join(' / ')),
    ['Project B', 'Project B / Task B1']
  );
});

test('excludeHeading: excluding a leaf heading only removes that one heading, not its ancestors or siblings', () => {
  const taskA1 = SAMPLE_DOC.children[0].children[0];
  const candidates = getRefileCandidates(
    [{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] }],
    { 'x.org': SAMPLE_DOC },
    'x.org',
    [],
    taskA1
  );
  const paths = candidates.map((c) => c.outlinePath.join(' / '));
  assert.ok(paths.includes('Project A')); // the ancestor is still a valid candidate
  assert.ok(!paths.includes('Project A / Task A1')); // the excluded heading itself is gone
  assert.ok(!paths.includes('Project A / Task A1 / Subtask A1a')); // and its own descendant too
});

test('a file-spec resolving to a document not present in docsById is silently skipped, not an error', () => {
  const candidates = getRefileCandidates([{ fileSpec: 'missing.org', criteria: [{ kind: 'level', n: 1 }] }], { 'x.org': SAMPLE_DOC }, 'x.org', []);
  assert.deepEqual(candidates, []);
});

test('multiple entries are combined -- candidates from each entry all appear', () => {
  const otherDoc = parseOrg('* Other Project\n');
  const candidates = getRefileCandidates(
    [
      { fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] },
      { fileSpec: 'other.org', criteria: [{ kind: 'level', n: 1 }] },
    ],
    { 'x.org': SAMPLE_DOC, 'other.org': otherDoc },
    'x.org',
    []
  );
  const paths = candidates.map((c) => `${c.documentId}: ${c.outlinePath.join(' / ')}`);
  assert.ok(paths.includes('x.org: Project A'));
  assert.ok(paths.includes('other.org: Other Project'));
});

test('the same heading matched by more than one entry (e.g. two overlapping specs on the same file) only appears once', () => {
  const candidates = getRefileCandidates(
    [
      { fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 1 }] },
      { fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] },
    ],
    { 'x.org': SAMPLE_DOC },
    'x.org',
    []
  );
  const projectACount = candidates.filter((c) => c.outlinePath.join(' / ') === 'Project A').length;
  assert.equal(projectACount, 1);
});

test('an empty document (no headings at all) produces no candidates, not an error', () => {
  const emptyDoc = parseOrg('');
  const candidates = getRefileCandidates([{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }], { 'x.org': emptyDoc }, 'x.org', []);
  assert.deepEqual(candidates, []);
});

// ---- findHeadingByOutlinePath -----------------------------------------------

test('finds a top-level heading by a single-element path', () => {
  const found = findHeadingByOutlinePath(SAMPLE_DOC, ['Project A']);
  assert.equal(found, SAMPLE_DOC.children[0]);
});

test('finds a nested heading by its full path', () => {
  const found = findHeadingByOutlinePath(SAMPLE_DOC, ['Project A', 'Task A1', 'Subtask A1a']);
  assert.equal(found, SAMPLE_DOC.children[0].children[0].children[0]);
});

test('returns null when the path doesn\u0027t match anything (e.g. a heading was renamed or removed since)', () => {
  assert.equal(findHeadingByOutlinePath(SAMPLE_DOC, ['Nonexistent Heading']), null);
});

test('returns null when a valid PREFIX exists but the full path doesn\u0027t (e.g. the leaf title changed)', () => {
  assert.equal(findHeadingByOutlinePath(SAMPLE_DOC, ['Project A', 'Nonexistent Child']), null);
});

test('an empty path returns null, not the document root itself', () => {
  assert.equal(findHeadingByOutlinePath(SAMPLE_DOC, []), null);
});

test('correctly distinguishes two headings with the same title at different positions in the tree', () => {
  const doc = parseOrg('* Parent 1\n** Shared Title\n* Parent 2\n** Shared Title\n');
  const found = findHeadingByOutlinePath(doc, ['Parent 2', 'Shared Title']);
  assert.equal(found, doc.children[1].children[0]);
  assert.notEqual(found, doc.children[0].children[0]);
});

// ---- tag= / todo= / regexp= and combined criteria ---------------------------

const CRIT_DOC = parseOrg([
  '#+TODO: TODO NEXT | DONE',
  '* Projects :work:',
  '** TODO [#A] Alpha :work:urgent:',
  '*** NEXT Alpha step :work:',
  '** DONE Beta',
  '* Home :personal:',
  '** TODO Garden :personal:',
  '** Kitchen',
  '',
].join('\n'));

function pathsFor(spec) {
  const { entries, errors } = parseRefileTargetsWithErrors(spec);
  assert.deepEqual(errors, [], `unexpected errors for ${spec}`);
  return getRefileCandidates(entries, { 'x.org': CRIT_DOC }, 'x.org', []).map((c) => c.outlinePath.join(' / '));
}

test(':tag: only headings carrying that tag themselves -- inheritance is NOT considered', () => {
  // "Beta" sits under "Projects :work:" but has no :work: of its own
  assert.deepEqual(pathsFor('((nil :tag . "work"))'), ['Projects', 'Projects / Alpha', 'Projects / Alpha / Alpha step']);
});

test(':tag is case-sensitive', () => {
  assert.deepEqual(pathsFor('((nil :tag . "Work"))'), []);
});

test(':todo: the headline\u2019s keyword must equal it exactly, a DONE keyword included', () => {
  assert.deepEqual(pathsFor('((nil :todo . "TODO"))'), ['Projects / Alpha', 'Home / Garden']);
  assert.deepEqual(pathsFor('((nil :todo . "DONE"))'), ['Projects / Beta']);
  assert.deepEqual(pathsFor('((nil :todo . "todo"))'), []);
});

test(':regexp: matched against the headline line as written, stars, keyword, priority and tags included', () => {
  assert.deepEqual(pathsFor('((nil :regexp . "^\\\\*\\\\* TODO \\\\[#A\\\\]"))'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('((nil :regexp . ":urgent:$"))'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('((nil :regexp . "Garden\\\\|Kitchen"))'), ['Home / Garden', 'Home / Kitchen']);
});

test(':regexp is case-sensitive and keeps its spaces', () => {
  assert.deepEqual(pathsFor('((nil :regexp . "alpha"))'), []);
  assert.deepEqual(pathsFor('((nil :regexp . "TODO  *\\\\[#A\\\\] Alpha"))'), ['Projects / Alpha']);
});

test('separate entries are a union', () => {
  assert.deepEqual(pathsFor('((nil :level . 1) (nil :todo . "DONE"))'), ['Projects', 'Home', 'Projects / Beta']);
});

test('a candidate nested under a non-matching heading is still found', () => {
  assert.deepEqual(pathsFor('((nil :todo . "NEXT"))'), ['Projects / Alpha / Alpha step']);
});

test('the refiled heading and its own subtree are still excluded', () => {
  const { entries } = parseRefileTargetsWithErrors('((nil :tag . "work"))');
  const alpha = CRIT_DOC.children[0].children[0];
  const paths = getRefileCandidates(entries, { 'x.org': CRIT_DOC }, 'x.org', [], alpha).map((c) => c.outlinePath.join(' / '));
  assert.deepEqual(paths, ['Projects']);
});

test('a regexp keeps its backslashes and semicolons', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('((nil :regexp . "a;b") ("notes.org" :level . 1))');
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].criteria[0].source, 'a;b');
  assert.ok(entries[0].criteria[0].regex.test('a;b'));
  assert.equal(entries[1].fileSpec, 'notes.org');
});

// ---- errors are reported, not silently dropped ------------------------------

function errorsFor(spec) {
  return parseRefileTargetsWithErrors(spec).errors;
}

test('an entry with no key is reported', () => {
  const [e] = errorsFor('((nil))');
  assert.equal(e.entry, '(nil)');
  assert.match(e.message, /\(FILES :KEY \. VALUE\)/);
});

test('a proper list instead of the dotted pair is reported', () => {
  assert.match(errorsFor('((nil :level 2))')[0].message, /\(FILES :KEY \. VALUE\)/);
});

test('an unknown key is reported by name', () => {
  assert.match(errorsFor('((nil :lvl . 2))')[0].message, /the key :lvl is not known/);
});

test('a non-numeric level and a non-string tag are reported', () => {
  assert.match(errorsFor('((nil :level . "x"))')[0].message, /whole number/);
  assert.match(errorsFor('((nil :tag . 3))')[0].message, /:tag needs a string/);
  assert.match(errorsFor('((nil :tag . ""))')[0].message, /:tag needs a string/);
});

test('a variable other than org-agenda-files, and a function, are reported', () => {
  assert.match(errorsFor('((my-files :level . 1))')[0].message, /the variable my-files is not known/);
  assert.match(errorsFor('(((lambda () nil) :level . 1))')[0].message, /are not nil/);
});

test('a regexp that does not compile is reported with the reason, and the entry is skipped', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('((nil :regexp . "\\\\(") ("notes.org" :level . 1))');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /isn't valid/);
  assert.deepEqual(entries.map((e) => e.fileSpec), ['notes.org']);
});

test('good entries survive next to bad ones, and every bad one is reported once', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('((nil :level . 1) junk ("notes.org" :tag . "a") ("other.org" :lvl . 1))');
  assert.deepEqual(entries.map((e) => e.fileSpec), ['current', 'notes.org']);
  assert.deepEqual(errors.map((e) => e.entry), ['junk', '("other.org" :lvl . 1)']);
});

test('valid and unset values report no errors', () => {
  assert.deepEqual(errorsFor(''), []);
  assert.deepEqual(errorsFor('nil'), []);
  assert.deepEqual(errorsFor('((nil :maxlevel . 3) ("notes.org" :tag . "work"))'), []);
});

// ---- recently used targets ----------------------------------------------------

import { pushRecentRefileTarget, recentRefileCandidates } from '../src/refile.js';

const cand = (documentId, ...path) => ({ documentId, outlinePath: path, heading: { title: path[path.length - 1] } });

test('pushRecentRefileTarget: newest first, de-duplicated, capped', () => {
  let recent = [];
  recent = pushRecentRefileTarget(recent, cand('a.org', 'Projects'));
  recent = pushRecentRefileTarget(recent, cand('a.org', 'Home'));
  recent = pushRecentRefileTarget(recent, cand('a.org', 'Projects'));
  assert.deepEqual(recent.map((r) => r.outlinePath.join('/')), ['Projects', 'Home']);
  for (let i = 0; i < 20; i++) recent = pushRecentRefileTarget(recent, cand('a.org', 'T' + i));
  assert.equal(recent.length, 8);
  assert.equal(recent[0].outlinePath[0], 'T19');
});

test('the same heading title in a different file is a different target', () => {
  let recent = pushRecentRefileTarget([], cand('a.org', 'Inbox'));
  recent = pushRecentRefileTarget(recent, cand('b.org', 'Inbox'));
  assert.equal(recent.length, 2);
});

test('pushRecentRefileTarget stores only what is needed and does not modify its input', () => {
  const before = [{ documentId: 'a.org', outlinePath: ['X'] }];
  const after = pushRecentRefileTarget(before, cand('a.org', 'Y'));
  assert.equal(before.length, 1);
  assert.deepEqual(Object.keys(after[0]).sort(), ['documentId', 'outlinePath']);
});

test('recentRefileCandidates: current candidates only, in recent-first order', () => {
  const candidates = [cand('a.org', 'Projects'), cand('a.org', 'Home'), cand('a.org', 'Inbox')];
  const recent = [
    { documentId: 'a.org', outlinePath: ['Inbox'] },
    { documentId: 'a.org', outlinePath: ['Gone'] }, // no longer a candidate
    { documentId: 'a.org', outlinePath: ['Projects'] },
  ];
  assert.deepEqual(recentRefileCandidates(candidates, recent).map((c) => c.outlinePath[0]), ['Inbox', 'Projects']);
});

test('a recent target is dropped when org-refile-targets no longer offers it', () => {
  const { entries } = parseRefileTargetsWithErrors('((nil :level . 1))');
  const candidates = getRefileCandidates(entries, { 'x.org': CRIT_DOC }, 'x.org', []);
  const recent = [{ documentId: 'x.org', outlinePath: ['Projects', 'Alpha'] }, { documentId: 'x.org', outlinePath: ['Home'] }];
  assert.deepEqual(recentRefileCandidates(candidates, recent).map((c) => c.outlinePath.join('/')), ['Home'], 'a level-2 heading is not a level=1 target');
});

test('recentRefileCandidates respects its limit, and an empty history gives nothing', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => cand('a.org', 'T' + i));
  const recent = candidates.map((c) => ({ documentId: c.documentId, outlinePath: c.outlinePath }));
  assert.equal(recentRefileCandidates(candidates, recent, 3).length, 3);
  assert.deepEqual(recentRefileCandidates(candidates, []), []);
});

// ---- local: --------------------------------------------------------------------------------------

test('a local: file in org-refile-targets is accepted, and its file id is the bare path, like github: and webdav:', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('(("local:inbox.org" :level . 2) ("local:areas/home.org" :level . 1))');
  assert.equal(errors.length, 0);
  assert.deepEqual(entries.map((e) => e.fileSpec), ['local:inbox.org', 'local:areas/home.org']);
  assert.deepEqual(resolveEntryFileIds(entries[0], 'notes.org', []), ['inbox.org']);
  assert.deepEqual(resolveEntryFileIds(entries[1], 'notes.org', []), ['areas/home.org']);
});

test('org-refile-targets unset or nil keeps the level-1 headings of this file, as Emacs does; text that cannot be read is an error', () => {
  for (const text of ['', '   ', 'nil']) {
    const { entries, errors } = parseRefileTargetsWithErrors(text);
    assert.deepEqual(errors, [], text);
    assert.deepEqual(entries, [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }], text);
  }
  const bad = parseRefileTargetsWithErrors('42');
  assert.deepEqual(bad.entries, []);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /org-refile-targets/);
});

test('org-refile-targets with unbalanced parentheses is an error with Emacs\'s words, not a list closed for you', () => {
  const r = parseRefileTargetsWithErrors('((nil :maxlevel . 3)');
  assert.deepEqual(r.entries, []);
  assert.equal(r.errors[0].message, 'org-refile-targets: End of file during parsing');
});
