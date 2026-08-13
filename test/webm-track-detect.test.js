import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWebmHasVideoTrack } from '../src/webm-track-detect.js';

// A minimal, independent EBML encoder for building test fixtures --
// deliberately NOT sharing any logic with webm-track-detect.js itself,
// so a shared misunderstanding of the spec can't hide as a passing test.

function encodeSize(value, length) {
  const marker = 0x80 >> (length - 1);
  const bytes = new Array(length).fill(0);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  bytes[0] |= marker;
  return bytes;
}

function encodeIdBytes(idValue, length) {
  const bytes = new Array(length).fill(0);
  let v = idValue;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return bytes;
}

function element(idValue, idByteLength, payload) {
  const idBytes = encodeIdBytes(idValue, idByteLength);
  const sizeBytes = encodeSize(payload.length, 1);
  return [...idBytes, ...sizeBytes, ...payload];
}

function uint(value, length) {
  const bytes = new Array(length).fill(0);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return bytes;
}

function buildTrackEntry(trackType) {
  const trackTypeEl = element(0x83, 1, uint(trackType, 1));
  return element(0xae, 1, trackTypeEl);
}

function buildWebm(trackTypes) {
  const ebmlHeader = element(0x1a45dfa3, 4, [0x01]);
  const trackEntries = trackTypes.flatMap(buildTrackEntry);
  const tracks = element(0x1654ae6b, 4, trackEntries);
  const segment = element(0x18538067, 4, tracks);
  return new Uint8Array([...ebmlHeader, ...segment]);
}

// ---- detectWebmHasVideoTrack --------------------------------------------

test('THE FIX: an audio-only WebM (one track, TrackType=2) correctly returns false', () => {
  assert.equal(detectWebmHasVideoTrack(buildWebm([2])), false);
});

test('THE FIX: a video WebM (one track, TrackType=1) correctly returns true', () => {
  assert.equal(detectWebmHasVideoTrack(buildWebm([1])), true);
});

test('a WebM with both an audio track and a video track returns true -- any video track present is enough', () => {
  assert.equal(detectWebmHasVideoTrack(buildWebm([2, 1])), true);
});

test('track order does not matter -- video-then-audio also correctly returns true', () => {
  assert.equal(detectWebmHasVideoTrack(buildWebm([1, 2])), true);
});

test('multiple audio tracks, no video at all, correctly returns false', () => {
  assert.equal(detectWebmHasVideoTrack(buildWebm([2, 2])), false);
});

test('not a real EBML file at all returns null, not false -- "couldn\u2019t determine" is distinct from "definitely audio"', () => {
  assert.equal(detectWebmHasVideoTrack(new Uint8Array([1, 2, 3, 4, 5])), null);
});

test('an empty buffer returns null without throwing', () => {
  assert.equal(detectWebmHasVideoTrack(new Uint8Array([])), null);
});

test('a truncated buffer (cut off mid-header) returns null without throwing', () => {
  assert.equal(detectWebmHasVideoTrack(new Uint8Array([0x1a, 0x45])), null);
});

test('a valid EBML header with nothing after it returns null without throwing', () => {
  assert.equal(detectWebmHasVideoTrack(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x01])), null);
});

test('a declared element size that exceeds the actual buffer length returns null without throwing -- malformed/truncated input, not a crash', () => {
  assert.equal(detectWebmHasVideoTrack(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0x01])), null);
});

test('THE FIX: a Cluster element appearing before Tracks stops the scan and returns null, rather than attempting to parse into the file\u2019s own actual frame data', () => {
  const ebmlHeader = element(0x1a45dfa3, 4, [0x01]);
  const cluster = element(0x1f43b675, 4, [0x00, 0x00, 0x00]); // stand-in "frame data"
  const trackEntries = buildTrackEntry(2);
  const tracks = element(0x1654ae6b, 4, trackEntries);
  const segment = element(0x18538067, 4, [...cluster, ...tracks]); // Cluster BEFORE Tracks
  const bytes = new Uint8Array([...ebmlHeader, ...segment]);
  assert.equal(detectWebmHasVideoTrack(bytes), null);
});

test('a Tracks element with no TrackEntry children at all returns null, not false -- genuinely can\u2019t tell, not "definitely audio"', () => {
  const ebmlHeader = element(0x1a45dfa3, 4, [0x01]);
  const tracks = element(0x1654ae6b, 4, []); // empty Tracks
  const segment = element(0x18538067, 4, tracks);
  const bytes = new Uint8Array([...ebmlHeader, ...segment]);
  assert.equal(detectWebmHasVideoTrack(bytes), null);
});

test('a TrackEntry with no TrackType field at all still counts as "saw a track" (no video found, but not an empty Tracks either) -- returns false, not null', () => {
  const ebmlHeader = element(0x1a45dfa3, 4, [0x01]);
  const trackEntryWithoutType = element(0xae, 1, []); // TrackEntry present, but no TrackType inside it
  const tracks = element(0x1654ae6b, 4, trackEntryWithoutType);
  const segment = element(0x18538067, 4, tracks);
  const bytes = new Uint8Array([...ebmlHeader, ...segment]);
  assert.equal(detectWebmHasVideoTrack(bytes), false);
});
