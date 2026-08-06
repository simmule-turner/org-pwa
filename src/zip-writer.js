/**
 * A minimal ZIP archive writer, dependency-free -- no npm package, no
 * build step, just plain bytes assembled by hand. Uses the STORE
 * method (no compression) throughout, which the ZIP spec has always
 * supported as a first-class option, not a fallback: every ZIP reader
 * (including every office suite that opens .odt/.docx/.xlsx, which are
 * themselves just ZIP archives) handles stored entries identically to
 * compressed ones. Trading away compression keeps this small, simple,
 * and easy to verify correct by hand, which matters more here than
 * shaving a few kilobytes off a text-heavy document export.
 *
 * Used by export-odt.js to package content.xml/styles.xml/etc. into a
 * real .odt file, but deliberately has no ODT-specific knowledge of
 * its own -- just "here are some named byte blobs, produce a valid ZIP
 * containing them."
 */

// ---- CRC-32 -----------------------------------------------------------

let crcTable = null;

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** Standard ZIP CRC-32 over a byte array. */
function crc32(bytes) {
  if (!crcTable) crcTable = buildCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- byte-writing helpers -----------------------------------------------

function utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

/** DOS date/time encoding ZIP's local/central headers require --
 *  fixed to a single, arbitrary timestamp (2026-01-01 00:00:00) rather
 *  than the actual export moment, so exporting the exact same document
 *  twice produces byte-identical output. That determinism is worth
 *  more here than an accurate "last modified" stamp nobody reading an
 *  exported .odt actually needs. */
function dosDateTime() {
  return { time: 0, date: (2026 - 1980) << 9 | (1 << 5) | 1 };
}

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  bytes(arr) {
    this.chunks.push(arr);
    this.length += arr.length;
  }
  u16(n) {
    this.bytes(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }
  u32(n) {
    this.bytes(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// ---- public API -----------------------------------------------------------

/**
 * Builds a ZIP archive (as a Uint8Array) from `entries`, an array of
 * `{ name, content }` -- `name` the path within the archive (e.g.
 * "content.xml" or "META-INF/manifest.xml"), `content` either a string
 * (UTF-8 encoded automatically) or an already-encoded Uint8Array.
 *
 * Entries are written in the given order, uncompressed (STORE), each
 * with its own local file header, followed by one central directory
 * record per entry and a single end-of-central-directory record --
 * the standard three-part ZIP structure every reader expects.
 */
function createZip(entries) {
  const w = new ByteWriter();
  const { time, date } = dosDateTime();
  const centralRecords = [];

  for (const entry of entries) {
    const nameBytes = utf8Bytes(entry.name);
    const dataBytes = typeof entry.content === 'string' ? utf8Bytes(entry.content) : entry.content;
    const crc = crc32(dataBytes);
    const localOffset = w.length;

    // Local file header
    w.u32(0x04034b50);
    w.u16(20); // version needed to extract
    w.u16(0); // general purpose flag
    w.u16(0); // compression method: 0 = stored
    w.u16(time);
    w.u16(date);
    w.u32(crc);
    w.u32(dataBytes.length); // compressed size == uncompressed size (stored)
    w.u32(dataBytes.length);
    w.u16(nameBytes.length);
    w.u16(0); // extra field length
    w.bytes(nameBytes);
    w.bytes(dataBytes);

    centralRecords.push({ nameBytes, crc, size: dataBytes.length, localOffset });
  }

  const centralDirStart = w.length;
  for (const rec of centralRecords) {
    w.u32(0x02014b50);
    w.u16(20); // version made by
    w.u16(20); // version needed to extract
    w.u16(0); // general purpose flag
    w.u16(0); // compression method
    w.u16(time);
    w.u16(date);
    w.u32(rec.crc);
    w.u32(rec.size);
    w.u32(rec.size);
    w.u16(rec.nameBytes.length);
    w.u16(0); // extra field length
    w.u16(0); // comment length
    w.u16(0); // disk number start
    w.u16(0); // internal file attributes
    w.u32(0); // external file attributes
    w.u32(rec.localOffset);
    w.bytes(rec.nameBytes);
  }
  const centralDirSize = w.length - centralDirStart;

  // End of central directory record
  w.u32(0x06054b50);
  w.u16(0); // disk number
  w.u16(0); // disk with central directory
  w.u16(centralRecords.length); // entries on this disk
  w.u16(centralRecords.length); // total entries
  w.u32(centralDirSize);
  w.u32(centralDirStart);
  w.u16(0); // comment length

  return w.toUint8Array();
}

export { createZip, crc32 };
