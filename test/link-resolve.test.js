import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  isExternalUrl,
  isFileLink,
  isDoi,
  doiToUrl,
  fileLinkScheme,
  splitFileLinkTarget,
  resolveImagePath,
  guessImageMimeType,
  findHeadingByTitle,
  findHeadingByCustomId,
  findFootnoteDefinition,
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
    scheme: 'file',
    path: '~/Pictures/x.png',
    inFileTarget: null,
  });
  assert.deepEqual(resolveLinkTarget(doc, './notes.org'), {
    type: 'file',
    scheme: 'file',
    path: './notes.org',
    inFileTarget: null,
  });
});

test('resolveLinkTarget trims whitespace around the target', () => {
  const doc = docWithHeadings();
  const result = resolveLinkTarget(doc, '  *Installation  ');
  assert.equal(result.type, 'heading');
});

// ---- doi: ------------------------------------------------------------

test('isDoi recognizes a doi: target', () => {
  assert.equal(isDoi('doi:10.1145/1327452.1327492'), true);
  assert.equal(isDoi('https://example.com'), false);
});

test('doiToUrl rewrites to the standard doi.org resolver', () => {
  assert.equal(doiToUrl('doi:10.1145/1327452.1327492'), 'https://doi.org/10.1145/1327452.1327492');
});

test('resolveLinkTarget resolves a doi: link as external, rewritten to doi.org', () => {
  const doc = parseOrg('* A');
  const result = resolveLinkTarget(doc, 'doi:10.1145/1327452.1327492');
  assert.deepEqual(result, { type: 'external', url: 'https://doi.org/10.1145/1327452.1327492' });
});

// ---- fileLinkScheme -------------------------------------------------------

test('fileLinkScheme identifies each of the three schemes correctly', () => {
  assert.equal(fileLinkScheme('file:~/notes.org'), 'file');
  assert.equal(fileLinkScheme('github:journal/2026.org'), 'github');
  assert.equal(fileLinkScheme('webdav:notes/2026.org'), 'webdav');
});

test('fileLinkScheme defaults to "file" for a bare path with no scheme prefix', () => {
  assert.equal(fileLinkScheme('./notes.org'), 'file');
  assert.equal(fileLinkScheme('~/notes.org'), 'file');
  assert.equal(fileLinkScheme('/notes.org'), 'file');
});

// ---- splitFileLinkTarget ---------------------------------------------

test('splitFileLinkTarget: no "::" at all returns a null inFileTarget', () => {
  assert.deepEqual(splitFileLinkTarget('~/notes.org'), { path: '~/notes.org', inFileTarget: null });
});

test('splitFileLinkTarget: a headline target after "::"', () => {
  assert.deepEqual(splitFileLinkTarget('~/notes.org::*Project Alpha'), { path: '~/notes.org', inFileTarget: '*Project Alpha' });
});

test('splitFileLinkTarget: a plain text search target after "::"', () => {
  assert.deepEqual(splitFileLinkTarget('~/notes.org::exact phrase'), { path: '~/notes.org', inFileTarget: 'exact phrase' });
});

// ---- resolveLinkTarget: the four documented file: examples ---------------

test('EXAMPLE: absolute path', () => {
  const doc = parseOrg('* A');
  const result = resolveLinkTarget(doc, 'file:/home/user/documents/notes.org');
  assert.deepEqual(result, { type: 'file', scheme: 'file', path: '/home/user/documents/notes.org', inFileTarget: null });
});

test('EXAMPLE: relative path', () => {
  const doc = parseOrg('* A');
  const result = resolveLinkTarget(doc, 'file:projects/todo.org');
  assert.deepEqual(result, { type: 'file', scheme: 'file', path: 'projects/todo.org', inFileTarget: null });
});

test('EXAMPLE: specific headline target', () => {
  const doc = parseOrg('* A');
  const result = resolveLinkTarget(doc, 'file:~/notes.org::*Project Alpha');
  assert.deepEqual(result, { type: 'file', scheme: 'file', path: '~/notes.org', inFileTarget: '*Project Alpha' });
});

test('EXAMPLE: text search target', () => {
  const doc = parseOrg('* A');
  const result = resolveLinkTarget(doc, 'file:~/notes.org::exact phrase');
  assert.deepEqual(result, { type: 'file', scheme: 'file', path: '~/notes.org', inFileTarget: 'exact phrase' });
});

test('github: and webdav: links resolve with their own scheme and support the same ::target syntax', () => {
  const doc = parseOrg('* A');
  assert.deepEqual(resolveLinkTarget(doc, 'github:journal/2026.org::*Q1 Goals'), {
    type: 'file',
    scheme: 'github',
    path: 'journal/2026.org',
    inFileTarget: '*Q1 Goals',
  });
  assert.deepEqual(resolveLinkTarget(doc, 'webdav:notes/todo.org'), {
    type: 'file',
    scheme: 'webdav',
    path: 'notes/todo.org',
    inFileTarget: null,
  });
});

// ---- resolveImagePath ------------------------------------------------

test('resolveImagePath: a bare filename becomes a sibling of the current document', () => {
  assert.equal(resolveImagePath('photo.png', 'notes.org'), 'photo.png');
  assert.equal(resolveImagePath('photo.png', 'journal/notes.org'), 'journal/photo.png');
});

