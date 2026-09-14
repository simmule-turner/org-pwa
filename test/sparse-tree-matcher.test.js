import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchQuery, evaluateMatchQuery } from '../src/sparse-tree-matcher.js';

// Fixture mirroring the exact Emacs test fixture used for empirical
// verification: Alice (family, PRIORITY_TEST=A), Bob (work,
// PRIORITY_TEST=B), Carol (family+work), Dave (work+ex_colleague),
// Erin (no tags, PRIORITY_TEST=A).
const alice = { tags: ['family'], properties: { PRIORITY_TEST: 'A' }, level: 1 };
const bob = { tags: ['work'], properties: { PRIORITY_TEST: 'B' }, level: 1 };
const carol = { tags: ['family', 'work'], properties: {}, level: 1 };
const dave = { tags: ['work', 'ex_colleague'], properties: {}, level: 1 };
const erin = { tags: [], properties: { PRIORITY_TEST: 'A' }, level: 1 };
const all = { alice, bob, carol, dave, erin };

function matchNames(query, entries) {
  const parsed = parseMatchQuery(query);
  return Object.keys(entries).filter((name) => evaluateMatchQuery(parsed, entries[name]));
}

test('"family" matches Alice and Carol -- empirical: matcher "family" -> ("Alice" "Carol")', () => {
  assert.deepEqual(matchNames('family', all), ['alice', 'carol']);
});

test('"+family" produces the identical result to bare "family" -- empirical: both -> ("Alice" "Carol")', () => {
  assert.deepEqual(matchNames('+family', all), matchNames('family', all));
});

test('"work-ex_colleague" matches Bob and Carol, excludes Dave -- empirical: -> ("Bob" "Carol")', () => {
  assert.deepEqual(matchNames('work-ex_colleague', all), ['bob', 'carol']);
});

test('"work+ex_colleague" (AND) matches only Dave -- empirical: -> ("Dave")', () => {
  assert.deepEqual(matchNames('work+ex_colleague', all), ['dave']);
});

test('"family|work" (OR) matches everyone with either tag -- empirical: -> ("Alice" "Bob" "Carol" "Dave")', () => {
  assert.deepEqual(matchNames('family|work', all), ['alice', 'bob', 'carol', 'dave']);
});

test('property equality: PRIORITY_TEST="A" matches Alice and Erin -- empirical: -> ("Alice" "Erin")', () => {
  assert.deepEqual(matchNames('PRIORITY_TEST="A"', all), ['alice', 'erin']);
});

test('a tag condition AND a property condition together match only Bob -- empirical: work+PRIORITY_TEST="B" -> ("Bob")', () => {
  assert.deepEqual(matchNames('work+PRIORITY_TEST="B"', all), ['bob']);
});

test('"+family-work" matches Alice only, correctly excluding Carol who has both -- empirical: -> ("Alice")', () => {
  assert.deepEqual(matchNames('+family-work', all), ['alice']);
});

test('OR of two AND-groups: "+foo-bar|+family" -- empirical: -> ("Alice" "Carol") since nobody has foo', () => {
  assert.deepEqual(matchNames('+foo-bar|+family', all), ['alice', 'carol']);
});

test('TODO pseudo-property: TODO="NOTHING" matches nobody -- empirical: -> nil', () => {
  assert.deepEqual(matchNames('TODO="NOTHING"', all), []);
});

test('LEVEL pseudo-property: LEVEL=1 matches everyone in this fixture -- empirical: -> all five', () => {
  assert.deepEqual(matchNames('LEVEL="1"', all), ['alice', 'bob', 'carol', 'dave', 'erin']);
});

test('precedence: "family+work|ex_colleague" is (family AND work) OR (ex_colleague), matching Carol and Dave -- empirical: -> ("Carol" "Dave")', () => {
  assert.deepEqual(matchNames('family+work|ex_colleague', all), ['carol', 'dave']);
});

test('an empty query throws a clear error rather than silently matching everything or nothing', () => {
  assert.throws(() => parseMatchQuery(''), /empty/i);
  assert.throws(() => parseMatchQuery('   '), /empty/i);
});

test('an empty group next to a stray "|" throws a clear error', () => {
  assert.throws(() => parseMatchQuery('family|'), /empty group/i);
  assert.throws(() => parseMatchQuery('|family'), /empty group/i);
});

test('an unparseable condition throws a clear error naming where it failed', () => {
  assert.throws(() => parseMatchQuery('!!!'), /could not parse/i);
});

test('a numeric comparison compares numerically, not lexicographically', () => {
  const low = { tags: [], properties: { COUNT: '9' } };
  const high = { tags: [], properties: { COUNT: '10' } };
  // Lexicographic comparison would incorrectly say "10" < "9".
  const parsed = parseMatchQuery('COUNT>"9"');
  assert.equal(evaluateMatchQuery(parsed, high), true);
  assert.equal(evaluateMatchQuery(parsed, low), false);
});

test('a missing property value never satisfies a positive comparison, and correctly satisfies its own negation', () => {
  const noProp = { tags: [], properties: {} };
  assert.equal(evaluateMatchQuery(parseMatchQuery('MISSING="x"'), noProp), false);
  assert.equal(evaluateMatchQuery(parseMatchQuery('-MISSING="x"'), noProp), true);
});
