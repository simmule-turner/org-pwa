// @ts-check
// The places the Open / Save As screen browses (GitHub, WebDAV, this device), where the person was last in each, and which
// place it opens on. src-browser/file-screen.js draws it; this file holds the rules so they can be tested without a browser.

/** @typedef {'github' | 'webdav' | 'device'} Place */
/** @typedef {{ place: Place, folder: string }} Spot */
/** @typedef {{ place: Place | null, folders: Record<Place, string>, recent: Spot[] }} Location */

/** The places, in the order they are listed. @type {Place[]} */
export const PLACES = ['github', 'webdav', 'device'];

export const PLACE_NAMES = /** @type {Record<Place, string>} */ ({ github: 'GitHub', webdav: 'WebDAV', device: 'This device' });

/** How many recent folders are kept. */
export const RECENT_LIMIT = 5;

/** @param {unknown} p @returns {p is Place} */
function isPlace(p) {
  return PLACES.includes(/** @type {Place} */ (p));
}

/** A location with nothing remembered yet. @returns {Location} */
export function emptyLocation() {
  return { place: null, folders: { github: '', webdav: '', device: '' }, recent: [] };
}

/**
 * What was stored, made safe to use: only known places and plain strings are kept. The earlier screen stored one type name
 * ('local' for this device), which is read as that place, in its root.
 * @param {unknown} stored  the stored location, or an earlier type name, or nothing
 * @returns {Location}
 */
export function normalizeLocation(stored) {
  const out = emptyLocation();
  if (typeof stored === 'string') {
    out.place = stored === 'local' ? 'device' : isPlace(stored) ? /** @type {Place} */ (stored) : null;
    return out;
  }
  if (!stored || typeof stored !== 'object') return out;
  const s = /** @type {{place?: unknown, folders?: Record<string, unknown>, recent?: Array<{place?: unknown, folder?: unknown} | null>}} */ (stored);
  if (isPlace(s.place)) out.place = s.place;
  for (const p of PLACES) if (s.folders && typeof s.folders[p] === 'string') out.folders[p] = s.folders[p];
  if (Array.isArray(s.recent)) {
    for (const r of s.recent) {
      if (r && isPlace(r.place) && typeof r.folder === 'string' && out.recent.length < RECENT_LIMIT && !out.recent.some((x) => x.place === r.place && x.folder === r.folder)) out.recent.push({ place: r.place, folder: r.folder });
    }
  }
  return out;
}

/**
 * The location after the person is in `folder` of `place`: that is now the last place, the folder is that place's own, and the
 * spot goes to the top of the recent list.
 * @param {Location} loc @param {Place} place @param {string} folder
 * @returns {Location}
 */
export function rememberLocation(loc, place, folder) {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  const recent = [{ place, folder: clean }, ...loc.recent.filter((r) => !(r.place === place && r.folder === clean))].slice(0, RECENT_LIMIT);
  return { place, folders: { ...loc.folders, [place]: clean }, recent };
}

/**
 * Where the screen opens: the last place when it can be used, else the most recent place that can, else the first one listed
 * that can. This device can always be used (it is a chooser or an import), so there is always an answer. First use opens on this
 * device, as the screen always has.
 * @param {Location} loc @param {Record<Place, boolean>} ready  whether each place can be browsed now
 * @returns {{ place: Place, folder: string, note: string | null }}
 */
export function startingPlace(loc, ready) {
  const wanted = loc.place ?? 'device';
  /** @type {Place[]} */
  const order = [wanted, ...loc.recent.map((r) => r.place), ...PLACES];
  const place = order.find((p) => p === 'device' || ready[p]) ?? 'device';
  const note = loc.place && place !== loc.place ? `${PLACE_NAMES[loc.place]} isn't available, so this opened ${PLACE_NAMES[place]} instead.` : null;
  return { place, folder: loc.folders[place] ?? '', note };
}

/** A folder as a short label: its last part, or the place's name for its top. @param {Place} place @param {string} folder */
export function spotLabel(place, folder) {
  const parts = folder.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : PLACE_NAMES[place];
}
