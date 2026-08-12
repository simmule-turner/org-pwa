import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAttachmentId,
  splitAttachmentId,
  attachmentPath,
  formatAttachmentLink,
  sanitizeAttachmentFilename,
  listAttachments,
  removeAttachmentLink,
} from '../src/attach.js';

// ---- generateAttachmentId ---------------------------------------------------

test('generateAttachmentId produces a standard UUID v4 shape', () => {
  const id = generateAttachmentId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('generateAttachmentId produces a different id on every call', () => {
  const a = generateAttachmentId();
  const b = generateAttachmentId();
  assert.notEqual(a, b);
});

// ---- splitAttachmentId ---------------------------------------------------

test('splitAttachmentId splits into a 2-character prefix and the rest', () => {
  assert.deepEqual(splitAttachmentId('550e8400-e29b-41d4-a716-446655440000'), {
    prefix: '55',
    rest: '0e8400-e29b-41d4-a716-446655440000',
  });
});

test('splitAttachmentId trims surrounding whitespace first', () => {
  assert.deepEqual(splitAttachmentId('  abcdef  '), { prefix: 'ab', rest: 'cdef' });
});

test('splitAttachmentId throws for an id shorter than 3 characters, rather than producing a nonsensical empty rest', () => {
  assert.throws(() => splitAttachmentId('ab'), /at least 3 characters/);
  assert.throws(() => splitAttachmentId(''), /at least 3 characters/);
});

// ---- attachmentPath ---------------------------------------------------

test('attachmentPath builds the full data/prefix/rest/filename path', () => {
  const path = attachmentPath('550e8400-e29b-41d4-a716-446655440000', 'photo.jpg');
  assert.equal(path, 'data/55/0e8400-e29b-41d4-a716-446655440000/photo.jpg');
});

test('attachmentPath with two different ids produces two different paths, even for the same filename', () => {
  const pathA = attachmentPath('aaaaaaaa-0000-0000-0000-000000000000', 'photo.jpg');
  const pathB = attachmentPath('bbbbbbbb-0000-0000-0000-000000000000', 'photo.jpg');
  assert.notEqual(pathA, pathB);
});

// ---- formatAttachmentLink ---------------------------------------------------

test('formatAttachmentLink produces a bare attachment: link (no description) for an image filename, matching real org\u2019s own "no description = inline image" convention', () => {
  assert.equal(formatAttachmentLink('photo.jpg'), '[[attachment:photo.jpg]]');
  assert.equal(formatAttachmentLink('IMG_1234.heic'), '[[attachment:IMG_1234.heic]]');
  assert.equal(formatAttachmentLink('picture.PNG'), '[[attachment:picture.PNG]]');
});

test('formatAttachmentLink produces an attachment: link WITH the filename as its own description for a non-image file', () => {
  assert.equal(formatAttachmentLink('notes.pdf'), '[[attachment:notes.pdf][notes.pdf]]');
  assert.equal(formatAttachmentLink('report.docx'), '[[attachment:report.docx][report.docx]]');
});

// ---- sanitizeAttachmentFilename ---------------------------------------------------

test('sanitizeAttachmentFilename strips path separators and other unsafe characters', () => {
  assert.equal(sanitizeAttachmentFilename('my/photo\\file:name?.jpg'), 'my_photo_file_name_.jpg');
});

test('sanitizeAttachmentFilename trims surrounding whitespace', () => {
  assert.equal(sanitizeAttachmentFilename('  photo.jpg  '), 'photo.jpg');
});

test('sanitizeAttachmentFilename falls back to "attachment" for an empty or whitespace-only name', () => {
  assert.equal(sanitizeAttachmentFilename(''), 'attachment');
  assert.equal(sanitizeAttachmentFilename('   '), 'attachment');
});

test('sanitizeAttachmentFilename leaves an already-safe filename completely unchanged', () => {
  assert.equal(sanitizeAttachmentFilename('vacation-photo_2026.jpg'), 'vacation-photo_2026.jpg');
});

// ---- listAttachments ---------------------------------------------------

test('listAttachments finds both bare (image) and described (non-image) attachment: links', () => {
  const heading = { bodyLines: ['[[attachment:photo.jpg]]', 'Some notes.', '[[attachment:notes.pdf][notes.pdf]]'] };
  assert.deepEqual(listAttachments(heading), ['photo.jpg', 'notes.pdf']);
});

test('listAttachments returns an empty array for a heading with no attachment: links at all', () => {
  assert.deepEqual(listAttachments({ bodyLines: ['Just ordinary text.', '- a list item'] }), []);
  assert.deepEqual(listAttachments({ bodyLines: [] }), []);
});

test('listAttachments de-duplicates the same filename linked more than once', () => {
  const heading = { bodyLines: ['[[attachment:photo.jpg]]', 'text', '[[attachment:photo.jpg]]'] };
  assert.deepEqual(listAttachments(heading), ['photo.jpg']);
});

test('listAttachments preserves first-appearance order', () => {
  const heading = { bodyLines: ['[[attachment:c.jpg]]', '[[attachment:a.jpg]]', '[[attachment:b.jpg]]'] };
  assert.deepEqual(listAttachments(heading), ['c.jpg', 'a.jpg', 'b.jpg']);
});

test('listAttachments finds a link inline alongside other text on the same line', () => {
  const heading = { bodyLines: ['See attached: [[attachment:photo.jpg]] for details.'] };
  assert.deepEqual(listAttachments(heading), ['photo.jpg']);
});

// ---- removeAttachmentLink ---------------------------------------------------

test('removeAttachmentLink drops a line entirely when the link was the whole line', () => {
  const heading = { bodyLines: ['Some notes.', '[[attachment:photo.jpg]]', 'More notes.'] };
  removeAttachmentLink(heading, 'photo.jpg');
  assert.deepEqual(heading.bodyLines, ['Some notes.', 'More notes.']);
});

test('removeAttachmentLink keeps other text on the same line, removing just the link', () => {
  const heading = { bodyLines: ['See attached: [[attachment:photo.jpg]] for details.'] };
  removeAttachmentLink(heading, 'photo.jpg');
  assert.deepEqual(heading.bodyLines, ['See attached: for details.']);
});

test('removeAttachmentLink preserves a pre-existing blank spacer line, not accidentally dropping it', () => {
  const heading = { bodyLines: ['Some notes.', '', '[[attachment:photo.jpg]]'] };
  removeAttachmentLink(heading, 'photo.jpg');
  assert.deepEqual(heading.bodyLines, ['Some notes.', '']);
});

test('removeAttachmentLink only removes the link matching the given filename, leaving others untouched', () => {
  const heading = { bodyLines: ['[[attachment:photo.jpg]]', '[[attachment:notes.pdf][notes.pdf]]'] };
  removeAttachmentLink(heading, 'photo.jpg');
  assert.deepEqual(heading.bodyLines, ['[[attachment:notes.pdf][notes.pdf]]']);
});

test('removeAttachmentLink removes both the bare and described forms correctly', () => {
  const headingBare = { bodyLines: ['[[attachment:photo.jpg]]'] };
  removeAttachmentLink(headingBare, 'photo.jpg');
  assert.deepEqual(headingBare.bodyLines, []);

  const headingDescribed = { bodyLines: ['[[attachment:notes.pdf][notes.pdf]]'] };
  removeAttachmentLink(headingDescribed, 'notes.pdf');
  assert.deepEqual(headingDescribed.bodyLines, []);
});

test('removeAttachmentLink is a no-op for a filename that isn\u2019t actually attached', () => {
  const heading = { bodyLines: ['[[attachment:photo.jpg]]'] };
  removeAttachmentLink(heading, 'nonexistent.pdf');
  assert.deepEqual(heading.bodyLines, ['[[attachment:photo.jpg]]']);
});
