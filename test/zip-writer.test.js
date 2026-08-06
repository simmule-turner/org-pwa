import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createZip, crc32 } from '../src/zip-writer.js';

// ---- crc32 --------------------------------------------------------------

test('crc32 of an empty array is 0', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('crc32 matches a known reference value for "123456789"', () => {
  // The standard CRC-32 (IEEE 802.3, the same polynomial ZIP uses) test
  // vector -- 0xCBF43926 is the universally-cited reference value for
  // this exact input, used to verify a CRC-32 implementation is correct
  // against the standard rather than just self-consistent.
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('crc32 is deterministic -- the same input always produces the same output', () => {
  const bytes = new TextEncoder().encode('some content');
  assert.equal(crc32(bytes), crc32(bytes));
});

test('crc32 differs for different content', () => {
  const a = new TextEncoder().encode('content A');
  const b = new TextEncoder().encode('content B');
  assert.notEqual(crc32(a), crc32(b));
});

// ---- createZip: structural correctness, verified against the real unzip ----

function verifyWithRealUnzip(zipBytes, expectedEntries) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-writer-test-'));
  const zipPath = path.join(dir, 'test.zip');
  writeFileSync(zipPath, zipBytes);

  // Integrity check via the real, independent unzip tool -- not just
  // "did our own code accept its own output," an actual external
  // verifier confirming this is a well-formed ZIP file any reader
  // could open.
  const testOutput = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
  assert.match(testOutput, /No errors detected/);

  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
  for (const [name, expectedContent] of Object.entries(expectedEntries)) {
    const actual = readFileSync(path.join(dir, name), 'utf8');
    assert.equal(actual, expectedContent, `entry "${name}" content should match`);
  }
}

test('a single-entry zip round-trips correctly through the real unzip tool', () => {
  const zip = createZip([{ name: 'hello.txt', content: 'Hello, world!' }]);
  verifyWithRealUnzip(zip, { 'hello.txt': 'Hello, world!' });
});

test('multiple entries, including a nested path, all round-trip correctly', () => {
  const zip = createZip([
    { name: 'mimetype', content: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', content: '<xml>content</xml>' },
    { name: 'META-INF/manifest.xml', content: '<manifest>test</manifest>' },
  ]);
  verifyWithRealUnzip(zip, {
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': '<xml>content</xml>',
    'META-INF/manifest.xml': '<manifest>test</manifest>',
  });
});

test('an empty-content entry round-trips correctly (a zero-byte file is still a valid zip entry)', () => {
  const zip = createZip([{ name: 'empty.txt', content: '' }]);
  verifyWithRealUnzip(zip, { 'empty.txt': '' });
});

test('a Uint8Array entry (already-encoded bytes, not a string) is stored and extracted correctly', () => {
  const bytes = new TextEncoder().encode('binary-ish content');
  const zip = createZip([{ name: 'data.bin', content: bytes }]);
  verifyWithRealUnzip(zip, { 'data.bin': 'binary-ish content' });
});

test('content with non-ASCII (UTF-8) characters round-trips correctly', () => {
  const zip = createZip([{ name: 'unicode.txt', content: 'em dash \u2014 and accents: caf\u00e9' }]);
  verifyWithRealUnzip(zip, { 'unicode.txt': 'em dash \u2014 and accents: caf\u00e9' });
});

test('an empty entries array still produces a structurally valid end-of-central-directory record', () => {
  const zip = createZip([]);
  // 22 bytes is exactly the size of a bare end-of-central-directory
  // record with no entries and no comment -- the minimum possible
  // valid zip.
  assert.equal(zip.length, 22);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.length);
  assert.equal(view.getUint32(0, true), 0x06054b50); // end-of-central-directory signature
  assert.equal(view.getUint16(10, true), 0); // total entries
});

test('createZip returns a Uint8Array', () => {
  const zip = createZip([{ name: 'a.txt', content: 'a' }]);
  assert.ok(zip instanceof Uint8Array);
});
