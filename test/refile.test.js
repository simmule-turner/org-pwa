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

test('parses a single explicit entry', () => {
  assert.deepEqual(parseRefileTargets('current maxlevel=3'), [{ fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] }]);
});

test('parses multiple semicolon-separated entries', () => {
  const result = parseRefileTargets('current maxlevel=3; notes.org maxlevel=2; agenda-files level=1');
  assert.deepEqual(result, [
    { fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] },
    { fileSpec: 'notes.org', criteria: [{ kind: 'maxlevel', n: 2 }] },
    { fileSpec: 'agenda-files', criteria: [{ kind: 'level', n: 1 }] },
  ]);
});

test('extra whitespace around entries and the semicolon separator is tolerated', () => {
  const result = parseRefileTargets('  current maxlevel=3  ;   notes.org level=1  ');
  assert.deepEqual(result, [
    { fileSpec: 'current', criteria: [{ kind: 'maxlevel', n: 3 }] },
    { fileSpec: 'notes.org', criteria: [{ kind: 'level', n: 1 }] },
  ]);
});

test('an entry missing its level/maxlevel qualifier is skipped, not defaulted -- matching real org\u2019s own stricter per-entry requirement', () => {
  const result = parseRefileTargets('current; notes.org maxlevel=2');
  assert.deepEqual(result, [{ fileSpec: 'notes.org', criteria: [{ kind: 'maxlevel', n: 2 }] }]);
});

test('a completely malformed entry is silently skipped rather than throwing', () => {
  const result = parseRefileTargets('this is nonsense; notes.org level=1');
  assert.deepEqual(result, [{ fileSpec: 'notes.org', criteria: [{ kind: 'level', n: 1 }] }]);
});

test('an empty entry between two semicolons (e.g. a trailing semicolon) doesn\u0027t produce a phantom entry', () => {
  assert.deepEqual(parseRefileTargets('current level=1;'), [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]);
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
  const targetsSpec = parseRefileTargets('agenda-files level=2');
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

test('tag=: only headings carrying that tag themselves -- inheritance is NOT considered', () => {
  // "Beta" sits under "Projects :work:" but has no :work: of its own
  assert.deepEqual(pathsFor('current tag=work'), ['Projects', 'Projects / Alpha', 'Projects / Alpha / Alpha step']);
});

test('tag= is case-sensitive', () => {
  assert.deepEqual(pathsFor('current tag=Work'), []);
});

test('todo=: the headline\u2019s keyword must equal it exactly, a DONE keyword included', () => {
  assert.deepEqual(pathsFor('current todo=TODO'), ['Projects / Alpha', 'Home / Garden']);
  assert.deepEqual(pathsFor('current todo=DONE'), ['Projects / Beta']);
  assert.deepEqual(pathsFor('current todo=todo'), []);
});

test('regexp=: matched against the headline line as written, stars, keyword, priority and tags included', () => {
  assert.deepEqual(pathsFor('current regexp=^\\*\\* TODO \\[#A\\]'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('current regexp=:urgent:$'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('current regexp=Garden\\|Kitchen'), ['Home / Garden', 'Home / Kitchen']);
});

test('regexp= is case-sensitive and keeps its spaces (it takes the rest of the entry)', () => {
  assert.deepEqual(pathsFor('current regexp=alpha'), []);
  assert.deepEqual(pathsFor('current regexp=TODO  *\\[#A\\] Alpha'), ['Projects / Alpha']);
});

test('several criteria on one entry must ALL match', () => {
  assert.deepEqual(pathsFor('current tag=work level=2'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('current tag=work maxlevel=2 todo=TODO'), ['Projects / Alpha']);
  assert.deepEqual(pathsFor('current level=2 regexp=Garden'), ['Home / Garden']);
  assert.deepEqual(pathsFor('current tag=personal todo=NEXT'), []);
});

test('separate entries are still a union', () => {
  assert.deepEqual(pathsFor('current tag=personal level=1; current todo=DONE'), ['Home', 'Projects / Beta']);
});

test('a candidate nested under a non-matching heading is still found', () => {
  assert.deepEqual(pathsFor('current todo=NEXT'), ['Projects / Alpha / Alpha step']);
});

test('the refiled heading and its own subtree are still excluded', () => {
  const { entries } = parseRefileTargetsWithErrors('current tag=work');
  const alpha = CRIT_DOC.children[0].children[0];
  const paths = getRefileCandidates(entries, { 'x.org': CRIT_DOC }, 'x.org', [], alpha).map((c) => c.outlinePath.join(' / '));
  assert.deepEqual(paths, ['Projects']);
});

test('a literal semicolon inside a regexp is written \\; and does not split the entry', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('current regexp=a\\;b; notes.org level=1');
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].criteria[0].source, 'a\\;b');
  assert.ok(entries[0].criteria[0].regex.test('a;b'));
  assert.equal(entries[1].fileSpec, 'notes.org');
});

test('an escaped backslash before a semicolon does not swallow the separator', () => {
  const { entries } = parseRefileTargetsWithErrors('current regexp=x\\\\; notes.org level=1');
  assert.equal(entries.length, 2);
});

test('the criteria order is preserved, and regexp last keeps everything after it', () => {
  const { entries } = parseRefileTargetsWithErrors('current tag=work maxlevel=2 regexp=a b  c');
  assert.deepEqual(entries[0].criteria.map((c) => c.kind), ['tag', 'maxlevel', 'regexp']);
  assert.equal(entries[0].criteria[2].source, 'a b  c');
});

// ---- errors are reported, not silently dropped ------------------------------

function errorsFor(spec) {
  return parseRefileTargetsWithErrors(spec).errors;
}

test('an entry with no criterion is reported', () => {
  const [e] = errorsFor('current');
  assert.equal(e.entry, 'current');
  assert.match(e.message, /at least one criterion/);
});

test('an unknown criterion is reported by name', () => {
  assert.match(errorsFor('current lvl=2')[0].message, /unknown criterion "lvl"/);
});

test('a non-numeric level is reported', () => {
  assert.match(errorsFor('current level=x')[0].message, /whole number/);
});

test('an empty value is reported', () => {
  assert.match(errorsFor('current tag=')[0].message, /tag= needs a value/);
  assert.match(errorsFor('current regexp=')[0].message, /regexp= needs a value/);
});

test('a token that is not key=value is reported', () => {
  assert.match(errorsFor('current maxlevel=2 stray')[0].message, /"stray" isn't a criterion/);
});

test('an entry that starts with a criterion (file forgotten) is reported', () => {
  assert.match(errorsFor('level=2')[0].message, /expected a file first/);
});

test('a regexp that does not compile is reported with the reason, and the entry is skipped', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('current regexp=\\(; notes.org level=1');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /isn't valid/);
  assert.deepEqual(entries.map((e) => e.fileSpec), ['notes.org']);
});

test('good entries survive next to bad ones, and every bad one is reported once', () => {
  const { entries, errors } = parseRefileTargetsWithErrors('current level=1; junk; notes.org tag=a; other.org lvl=1');
  assert.deepEqual(entries.map((e) => e.fileSpec), ['current', 'notes.org']);
  assert.deepEqual(errors.map((e) => e.entry), ['junk', 'other.org lvl=1']);
});

test('valid and unset values report no errors', () => {
  assert.deepEqual(errorsFor(''), []);
  assert.deepEqual(errorsFor('current maxlevel=3; notes.org tag=work level=2'), []);
});
