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
  disambiguateAttachmentFilename,
  isAudioFilename,
  extensionForRecordedMimeType,
  generateRecordingFilename,
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

test('THE FIX: attachmentPath anchors the "data/..." tree to documentId\u2019s own directory, matching the exact user-reported scenario (org-pwa/foo.org -> org-pwa/data/...)', () => {
  const path = attachmentPath('ae34c932-a7b3-4987-ae3f-690587a0ff18', 'IMG_20260531_214919_098.jpg', 'org-pwa/foo.org');
  assert.equal(path, 'org-pwa/data/ae/34c932-a7b3-4987-ae3f-690587a0ff18/IMG_20260531_214919_098.jpg');
});

test('attachmentPath is bare/root-relative when documentId is omitted, matching the previous (still-correct-for-root-level-docs) behavior', () => {
  const path = attachmentPath('550e8400-e29b-41d4-a716-446655440000', 'photo.jpg');
  assert.equal(path, 'data/55/0e8400-e29b-41d4-a716-446655440000/photo.jpg');
});

test('attachmentPath is bare/root-relative when documentId itself has no directory component (a root-level document)', () => {
  const path = attachmentPath('550e8400-e29b-41d4-a716-446655440000', 'photo.jpg', 'foo.org');
  assert.equal(path, 'data/55/0e8400-e29b-41d4-a716-446655440000/photo.jpg');
});

test('attachmentPath correctly handles a deeply nested documentId', () => {
  const path = attachmentPath('550e8400-e29b-41d4-a716-446655440000', 'photo.jpg', 'a/b/c/foo.org');
  assert.equal(path, 'a/b/c/data/55/0e8400-e29b-41d4-a716-446655440000/photo.jpg');
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

// ---- disambiguateAttachmentFilename ---------------------------------------

test('THE REAL BUG: a filename that doesn\u2019t collide with any existing attachment is returned unchanged', () => {
  assert.equal(disambiguateAttachmentFilename('photo.jpg', []), 'photo.jpg');
  assert.equal(disambiguateAttachmentFilename('photo.jpg', ['notes.pdf']), 'photo.jpg');
});

test('THE REAL BUG: a colliding filename (the exact "image.jpg" camera-capture scenario reported) gets "-1" inserted before the extension', () => {
  assert.equal(disambiguateAttachmentFilename('image.jpg', ['image.jpg']), 'image-1.jpg');
});

test('THE REAL BUG: multiple successive collisions (repeated camera captures, all named identically) each get their own, genuinely unique number', () => {
  assert.equal(disambiguateAttachmentFilename('image.jpg', ['image.jpg', 'image-1.jpg']), 'image-2.jpg');
  assert.equal(disambiguateAttachmentFilename('image.jpg', ['image.jpg', 'image-1.jpg', 'image-2.jpg']), 'image-3.jpg');
});

test('disambiguateAttachmentFilename never returns the original name once ANY collision is found, even if a later-numbered slot happens to already be free', () => {
  // image-1.jpg already taken by something else entirely, but image.jpg itself still collides -- must not silently return image.jpg.
  const result = disambiguateAttachmentFilename('image.jpg', ['image.jpg', 'image-1.jpg']);
  assert.notEqual(result, 'image.jpg');
  assert.equal(result, 'image-2.jpg');
});

test('a filename with no extension at all gets the suffix appended directly', () => {
  assert.equal(disambiguateAttachmentFilename('README', ['README']), 'README-1');
});

test('a dotfile-style name (leading dot) is not mistaken for having an extension', () => {
  assert.equal(disambiguateAttachmentFilename('.gitignore', ['.gitignore']), '.gitignore-1');
});

test('the file\u2019s own real extension is always preserved after disambiguation', () => {
  assert.match(disambiguateAttachmentFilename('photo.png', ['photo.png']), /\.png$/);
  assert.match(disambiguateAttachmentFilename('video.mp4', ['video.mp4']), /\.mp4$/);
});

// ---- isAudioFilename ---------------------------------------------------

test('isAudioFilename recognizes both recorder-produced formats (webm, m4a) and common existing-file formats', () => {
  assert.equal(isAudioFilename('recording.webm'), true);
  assert.equal(isAudioFilename('voice.m4a'), true);
  assert.equal(isAudioFilename('song.mp3'), true);
  assert.equal(isAudioFilename('clip.wav'), true);
  assert.equal(isAudioFilename('clip.ogg'), true);
});

test('isAudioFilename correctly rejects non-audio files', () => {
  assert.equal(isAudioFilename('photo.jpg'), false);
  assert.equal(isAudioFilename('notes.pdf'), false);
  assert.equal(isAudioFilename('video.mov'), false);
});

test('isAudioFilename is case-insensitive', () => {
  assert.equal(isAudioFilename('RECORDING.WEBM'), true);
});

// ---- extensionForRecordedMimeType ---------------------------------------

test('THE REAL CROSS-BROWSER SPLIT: extensionForRecordedMimeType maps Chrome/Firefox/Edge\u2019s own actual audio/webm output to .webm', () => {
  assert.equal(extensionForRecordedMimeType('audio/webm'), 'webm');
  assert.equal(extensionForRecordedMimeType('audio/webm;codecs=opus'), 'webm');
});

test('THE REAL CROSS-BROWSER SPLIT: extensionForRecordedMimeType maps Safari\u2019s own actual audio/mp4 output to .m4a, not the more generic/video-implying .mp4', () => {
  assert.equal(extensionForRecordedMimeType('audio/mp4'), 'm4a');
});

test('extensionForRecordedMimeType falls back to .webm for an unrecognized MIME type, rather than producing no extension at all', () => {
  assert.equal(extensionForRecordedMimeType('audio/some-future-format'), 'webm');
  assert.equal(extensionForRecordedMimeType(''), 'webm');
  assert.equal(extensionForRecordedMimeType(undefined), 'webm');
});

test('extensionForRecordedMimeType is case-insensitive', () => {
  assert.equal(extensionForRecordedMimeType('AUDIO/MP4'), 'm4a');
});

// ---- generateRecordingFilename ---------------------------------------

test('generateRecordingFilename produces a readable, timestamp-based name with the correct extension for the actual recorded format', () => {
  const name = generateRecordingFilename('audio/webm;codecs=opus', new Date(2026, 7, 13, 14, 30, 22));
  assert.equal(name, 'recording-2026-08-13-143022.webm');
});

test('generateRecordingFilename correctly zero-pads every component', () => {
  const name = generateRecordingFilename('audio/mp4', new Date(2026, 0, 5, 9, 5, 3));
  assert.equal(name, 'recording-2026-01-05-090503.m4a');
});

test('generateRecordingFilename produces a different name for two recordings a second apart', () => {
  const nameA = generateRecordingFilename('audio/webm', new Date(2026, 7, 13, 14, 30, 22));
  const nameB = generateRecordingFilename('audio/webm', new Date(2026, 7, 13, 14, 30, 23));
  assert.notEqual(nameA, nameB);
});
