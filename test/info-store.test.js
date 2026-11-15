import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyName, composeDir, dirEntriesOf, dirManual, dirSections, groupFiles, manualOf, readInfoBytes, recordOf } from '../src/info-store.js';
import { InfoSession, breadcrumbs, parseGotoSpec, searchRegExp } from '../src/info-nav.js';
import { parseInfoLink } from '../src/info-link.js';
import { resolveLinkTarget } from '../src/link-resolve.js';

const DIR = new URL('./fixtures/info/', import.meta.url).pathname;
/** @param {string} name @param {string} [as] */
async function picked(name, as = name) {
  const bytes = new Uint8Array(fs.readFileSync(DIR + name));
  const { text, encoding } = await readInfoBytes(bytes);
  return { name: as, text, encoding, size: bytes.length };
}

test('classifyName: the manual a file belongs to, its part number, whether it is compressed', () => {
  assert.deepEqual(classifyName('elisp.info-12.gz'), { base: 'elisp', part: 12, compressed: true });
  assert.deepEqual(classifyName('org.info'), { base: 'org', part: null, compressed: false });
  assert.deepEqual(classifyName('make.info.gz'), { base: 'make', part: null, compressed: true });
});

test('groupFiles: a split manual is ready only with every part its main file names', async () => {
  const [main, one, two, three] = await Promise.all(['sample-split.info', 'sample-split.info-1', 'sample-split.info-2', 'sample-split.info-3'].map((n) => picked(n)));
  const missing = groupFiles([main, one, two]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].status, 'incomplete');
  assert.deepEqual(missing[0].missing, ['sample-split.info-3']);
  assert.equal(groupFiles([three, two, one, main])[0].status, 'ready');
  const lone = groupFiles([two])[0];
  assert.equal(lone.status, 'incomplete');
  assert.match(lone.note, /Add sample-split\.info and the other parts/);
});

test('groupFiles: separate manuals chosen together are grouped apart; compressed parts count', async () => {
  const groups = groupFiles([await picked('sample.info'), await picked('zsplit.info.gz'), await picked('zsplit.info-1.gz'), await picked('zsplit.info-2.gz')]);
  assert.deepEqual(groups.map((g) => [g.base, g.status]).sort(), [['sample', 'ready'], ['zsplit', 'ready']]);
});

test('groupFiles: a file that is not Info is invalid', () => {
  const [g] = groupFiles([{ name: 'notes.info', text: 'just text', encoding: 'utf-8', size: 9 }]);
  assert.equal(g.status, 'invalid');
});

test('recordOf and manualOf: a stored manual opens as the manual it was', async () => {
  const group = groupFiles([await picked('sample-split.info'), await picked('sample-split.info-1'), await picked('sample-split.info-2'), await picked('sample-split.info-3')])[0];
  const record = recordOf(group, 7);
  assert.equal(record.name, 'sample-split');
  assert.equal(record.added, 7);
  assert.equal(record.title, 'Sample');
  assert.deepEqual(dirEntriesOf(group.files[0].text).map((e) => e.section), ['Software development', 'Software development']);
  const manual = manualOf(JSON.parse(JSON.stringify(record)));
  assert.equal(manual.findNode('Top').name, 'Top');
});

test('composeDir and dirSections: the directory lists each manual under the section it names', async () => {
  const group = groupFiles([await picked('sample.info')])[0];
  const record = recordOf(group, 1);
  const text = composeDir([record]);
  assert.match(text, /\nSoftware development\n\* Sample/);
  const sections = dirSections(dirManual([record]).findNode('Top').text);
  assert.equal(sections[0].heading, 'Software development');
  const sample = sections[0].entries.find((e) => e.file === 'sample');
  assert.deepEqual([sample.name, sample.node], ['Sample', 'Top']);
});

test('parseGotoSpec: (manual)node, a node alone, a manual alone', () => {
  assert.deepEqual(parseGotoSpec('(elisp)Top'), { file: 'elisp', node: 'Top' });
  assert.deepEqual(parseGotoSpec('Foo'), { file: '', node: 'Foo' });
  assert.deepEqual(parseGotoSpec('(x)'), { file: 'x', node: '' });
});

test('searchRegExp: a blank in the pattern matches any run of blanks, as Info-search does', () => {
  assert.ok(searchRegExp('a b', true).test('a \t b'));
  assert.ok(!searchRegExp('a b', true).test('a\nb'.replace('\n', 'x')));
  assert.ok(!searchRegExp('abc', false).test('ABC'));
});

test('breadcrumbs: the ancestors of a node, from (manual)Top', async () => {
  const manual = manualOf(recordOf(groupFiles([await picked('sample.info')])[0], 1));
  assert.equal(breadcrumbs(manual, 'sample.info', 'Top'), '(sample)Top\n');
  assert.equal(breadcrumbs(manual, 'sample.info', 'Formulas'), '(sample)Top > Tables > Formulas\n');
});

test('InfoSession: next, up, back and a menu entry move as in Info', async () => {
  const manual = manualOf(recordOf(groupFiles([await picked('sample.info')])[0], 1));
  const s = new InfoSession({ resolve: (name) => (name === 'dir' ? null : manual) });
  s.find('sample.info', 'Top');
  s.next();
  assert.equal(s.name, 'Basics');
  s.up();
  assert.equal(s.name, 'Top');
  s.menu('Tables');
  assert.equal(s.name, 'Tables');
  s.historyBack();
  assert.equal(s.name, 'Top');
  assert.throws(() => s.up(), /dir/);
});

test('parseInfoLink and resolveLinkTarget: info:manual#node, info:manual:node, info:manual, info:', () => {
  assert.deepEqual(parseInfoLink('org#Tables'), { manual: 'org', node: 'Tables' });
  assert.deepEqual(parseInfoLink('elisp:Top'), { manual: 'elisp', node: 'Top' });
  assert.deepEqual(parseInfoLink('elisp::Variables'), { manual: 'elisp', node: 'Variables' });
  assert.deepEqual(parseInfoLink(' elisp '), { manual: 'elisp', node: 'Top' });
  assert.deepEqual(parseInfoLink(''), { manual: 'dir', node: 'Top' });
  assert.deepEqual(resolveLinkTarget(null, 'info:org#Tables'), { type: 'info', manual: 'org', node: 'Tables' });
});
