// @ts-check
// What the Files view does to files: copy, move, delete, make a folder or an empty file, in GitHub, WebDAV or on this device.
// None of the three has a rename or copy of its own that works the same way, so a copy reads the bytes and writes them at the
// new path (also from one place to another), and a move is that copy followed by a delete of the original, which is only done
// once the copy is written. A folder is its files: GitHub keeps no empty folders, so a new folder holds a `.gitkeep`.
import { cleanPath } from '../src/file-ops.js';
import { githubAdapter, webdavAdapter } from './adapters.js';
import { deviceIo } from './device-folder.js';

/** @typedef {'github' | 'webdav' | 'device'} Place */
/** @typedef {import('../src/file-ops.js').FileEntry} FileEntry */
/** @typedef {{ list: (folder: string) => Promise<FileEntry[]>, readBinary: (path: string) => Promise<{ base64?: string } | null | undefined | any>, writeBinary: (path: string, base64: string) => Promise<any>, delete: (path: string) => Promise<any> }} PlaceIo */

/** What reads and writes bytes in `place`. @param {Place} place @returns {PlaceIo} */
export function ioOf(place) {
  if (place === 'github') return /** @type {PlaceIo} */ (/** @type {unknown} */ (githubAdapter));
  if (place === 'webdav') return /** @type {PlaceIo} */ (/** @type {unknown} */ (webdavAdapter));
  return /** @type {PlaceIo} */ (/** @type {unknown} */ (deviceIo()));
}

/** Every file at or below `entry`, as paths, folders walked depth-first. @param {Place} place @param {{ path: string, type: 'file' | 'dir' }} entry @returns {Promise<string[]>} */
export async function filesUnder(place, entry) {
  if (entry.type === 'file') return [cleanPath(entry.path)];
  const out = [];
  for (const child of await ioOf(place).list(cleanPath(entry.path))) out.push(...(await filesUnder(place, child)));
  return out;
}

/** Copies the file or folder `entry` of `from` to the path `to` in `into`, reading each file in full before it writes it.
 * @param {Place} from @param {{ path: string, type: 'file' | 'dir' }} entry @param {Place} into @param {string} to
 * @returns {Promise<number>} the number of files written */
export async function copyEntry(from, entry, into, to) {
  const source = cleanPath(entry.path);
  const base = cleanPath(to).replace(/\/+$/, '');
  let count = 0;
  for (const path of await filesUnder(from, entry)) {
    const target = entry.type === 'file' ? base : base + path.slice(source.length);
    const bytes = await ioOf(from).readBinary(path);
    if (!bytes || typeof bytes.base64 !== 'string') throw new Error(bytes && bytes.tooLarge ? `"${path}" is too large to copy.` : `Could not read "${path}".`);
    await ioOf(into).writeBinary(target, bytes.base64);
    count++;
  }
  return count;
}

/** Deletes the file or folder `entry`: a folder file by file, then the folder itself where the place keeps folders (WebDAV, a device). @param {Place} place @param {{ path: string, type: 'file' | 'dir' }} entry */
export async function removeEntry(place, entry) {
  const io = ioOf(place);
  for (const path of await filesUnder(place, entry)) await io.delete(path);
  if (entry.type === 'dir' && place !== 'github') await io.delete(cleanPath(entry.path)).catch(() => {});
}

/** Makes the folder `path`, holding a `.gitkeep` so that it exists in every place. @param {Place} place @param {string} path */
export async function makeFolder(place, path) {
  await ioOf(place).writeBinary(cleanPath(path).replace(/\/+$/, '') + '/.gitkeep', '');
}

/** Makes an empty file at `path`. @param {Place} place @param {string} path */
export async function makeFile(place, path) {
  await ioOf(place).writeBinary(cleanPath(path), '');
}

/** What is at `path`'s folder, for the overwrite check; null when it cannot be listed. @param {Place} place @param {string} folder */
export async function listing(place, folder) {
  try {
    return await ioOf(place).list(cleanPath(folder));
  } catch {
    return null;
  }
}
