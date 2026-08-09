import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAttachmentId,
  splitAttachmentId,
  attachmentPath,
  formatAttachmentLink,
  sanitizeAttachmentFilename,
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

test('formatAttachmentLink produces a real org file: link with the filename as its description', () => {
  const link = formatAttachmentLink('data/55/0e8400.../photo.jpg', 'photo.jpg');
  assert.equal(link, '[[file:data/55/0e8400.../photo.jpg][photo.jpg]]');
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
