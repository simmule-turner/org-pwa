import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLocation, normalizeLocation, rememberLocation, spotLabel, startingPlace } from '../src/file-places.js';

const all = { github: true, webdav: true, device: true };

test('first use opens on this device, as the screen always has', () => {
  assert.deepEqual(startingPlace(emptyLocation(), all), { place: 'device', folder: '', note: null });
});

test('an earlier stored type name is read as a place', () => {
  assert.equal(normalizeLocation('local').place, 'device');
  assert.equal(normalizeLocation('webdav').place, 'webdav');
  assert.equal(normalizeLocation('nope').place, null);
  assert.equal(normalizeLocation(undefined).place, null);
});

test('what is stored is cleaned: only known places and string folders, no repeats, at most five recents', () => {
  const loc = normalizeLocation({
    place: 'github',
    folders: { github: 'notes', webdav: 5, device: 'Downloads', x: 'y' },
    recent: [{ place: 'github', folder: 'notes' }, { place: 'github', folder: 'notes' }, { place: 'ftp', folder: 'a' }, { place: 'webdav', folder: 3 }, ...['a', 'b', 'c', 'd', 'e'].map((f) => ({ place: 'device', folder: f }))],
  });
  assert.deepEqual(loc.folders, { github: 'notes', webdav: '', device: 'Downloads' });
  assert.equal(loc.recent.length, 5);
  assert.deepEqual(loc.recent[0], { place: 'github', folder: 'notes' });
});

test('being somewhere makes it the last place, remembers its folder and puts it first in the recents', () => {
  let loc = rememberLocation(emptyLocation(), 'github', 'notes/');
  loc = rememberLocation(loc, 'webdav', '');
  loc = rememberLocation(loc, 'github', '/notes');
  assert.equal(loc.place, 'github');
  assert.deepEqual(loc.folders, { github: 'notes', webdav: '', device: '' });
  assert.deepEqual(loc.recent, [{ place: 'github', folder: 'notes' }, { place: 'webdav', folder: '' }]);
  assert.deepEqual(startingPlace(loc, all), { place: 'github', folder: 'notes', note: null });
});

test('the screen opens in the folder each place was last in', () => {
  let loc = rememberLocation(emptyLocation(), 'github', 'notes');
  loc = rememberLocation(loc, 'webdav', 'work/2026');
  assert.equal(startingPlace(loc, all).folder, 'work/2026');
});

test('a last place that cannot be used falls back to the most recent one that can, and says so', () => {
  let loc = rememberLocation(emptyLocation(), 'webdav', 'work');
  loc = rememberLocation(loc, 'github', 'notes');
  const r = startingPlace(loc, { github: false, webdav: true, device: true });
  assert.deepEqual(r, { place: 'webdav', folder: 'work', note: "GitHub isn't available, so this opened WebDAV instead." });
});

test('with no other place usable it falls back to this device', () => {
  const loc = rememberLocation(emptyLocation(), 'github', 'notes');
  const r = startingPlace(loc, { github: false, webdav: false, device: true });
  assert.equal(r.place, 'device');
  assert.equal(r.note, "GitHub isn't available, so this opened This device instead.");
});

test('a place with no recent use is tried in the order listed', () => {
  const loc = { ...emptyLocation(), place: /** @type {const} */ ('webdav') };
  assert.equal(startingPlace(loc, { github: true, webdav: false, device: true }).place, 'github');
});

test('a folder is labeled by its last part, a top folder by the place', () => {
  assert.equal(spotLabel('github', 'org/notes'), 'notes');
  assert.equal(spotLabel('device', ''), 'This device');
});
