/**
 * Determines whether a WebM (Matroska-family) file actually has a video
 * track, by reading its own real container structure -- resolving the
 * one genuine ambiguity in Attach > Open's own MIME-type guessing
 * (guessViewableMimeType, link-resolve.js): .webm is a legitimate
 * container for BOTH audio-only and audio+video content, and this
 * app's own recording feature specifically produces the audio-only
 * kind (see attach.js's own extensionForRecordedMimeType) -- but a
 * hand-attached .webm could just as easily be an actual video someone
 * picked from their files. Rather than continuing to guess based on
 * "which is more likely for this app," this reads the file's own
 * declared track types directly, the same information any real media
 * player already relies on to decide how to play the file.
 *
 * WebM's own container format is Extensible Binary Meta Language
 * (EBML) -- a nested structure of `{ id, size, data }` elements, the
 * same base format the full Matroska spec builds on. This walks only
 * the specific, narrow path actually needed to answer "is there a
 * video track": EBML header (a sanity check, not actually inspected
 * further) -> Segment -> Tracks -> each TrackEntry -> its own
 * TrackType field. It is deliberately NOT a general-purpose EBML/
 * Matroska parser -- no Cues, Tags, Attachments, Chapters, or any of
 * Matroska's own many other top-level elements are read at all, and
 * the scan gives up cleanly (returns null, "couldn't determine")
 * rather than attempting to parse into a Cluster element, where the
 * file's own actual audio/video frame data lives -- there is nothing
 * relevant to this specific question past that point, and Clusters
 * can be the overwhelming majority of a file's own total size.
 */

// EBML element IDs relevant to this one narrow question -- their own
// canonical numeric values already include the length-marker bits
// baked in (part of how EBML IDs are actually defined), unlike a
// size/length VINT, which strips its own marker bit before use.
const EBML_HEADER_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_TYPE_ID = 0x83;
const CLUSTER_ID = 0x1f43b675; // where frame data starts -- the signal to stop scanning, not to descend into

// Matroska's own documented TrackType enum -- only the one value this
// module actually needs to recognize.
const TRACK_TYPE_VIDEO = 1;

/** Reads one EBML variable-length integer (VINT) starting at `pos`.
 *  The number of leading zero bits in the first byte (before the
 *  first 1 bit) determines the VINT's own total length in bytes (1
 *  through 8) -- this is EBML's own actual, documented encoding, not
 *  an approximation of it. `stripMarker` controls whether that
 *  leading marker bit itself is kept as part of the returned value
 *  (element IDs keep it -- it's part of their own canonical numeric
 *  value) or discarded (element sizes strip it -- only the remaining
 *  bits are the actual size). Returns null on truncated input or a
 *  reserved/invalid first byte (0x00), rather than producing a
 *  garbage value silently. */
function readVint(bytes, pos, stripMarker) {
  if (pos >= bytes.length) return null;
  const first = bytes[pos];
  if (first === 0) return null; // reserved in EBML -- not a valid VINT start
  let length = 1;
  let mask = 0x80;
  while (mask > 0 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (mask === 0 || pos + length > bytes.length) return null;
  let value = stripMarker ? first & (mask - 1) : first;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
  }
  return { value, length };
}

/** Reads one EBML element's own header (id + size) starting at `pos`,
 *  without touching its data payload at all -- returns
 *  { id, dataStart, dataSize }, where dataStart/dataStart+dataSize is
 *  exactly the byte range a caller would need to either read (if this
 *  element is relevant) or skip entirely (if it isn't) to reach the
 *  next sibling element. Returns null on truncated/malformed input. */
function readElementHeader(bytes, pos) {
  const idInfo = readVint(bytes, pos, false);
  if (!idInfo) return null;
  const sizeInfo = readVint(bytes, pos + idInfo.length, true);
  if (!sizeInfo) return null;
  const dataStart = pos + idInfo.length + sizeInfo.length;
  if (dataStart + sizeInfo.value > bytes.length) return null; // declared size runs past the actual buffer -- truncated/malformed
  return { id: idInfo.value, dataStart, dataSize: sizeInfo.value };
}

/** Scans the direct children of a `[rangeStart, rangeEnd)` byte range
 *  for the first element whose id is in `wantedIds` -- a plain linear
 *  walk, since every level this module actually needs to search
 *  (Segment's own direct children, Tracks' own direct children,
 *  TrackEntry's own direct children) is a flat list, not a tree that
 *  needs real recursion. `stopIds`, if given, ends the scan early
 *  (returning null) the moment one of those element ids is
 *  encountered, without descending into it -- specifically for
 *  Cluster, see this file's own header comment for why. */
function findFirstChild(bytes, rangeStart, rangeEnd, wantedIds, stopIds = []) {
  let pos = rangeStart;
  while (pos < rangeEnd) {
    const el = readElementHeader(bytes, pos);
    if (!el) return null;
    if (wantedIds.includes(el.id)) return el;
    if (stopIds.includes(el.id)) return null;
    pos = el.dataStart + el.dataSize;
  }
  return null;
}

/** The actual answer this whole module exists to produce: true if
 *  `bytes` (a WebM/Matroska file's own raw bytes, or at least enough
 *  of its own leading bytes to reach the Tracks element -- the full
 *  file is never required) declares at least one video track; false
 *  if it declares tracks but none of them are video (the ordinary
 *  audio-only-recording case); null if this couldn't be determined at
 *  all -- not a real WebM file, truncated input, or (rare, for a
 *  file whose own Tracks element genuinely sits unusually late)
 *  the scan reaching a Cluster element before ever finding Tracks.
 *  A null result is deliberately NOT the same as false -- callers
 *  should fall back to their own existing default/heuristic in that
 *  case, not silently treat "couldn't tell" as "definitely audio." */
export function detectWebmHasVideoTrack(bytes) {
  const header = readElementHeader(bytes, 0);
  if (!header || header.id !== EBML_HEADER_ID) return null; // not a real EBML/WebM file at all

  const afterHeader = header.dataStart + header.dataSize;
  const segment = findFirstChild(bytes, afterHeader, bytes.length, [SEGMENT_ID]);
  if (!segment) return null;

  const tracks = findFirstChild(bytes, segment.dataStart, segment.dataStart + segment.dataSize, [TRACKS_ID], [CLUSTER_ID]);
  if (!tracks) return null;

  const tracksEnd = tracks.dataStart + tracks.dataSize;
  let pos = tracks.dataStart;
  let sawAnyTrack = false;
  while (pos < tracksEnd) {
    const entry = readElementHeader(bytes, pos);
    if (!entry) return sawAnyTrack ? false : null;
    if (entry.id === TRACK_ENTRY_ID) {
      sawAnyTrack = true;
      const trackType = findFirstChild(bytes, entry.dataStart, entry.dataStart + entry.dataSize, [TRACK_TYPE_ID]);
      if (trackType && trackType.dataSize >= 1 && bytes[trackType.dataStart] === TRACK_TYPE_VIDEO) {
        return true;
      }
    }
    pos = entry.dataStart + entry.dataSize;
  }
  return sawAnyTrack ? false : null; // Tracks existed but was empty/unparseable -- genuinely can't tell, not "definitely audio"
}
