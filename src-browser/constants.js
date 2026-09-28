// Extracted from app.js: constants. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).

export const GLOBAL_TODO_DEFAULT = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

export const REFILE_RECENT_KEY = 'refile:recent';

export const WEATHER_CACHE_KEY = 'weather:cache';

export const PALETTE_RECENT_KEY = 'palette:recent';

// Content-keyed cache for rendered #+PLOT: SVGs (see renderTableRow's own
// "Plot" button below) -- keyed by the table's own plot text plus its own
// cell data, never by the table object's identity, which isn't stable:
// any edit anywhere in a heading's own body fully reparses heading.body
// (see commitLines in body-edit.js), recreating every table node within
// it fresh, confirmed directly before choosing this design over a
// simpler WeakMap. A plain Map survives that recreation correctly: an
// unrelated edit elsewhere produces a table object with the exact same
// plot+cell content, which still hashes to the same cache key and hits.
// Capped so a long session's worth of distinct plot configurations
// doesn't grow this unbounded -- evicts the single oldest entry (Map
// iteration order is insertion order) once the cap is hit.
export const PLOT_SVG_CACHE_LIMIT = 200;

export const NAVIGATION_BACK_STACK_LIMIT = 20;

// Marks every link/image-produced DOM element so container click handlers
// (checkbox-cycle on a list-item row, edit-on-click on a paragraph) can
// detect "this click landed on a link, don't also trigger my own handler"
// via a single e.target.closest('[data-inline-link]') check, rather than
// each link type needing its own stopPropagation wiring.
export const INLINE_LINK_ATTR = 'data-inline-link';

export const SIDE_PANEL_MIN_WIDTH = 280;

/** How many lines of one side of a conflict to show before truncating --
 *  a whole-file fallback conflict can be thousands of lines long. */
export const CONFLICT_PREVIEW_LINES = 40;

export const RECENT_FILES_DISPLAY_LIMIT = 8;

export const HELP_DOCUMENT_ID = '\u0000help-README.org';

export const SEARCH_TYPE_ICON = {
  heading: '\u25c9',
  paragraph: '\u00b6',
  'list-item': '\u2022',
  table: '\u25a6',
  block: '\u2318',
  property: '\ud83c\udff7\ufe0f',
  planning: '\ud83d\udcc5',
};

export const CAPTURE_TYPES = ['item', 'checkitem', 'plain', 'table-line'];