test('resolveImagePath: a leading "./" is stripped, same result as no prefix at all', () => {
  assert.equal(resolveImagePath('./photo.png', 'journal/notes.org'), 'journal/photo.png');
});

test('resolveImagePath: a path already containing "/" is used as-is', () => {
  assert.equal(resolveImagePath('images/photo.png', 'notes.org'), 'images/photo.png');
});

test('resolveImagePath: a leading "/" is treated as root-relative within the backend', () => {
  assert.equal(resolveImagePath('/images/photo.png', 'journal/notes.org'), 'images/photo.png');
});

test('resolveImagePath: file:/github:/webdav: scheme prefixes are stripped before resolving', () => {
  assert.equal(resolveImagePath('file:photo.png', 'journal/notes.org'), 'journal/photo.png');
  assert.equal(resolveImagePath('github:images/photo.png', 'notes.org'), 'images/photo.png');
  assert.equal(resolveImagePath('webdav:photo.png', 'journal/notes.org'), 'journal/photo.png');
});

// ---- guessImageMimeType -----------------------------------------------

test('guessImageMimeType identifies every supported extension correctly', () => {
  assert.equal(guessImageMimeType('a.png'), 'image/png');
  assert.equal(guessImageMimeType('a.jpg'), 'image/jpeg');
  assert.equal(guessImageMimeType('a.jpeg'), 'image/jpeg');
  assert.equal(guessImageMimeType('a.gif'), 'image/gif');
  assert.equal(guessImageMimeType('a.svg'), 'image/svg+xml');
  assert.equal(guessImageMimeType('a.webp'), 'image/webp');
  assert.equal(guessImageMimeType('a.bmp'), 'image/bmp');
});

test('guessImageMimeType is case-insensitive on the extension', () => {
  assert.equal(guessImageMimeType('a.PNG'), 'image/png');
});

test('guessImageMimeType falls back to a generic binary type for an unrecognized extension', () => {
  assert.equal(guessImageMimeType('a.tiff'), 'application/octet-stream');
  assert.equal(guessImageMimeType('noextension'), 'application/octet-stream');
});

// ---- findFootnoteDefinition ------------------------------------------

test('finds a paragraph-style footnote definition ("[fn:label] text" line) by its label', () => {
  const doc = parseOrg('* Heading\nSee this[fn:1] for details.\n\n[fn:1] The actual note.\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.ok(result);
  assert.equal(result.kind, 'paragraph-definition');
  assert.equal(result.heading.title, 'Heading');
});

test('finds an inline footnote definition ([fn:label:text]) by its label, even when referenced again elsewhere as a bare [fn:label]', () => {
  const doc = parseOrg('* Heading\nFirst mention[fn:1:the actual note here]. Later, referenced again[fn:1].\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.ok(result);
  assert.equal(result.kind, 'inline-definition');
});

test('finds an inline footnote definition nested inside a list item', () => {
  const doc = parseOrg('* Heading\n- a list item with a note[fn:1:defined right here]\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.ok(result);
  assert.equal(result.kind, 'inline-definition');
});

test('finds an inline footnote definition nested inside a nested (sub) list item', () => {
  const doc = parseOrg('* Heading\n- outer item\n  - nested item with a note[fn:1:defined here]\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.ok(result);
});

test('finds an inline footnote definition inside a table cell', () => {
  const doc = parseOrg('* Heading\n| col1 | col2[fn:1:a table footnote] |\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.ok(result);
  assert.equal(result.kind, 'inline-definition');
});

test('returns null when no definition exists anywhere for the given label', () => {
  const doc = parseOrg('* Heading\nA reference with no matching definition[fn:nowhere].\n');
  assert.equal(findFootnoteDefinition(doc, 'nowhere'), null);
});

test('finds the correct heading when multiple headings each have their own footnote definitions', () => {
  const doc = parseOrg('* First\n[fn:a] Note A.\n* Second\n[fn:b] Note B.\n');
  const resultA = findFootnoteDefinition(doc, 'a');
  const resultB = findFootnoteDefinition(doc, 'b');
  assert.equal(resultA.heading.title, 'First');
  assert.equal(resultB.heading.title, 'Second');
});

test('a footnote-def with a DIFFERENT label does not falsely match a search for a different label', () => {
  const doc = parseOrg('* Heading\nA note[fn:1:definition one] and another[fn:2:definition two].\n');
  const result1 = findFootnoteDefinition(doc, '1');
  const result2 = findFootnoteDefinition(doc, '2');
  assert.ok(result1);
  assert.ok(result2);
  // Both resolve to the same heading here, but each call independently found ITS OWN label's def, not just "any" footnote-def node
  assert.equal(result1.kind, 'inline-definition');
  assert.equal(result2.kind, 'inline-definition');
});

test('the returned node is the exact paragraph object for a paragraph-style definition', () => {
  const doc = parseOrg('* Heading\n[fn:1] The actual note.\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.equal(result.node.type, 'paragraph');
  assert.equal(result.node.footnoteLabel, '1');
});

test('the returned node is the exact list-item object for an inline definition inside a list item', () => {
  const doc = parseOrg('* Heading\n- an item with a note[fn:1:defined here]\n');
  const result = findFootnoteDefinition(doc, '1');
  assert.equal(result.node.type, 'list-item');
  assert.equal(result.node.text.includes('an item with a note'), true);
});
