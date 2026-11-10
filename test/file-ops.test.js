import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, compileFind, findMatches, freeName, isInside, marking, movedPath, openConflicts, planTransfer, sizeLabel, targets, validName } from '../src/file-ops.js';

const f = (name, extra = {}) => ({ name, path: `d/${name}`, type: 'file', ...extra });
const d = (name) => ({ name, path: `d/${name}`, type: 'dir' });

test('Find matches an Emacs regexp against the file name, folding case like Emacs, and only files', () => {
  const all = [f('a.org'), f('B.ORG'), f('c.el'), f('d.elc'), f('notes_archive'), d('sub.org'), { name: 'e.org', path: 'sub/deep/e.org', type: 'file' }];
  const names = (re) => findMatches(all, re).map((e) => e.name);
  assert.deepEqual(names('\\.org\\\''), ['a.org', 'B.ORG', 'e.org']);
  assert.deepEqual(names('\\.org$'), ['a.org', 'B.ORG', 'e.org']);
  assert.deepEqual(names('\\.\\(org\\|el\\)$'), ['a.org', 'B.ORG', 'c.el', 'e.org']);
  assert.deepEqual(names('\\.(org|el)$'), [], 'unescaped parentheses are literal text in Emacs');
  assert.deepEqual(names('^c'), ['c.el']);
  assert.deepEqual(names(''), ['a.org', 'B.ORG', 'c.el', 'd.elc', 'notes_archive', 'e.org']);
  assert.deepEqual(names('sub'), [], 'a folder name is not a file name');
});

test('Find refuses a regexp Emacs would refuse and says why', () => {
  assert.equal(findMatches([f('a.org')], '\\('), null);
  assert.match(compileFind('\\(').error, /./);
  assert.equal(typeof compileFind('a').test, 'function');
});

test('sorting keeps folders first; date and size put the newest and biggest first, unknown last', () => {
  const rows = [f('b.org', { modified: 2, size: 5 }), f('a.org', { modified: 1, size: 9 }), f('c.org'), d('z'), d('y')];
  assert.deepEqual(arrange(rows, 'name').map((e) => e.name), ['y', 'z', 'a.org', 'b.org', 'c.org']);
  assert.deepEqual(arrange(rows, 'date').map((e) => e.name), ['y', 'z', 'b.org', 'a.org', 'c.org']);
  assert.deepEqual(arrange(rows, 'size').map((e) => e.name), ['y', 'z', 'a.org', 'b.org', 'c.org']);
  assert.deepEqual(arrange(rows, 'name', true).map((e) => e.name).slice(0, 2), ['z', 'y']);
  assert.deepEqual(arrange([f('f10.org'), f('f9.org')], 'name').map((e) => e.name), ['f9.org', 'f10.org']);
});

test('marks: toggle, invert, regexp (case-folded, on the name), clear', () => {
  const rows = [f('a.org'), f('B.org'), f('c.md')];
  let m = marking.toggleOne(new Set(), 'd/a.org');
  assert.deepEqual([...m], ['d/a.org']);
  m = marking.invert(m, rows);
  assert.deepEqual([...m].sort(), ['d/B.org', 'd/c.md']);
  m = marking.byRegexp(new Set(), rows, '^b');
  assert.deepEqual([...m], ['d/B.org']);
  assert.equal(marking.byRegexp(new Set(), rows, '('), null);
  assert.equal(marking.clear().size, 0);
});

test('targets: the marked files, or the one at point when nothing is marked', () => {
  const rows = [f('a.org'), f('b.org')];
  assert.deepEqual(targets(new Set(['d/b.org']), rows, rows[0]).map((e) => e.name), ['b.org']);
  assert.deepEqual(targets(new Set(), rows, rows[0]).map((e) => e.name), ['a.org']);
  assert.deepEqual(targets(new Set(), rows), []);
});

test('a transfer plan finds clashes, skips a file onto itself and a folder into itself', () => {
  const items = [f('a.org'), f('b.org'), d('sub')];
  const p = planTransfer(items, 'other', [f('b.org')], { samePlace: true });
  assert.deepEqual(p.moves.map((m) => [m.to, m.clash]), [['other/a.org', false], ['other/b.org', true], ['other/sub', false]]);
  const q = planTransfer(items, 'd', [], { samePlace: true });
  assert.deepEqual(q.same.map((e) => e.name), ['a.org', 'b.org', 'sub']);
  const r = planTransfer([d('sub')], 'd/sub/deeper', [], { samePlace: true });
  assert.deepEqual(r.intoSelf.map((e) => e.name), ['sub']);
  const s = planTransfer([d('sub')], 'd/sub', [], { samePlace: false });
  assert.equal(s.moves.length, 1, 'another place: nothing is "itself"');
});

test('free names, valid names, inside', () => {
  assert.equal(freeName('a.org', new Set(['a.org', 'a (2).org'])), 'a (3).org');
  assert.equal(freeName('a.org', new Set()), 'a.org');
  assert.equal(freeName('.hidden', new Set(['.hidden'])), '.hidden (2)');
  assert.equal(validName('a b.org'), true);
  assert.equal(validName('a/b'), false);
  assert.equal(validName('..'), false);
  assert.equal(validName('  '), false);
  assert.equal(isInside('d', 'd/x/y'), true);
  assert.equal(isInside('d', 'dd/x'), false);
});

test('open files: unsaved ones refuse a delete, saved ones are asked about; a folder takes what is below', () => {
  const open = [{ path: 'd/a.org', dirty: true }, { path: 'd/sub/b.org', dirty: false }, { path: 'e/c.org', dirty: true }];
  assert.deepEqual(openConflicts(['d/a.org'], open), { refuse: ['d/a.org'], ask: [] });
  assert.deepEqual(openConflicts(['d'], open), { refuse: ['d/a.org'], ask: ['d/sub/b.org'] });
  assert.deepEqual(openConflicts(['x'], open), { refuse: [], ask: [] });
});

test('a renamed folder renames the paths of the files open below it', () => {
  assert.equal(movedPath('d/a.org', 'd/a.org', 'd/z.org'), 'd/z.org');
  assert.equal(movedPath('d/sub/b.org', 'd/sub', 'n/sub'), 'n/sub/b.org');
  assert.equal(movedPath('d/subx/b.org', 'd/sub', 'n/sub'), null);
});

test('size labels', () => {
  assert.equal(sizeLabel(812), '812 B');
  assert.equal(sizeLabel(4300), '4.2 KB');
  assert.equal(sizeLabel(5 * 1024 * 1024), '5.0 MB');
  assert.equal(sizeLabel(undefined), '');
});
