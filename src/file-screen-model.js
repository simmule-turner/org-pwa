// @ts-check
// The pure parts of the Open / Save As screen: which storage types it offers, which one it opens on, and the path and listing
// helpers behind its folder list. src-browser/file-screen.js draws it.

/** @typedef {'github' | 'local' | 'webdav'} FileScreenType */
/** @typedef {{ name: string, path: string, type: 'file' | 'dir' }} BrowseEntry */

/** @type {FileScreenType[]} */
export const FILE_SCREEN_TYPES = ['github', 'local', 'webdav'];

/** The type the screen opens on: the remembered one when it is a known type, otherwise Local file.
 * @param {unknown} stored @returns {FileScreenType} */
export function resolveFileScreenType(stored) {
  return FILE_SCREEN_TYPES.includes(/** @type {any} */ (stored)) ? /** @type {FileScreenType} */ (stored) : 'local';
}

/** The type one step left (-1) or right (+1) of `current`, stopping at the ends.
 * @param {FileScreenType} current @param {number} delta @returns {FileScreenType} */
export function stepFileScreenType(current, delta) {
  const i = FILE_SCREEN_TYPES.indexOf(current) + delta;
  return FILE_SCREEN_TYPES[Math.max(0, Math.min(FILE_SCREEN_TYPES.length - 1, i))];
}

/** The entries worth listing: folders, .org files and org archive files, or with `all` every file. Folders first, then by name.
 * @param {BrowseEntry[]} entries @param {boolean} [all] */
export function visibleEntries(entries, all = false) {
  const keep = entries.filter((e) => e.type === 'dir' || all || /\.org$|_archive$/i.test(e.name));
  return keep.slice().sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

/** The folder above `folder` ("" is the root).
 * @param {string} folder */
export function parentFolder(folder) {
  const parts = folder.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

/** Where a name typed in `folder` lands. A leading slash in the name means "from the root".
 * @param {string} folder @param {string} name */
export function joinPath(folder, name) {
  const clean = name.trim();
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
  return [folder, clean].filter(Boolean).join('/');
}

/** True when `path` is already listed as a file in `entries` (the "Replace it?" check).
 * @param {BrowseEntry[] | null} entries @param {string} path */
export function listedAsFile(entries, path) {
  return !!entries && entries.some((e) => e.type === 'file' && e.path.replace(/^\/+/, '') === path);
}
