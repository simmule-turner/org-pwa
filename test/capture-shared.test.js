import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FIELD, normalizeShared, parseLaunchParams, placeInsertedText, sharedAnnotation } from '../src/capture-shared.js';

test('a launch URL with nothing for Capture reads as null, so an ordinary start is never touched', () => {
  assert.equal(parseLaunchParams(''), null);
  assert.equal(parseLaunchParams('?utm_source=x&foo=bar'), null);
  assert.equal(parseLaunchParams(undefined), null);
});

test('?capture=KEY names a template; a bare ?capture means "show the template list"', () => {
  assert.deepEqual(parseLaunchParams('?capture=t'), { capture: 't', shared: null });
  assert.deepEqual(parseLaunchParams('?capture'), { capture: '', shared: null });
  assert.deepEqual(parseLaunchParams('?capture='), { capture: '', shared: null });
});

test('shared content arrives as title, text and url, decoded from the query string', () => {
  const r = parseLaunchParams('?title=A%20page&text=Some%20words&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1');
  assert.deepEqual(r, { capture: null, shared: { title: 'A page', text: 'Some words', url: 'https://example.com/a?b=1' } });
});

test('a key and shared content together are both kept', () => {
  assert.deepEqual(parseLaunchParams('?capture=n&text=hello'), { capture: 'n', shared: { title: '', text: 'hello', url: '' } });
});

test('when an app puts the address in text, it is moved to url (alone, or after the words)', () => {
  assert.deepEqual(normalizeShared({ title: '', text: 'https://example.com/x', url: '' }), { title: '', text: '', url: 'https://example.com/x' });
  assert.deepEqual(normalizeShared({ title: 'T', text: 'Read this\nhttps://example.com/x', url: '' }), { title: 'T', text: 'Read this', url: 'https://example.com/x' });
  assert.deepEqual(normalizeShared({ title: '', text: 'see https://example.com/x later', url: '' }), { title: '', text: 'see https://example.com/x later', url: '' }, 'an address in the middle of the words stays where it is');
  assert.deepEqual(normalizeShared({ title: '', text: 'words https://a.example', url: 'https://b.example' }), { title: '', text: 'words https://a.example', url: 'https://b.example' }, 'an explicit url wins and text is untouched');
});

test('each parameter is trimmed and capped, so a huge share cannot flood the form', () => {
  const r = parseLaunchParams('?text=' + 'x'.repeat(MAX_FIELD + 500));
  assert.equal(r.shared.text.length, MAX_FIELD);
  assert.equal(parseLaunchParams('?text=%20%20hi%20%20').shared.text, 'hi');
});

test('%a is a link to the shared page, with the title as its description when there is one', () => {
  assert.equal(sharedAnnotation({ title: 'Example', url: 'https://example.com/a' }), '[[https://example.com/a][Example]]');
  assert.equal(sharedAnnotation({ title: '', url: 'https://example.com/a' }), '[[https://example.com/a]]');
  assert.equal(sharedAnnotation({ title: 'T', url: '' }), '');
  assert.equal(sharedAnnotation(), '');
});

test('only web and mail addresses become links; anything else is dropped', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'intent://scan#Intent;end', 'github:x.org']) assert.equal(sharedAnnotation({ title: 'T', url }), '', url);
  assert.equal(sharedAnnotation({ title: '', url: 'mailto:a@b.example' }), '[[mailto:a@b.example]]');
});

test('brackets and spaces that would break a link are neutralized in both the address and the title', () => {
  assert.equal(sharedAnnotation({ title: 'A [bracketed] title', url: 'https://example.com/a b[1]' }), '[[https://example.com/a%20b%5B1%5D][A (bracketed) title]]');
  assert.equal(sharedAnnotation({ title: 'line\none', url: 'https://e.example' }), '[[https://e.example][line one]]');
});

test('inserted text keeps its first line where the token is, and gives later lines the prefix (org\u2019s rule)', () => {
  assert.equal(placeInsertedText('one\ntwo\nthree', '  '), 'one\n  two\n  three');
  assert.equal(placeInsertedText('one\ntwo', ''), 'one\ntwo');
  assert.equal(placeInsertedText('a\r\nb', '  '), 'a\n  b');
  assert.equal(placeInsertedText('', '  '), '');
  assert.equal(placeInsertedText(undefined, ''), '');
});

test('shared lines that would become headings or #+ lines at the start of a line get a leading comma', () => {
  assert.equal(placeInsertedText('* a\n* b', ''), ',* a\n,* b', 'a shared bullet list cannot become headings');
  assert.equal(placeInsertedText('x\n#+begin_src js\ny', ''), 'x\n,#+begin_src js\ny');
  assert.equal(placeInsertedText('ok\n*bold* and ** x', ''), 'ok\n*bold* and ** x', 'stars not followed by a space are not a heading');
});

test('under an indent a star line is already harmless, but a #+ line is still escaped (it would still open a block)', () => {
  assert.equal(placeInsertedText('* a\n* b', '  '), '* a\n  * b', 'indented stars are left alone');
  assert.equal(placeInsertedText('#+begin_quote\nx', '  '), ',#+begin_quote\n  x');
});

test('when the template\u2019s own text precedes the token, the shared text cannot start a line, so nothing is escaped', () => {
  assert.equal(placeInsertedText('* a', 'Note: '), '* a');
});
