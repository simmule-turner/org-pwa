import test from 'node:test';
import assert from 'node:assert/strict';
import { convertNonUtf8, decodeNonUtf8, decodeText, forgetNonUtf8, isNonUtf8, markConverted, refuseNonUtf8Write, ENCODING_CHOICES } from '../src/utf8.js';

const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]); // "café\n" in Latin-1: 0xE9 alone is not UTF-8

test('valid UTF-8 is read as it is and is writable', () => {
  assert.equal(decodeText(new TextEncoder().encode('café 日本 🙂'), 'a.org'), 'café 日本 🙂');
  assert.equal(isNonUtf8('a.org'), false);
  assert.doesNotThrow(() => refuseNonUtf8Write('a.org'));
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), 'a.org'), 'a'); // the byte-order mark is dropped as before
});

test('invalid bytes open as U+FFFD, read-only, and a save is refused', () => {
  const text = decodeText(latin1, 'n.org');
  assert.equal(text, 'caf�\n');
  assert.equal(isNonUtf8('n.org'), true);
  assert.throws(() => refuseNonUtf8Write('n.org'), /not valid UTF-8.*Convert to UTF-8/s);
  assert.equal(isNonUtf8('other.org'), false);
});

test('Convert decodes the original bytes again with the named encoding and then allows the save', () => {
  decodeText(latin1, 'c.org');
  assert.equal(decodeNonUtf8('c.org', 'windows-1252'), 'café\n');
  assert.equal(isNonUtf8('c.org'), true, 'choosing is not converting until it is confirmed');
  assert.equal(convertNonUtf8('c.org', ' latin1 '), 'café\n');
  assert.equal(isNonUtf8('c.org'), false);
  assert.doesNotThrow(() => refuseNonUtf8Write('c.org'));
  // the save's own read of the unchanged file does not take the permission back
  assert.equal(decodeText(latin1, 'c.org'), 'caf�\n');
  assert.equal(isNonUtf8('c.org'), false);
  // a file that changed on storage is a new, unconverted one
  decodeText(Uint8Array.from([0xe9, 0xe9]), 'c.org');
  assert.equal(isNonUtf8('c.org'), true);
  // once written, it is UTF-8 on storage
  markConverted('c.org');
  forgetNonUtf8('c.org');
  assert.equal(isNonUtf8('c.org'), false);
});

test('UTF-16 and other labels work; unknown labels and files not waiting are errors', () => {
  const utf16 = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00, 0xe9, 0x00]);
  decodeText(utf16, 'u.org');
  assert.equal(decodeNonUtf8('u.org', 'utf-16le'), 'hié');
  assert.throws(() => decodeNonUtf8('u.org', 'not-an-encoding'), /not an encoding/);
  assert.throws(() => convertNonUtf8('never-read.org', 'windows-1252'), /not waiting/);
  assert.ok(ENCODING_CHOICES.some((c) => c.label === 'windows-1252') && ENCODING_CHOICES.some((c) => c.label.startsWith('utf-16')));
  for (const { label } of ENCODING_CHOICES) assert.doesNotThrow(() => new TextDecoder(label), label);
});
