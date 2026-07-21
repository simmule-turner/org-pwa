import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  isExternalUrl,
  isFileLink,
  findHeadingByTitle,
  findHeadingByCustomId,
  resolveLinkTarget,
} from '../src/link-resolve.js';

function docWithHeadings() {
  const text = [
    '* Getting Started',
    '** Installation',
    ':PROPERTIES:',
    ':CUSTOM_ID: install-steps',
    ':END:',
    'Some steps here.',
    '* Reference',
  ].join('\n');
  return parseOrg(text);
}

test('isExternalUrl recognizes http/https/mailto', () => {
  assert.equal(isExternalUrl('https://orgmode.org'), true);
  assert.equal(isExternalUrl('http://example.com'), true);
  assert.equal(isExternalUrl('mailto:a@b.com'), true);
  assert.equal(isExternalUrl('*Getting Started'), false);
  assert.equal(isExternalUrl('#install-steps'), false);
});

test('isFileLink recognizes file:, relative, absolute, and tilde paths', () => {
  assert.equal(isFileLink('file:~/Pictures/x.png'), true);
  assert.equal(isFileLink('./notes.org'), true);
  assert.equal(isFileLink('../sibling.org'), true);
  assert.equal(isFileLink('~/documents/notes.org'), true);
  assert.equal(isFileLink('/abs/path.org'), true);
  assert.equal(isFileLink('https://example.com'), false);
  assert.equal(isFileLink('*Some Heading'), false);
});

test('findHeadingByTitle finds an exact match', () => {
  const doc = docWithHeadings();
  const h = findHeadingByTitle(doc, 'Installation');
  assert.equal(h.title, 'Installation');
});

test('findHeadingByTitle returns null when nothing matches', () => {
  const doc = docWithHeadings();
  assert.equal(findHeadingByTitle(doc, 'Nonexistent'), null);
});

test('findHeadingByCustomId finds a heading with a matching :CUSTOM_ID:', () => {
  const doc = docWithHeadings();
  const h = findHeadingByCustomId(doc, 'install-steps');
  assert.equal(h.title, 'Installation');
});

test('findHeadingByCustomId returns null when nothing matches', () => {
  const doc = docWithHeadings();
  assert.equal(findHeadingByCustomId(doc, 'nope'), null);
});

// ---- resolveLinkTarget: the two internal-link forms specifically asked for ----

test('resolveLinkTarget: "*Heading Name" resolves by exact title match', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '*Installation');
  assert.equal(result.type, 'heading');
  assert.equal(result.heading.title, 'Installation');
});

test('resolveLinkTarget: "#custom-id" resolves by CUSTOM_ID property', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '#install-steps');
  assert.equal(result.type, 'heading');
  assert.equal(result.heading.title, 'Installation');
});

test('resolveLinkTarget: "*Heading Name" with no match is unresolved', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '*Nope');
  assert.deepEqual(result, { type: 'unresolved', target: '*Nope' });
});

test('resolveLinkTarget: "#custom-id" with no match is unresolved', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '#nope');
  assert.deepEqual(result, { type: 'unresolved', target: '#nope' });
});

// ---- other target forms ---------------------------------------------------

test('resolveLinkTarget: external URLs', () => {
  const doc = docWithHeadings();
  assert.deepEqual(resolveLinkTarget(doc, 'https://orgmode.org'), {
    type: 'external',
    url: 'https://orgmode.org',
  });
});

test('resolveLinkTarget: bare text falls back to a heading-title search', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, 'Reference');
  assert.equal(result.type, 'heading');
  assert.equal(result.heading.title, 'Reference');
});

test('resolveLinkTarget: bare text with no matching heading is unresolved', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, 'nothing matches this');
  assert.deepEqual(result, { type: 'unresolved', target: 'nothing matches this' });
});

test('resolveLinkTarget: file-like targets, with the file: prefix stripped', () => {
  const doc = docWithHeadings();
  assert.deepEqual(resolveLinkTarget(doc, 'file:~/Pictures/x.png'), {
    type: 'file',
    path: '~/Pictures/x.png',
  });
  assert.deepEqual(resolveLinkTarget(doc, './notes.org'), { type: 'file', path: './notes.org' });
});

test('resolveLinkTarget trims whitespace around the target', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '  *Installation  ');
  assert.equal(result.type, 'heading');
});
