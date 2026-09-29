import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { collectTagUsage, declaredTagsOf, suggestTags, suggestPropertyKeys, KNOWN_PROPERTY_KEYS } from '../src/completion.js';

const doc = (t) => parseOrg(t);

test('collectTagUsage counts every heading that carries a tag, at any depth', () => {
  const d = doc('* A :work:home:\n** B :work:\n*** C :work:\n* D :home:\n');
  const usage = collectTagUsage([d]);
  assert.equal(usage.get('work'), 3);
  assert.equal(usage.get('home'), 2);
});

test('collectTagUsage spans several documents and counts a #+FILETAGS: tag once', () => {
  const a = doc('#+FILETAGS: :proj:\n* A :work:\n');
  const b = doc('* B :work:\n');
  const usage = collectTagUsage([a, b]);
  assert.equal(usage.get('work'), 2);
  assert.equal(usage.get('proj'), 1);
});

test('collectTagUsage tolerates a missing document', () => {
  assert.equal(collectTagUsage([null, undefined]).size, 0);
});

test('declaredTagsOf: plain tags, fast-selection keys, and groups', () => {
  const d = doc('#+TAGS: work home(h) @office\n#+TAGS: { Ctx : @a @b }\n#+TAGS: [ GTD : next wait ]\n* A\n');
  assert.deepEqual(declaredTagsOf(d).sort(), ['@a', '@b', '@office', 'Ctx', 'GTD', 'home', 'next', 'wait', 'work'].sort());
});

test('declaredTagsOf skips the legacy group syntax words and stray punctuation', () => {
  const d = doc('#+TAGS: :startgroup work :grouptags a b :endgroup :newline c\n* A\n');
  assert.deepEqual(declaredTagsOf(d).sort(), ['a', 'b', 'c', 'work']);
});

test('declaredTagsOf: no #+TAGS: line, no tags', () => {
  assert.deepEqual(declaredTagsOf(doc('* A :x:\n')), []);
});

test('suggestTags with nothing typed: the most used first, then alphabetical', () => {
  const d = doc('* A :work:\n* B :work:\n* C :home:\n* D :alpha:\n');
  assert.deepEqual(suggestTags({ docs: [d] }), ['work', 'alpha', 'home']);
});

test('suggestTags never re-offers a tag the heading already has', () => {
  const d = doc('* A :work:\n* B :work:home:\n');
  assert.deepEqual(suggestTags({ docs: [d], applied: ['work'] }), ['home']);
});

test('suggestTags: a tag that STARTS with what was typed outranks one that merely contains it', () => {
  const d = doc('* A :networking:\n* B :work:\n* C :workshop:\n');
  assert.deepEqual(suggestTags({ docs: [d], query: 'work' }), ['work', 'workshop', 'networking']);
  const e = doc('* A :xwork:\n* B :work:\n');
  assert.deepEqual(suggestTags({ docs: [e], query: 'work' }), ['work', 'xwork']);
});

test('within the same rank, the more used tag wins', () => {
  const d = doc('* A :workA:\n* B :workB:\n* C :workB:\n');
  assert.deepEqual(suggestTags({ docs: [d], query: 'work' }), ['workB', 'workA']);
});

test('suggestTags is case-insensitive to match but case-sensitive as identity', () => {
  const d = doc('* A :Work:\n* B :work:\n');
  assert.deepEqual(suggestTags({ docs: [d], query: 'WORK' }).sort(), ['Work', 'work']);
  assert.deepEqual(suggestTags({ docs: [d], query: 'w', applied: ['work'] }), ['Work'], 'only the exact applied tag is excluded');
});

test('suggestTags includes tags declared on #+TAGS: even when no heading uses them yet', () => {
  const d = doc('#+TAGS: errand call\n* A :used:\n');
  assert.deepEqual(suggestTags({ docs: [d] }), ['used', 'call', 'errand']);
  assert.deepEqual(suggestTags({ docs: [d], query: 'er' }), ['errand']);
});

test('suggestTags: a colon typed by habit is ignored, and a query nothing matches gives nothing', () => {
  const d = doc('* A :work:\n');
  assert.deepEqual(suggestTags({ docs: [d], query: ':wo' }), ['work']);
  assert.deepEqual(suggestTags({ docs: [d], query: 'zzz' }), []);
});

test('suggestTags respects its limit, and draws on every document', () => {
  const many = doc(Array.from({ length: 30 }, (_, i) => `* H${i} :t${i}:`).join('\n') + '\n');
  assert.equal(suggestTags({ docs: [many] }).length, 10);
  assert.equal(suggestTags({ docs: [many], limit: 3 }).length, 3);
  const a = doc('* A :only_in_a:\n');
  const b = doc('* B :only_in_b:\n');
  assert.deepEqual(suggestTags({ docs: [a, b] }).sort(), ['only_in_a', 'only_in_b']);
});

test('suggestPropertyKeys: keys already used come first, then the ones this app knows', () => {
  const d = doc('* A\n:PROPERTIES:\n:OWNER: me\n:END:\n* B\n:PROPERTIES:\n:OWNER: you\n:LOCATION: x\n:END:\n');
  const keys = suggestPropertyKeys({ docs: [d] });
  assert.deepEqual(keys.slice(0, 2), ['OWNER', 'LOCATION']);
  for (const known of KNOWN_PROPERTY_KEYS) assert.ok(keys.includes(known), known);
});

test('suggestPropertyKeys never re-offers a key the heading has (case-insensitively) and never repeats one', () => {
  const d = doc('* A\n:PROPERTIES:\n:effort: 1h\n:END:\n');
  const keys = suggestPropertyKeys({ docs: [d], applied: ['Effort'] });
  assert.ok(!keys.some((k) => k.toLowerCase() === 'effort'));
  assert.equal(keys.length, new Set(keys.map((k) => k.toLowerCase())).size);
});
