// Extracted from app.js: singletons. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { createIndexedDbAdapter } from './indexeddb-adapter.js';

export const kv = createIndexedDbAdapter();

// parsed from globalVariablesText -- kept in sync by setGlobalVariablesAndReparse below
export const agendaFilesCache = new Map();

export const contactsFilesCache = new Map();

export const plotSvgCache = new Map();

/**
 * If the plain-text editor is currently showing, commits its current
 * content into state.doc — reparsing fresh, exactly like exiting text
 * mode normally does — and returns to outline view. Returns true if it
 * actually did something.
 *
 * This is the fix for a real, major bug: state.doc only ever got updated
 * with the textarea's content when the user explicitly clicked the
 * Text/Outline toggle button to exit text mode. Every save/open/new
 * operation read state.doc directly — so hitting Save (or Save As, or
 * opening a different file) while still in text mode read the STALE
 * pre-edit document, silently discarding whatever was typed in the
 * textarea, while still reporting success. Calling this at the start of
 * every such operation ensures state.doc always reflects what's actually
 * on screen before anything reads it.
 */
export const textModeLastCommittedValue = new WeakMap();

// Cache of resolved image data: URLs, keyed by backend+path -- avoids
// re-fetching the same image on every re-render (this app re-renders
// the whole outline on any state change) and avoids a
// placeholder-then-image flash on every subsequent render once an
// image has already loaded once this session. Cleared implicitly by a
// page reload; not persisted, since a stale cached image across a
// full app restart isn't worth the complexity of invalidation logic
// for what's ultimately just avoiding a redundant network request.
export const imageDataUrlCache = new Map();
