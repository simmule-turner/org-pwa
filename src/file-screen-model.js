// @ts-check
// The pure parts of the Open / Save As screen: the path and listing helpers behind its folder list (the places and which one it
// opens on are in file-places.js). src-browser/file-screen.js draws it.

/** @typedef {{ name: string, path: string, type: 'file' | 'dir' }} BrowseEntry */

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
