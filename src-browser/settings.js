/**
 * Settings persistence — GitHub credentials, theme, and font preferences,
 * all stored through the same kv adapter (IndexedDB in the browser) as
 * documents, fold-state used to be, and everything else, rather than
 * splitting settings off into localStorage as a separate persistence
 * layer for no real benefit.
 *
 * Every getter has a sensible default and never throws — a missing or
 * corrupt settings entry should never block the app from opening; it
 * should just fall back to the default, the same "fail open" principle
 * used throughout the storage layer.
 */

import { normalizeApptSettings } from '../src/appt.js';
import { normalizeAttachLinkMode } from '../src/attach.js';

const KEYS = {
  github: 'settings:github',
  webdav: 'settings:webdav',
  caldav: 'settings:caldav',
  appt: 'settings:appt',
  attachLink: 'settings:attachLink',
  theme: 'settings:theme',
  customThemeColors: 'settings:customThemeColors',
  fontFamily: 'settings:fontFamily',
  fontSize: 'settings:fontSize',
  tablesFontSize: 'settings:otherFontSize', // storage key deliberately left as "otherFontSize" -- renaming the key itself would silently reset every existing user's saved table font size back to default
  menuSize: 'settings:menuSize',
  paragraphSpacing: 'settings:paragraphSpacing',
  tablesSpacing: 'settings:tablesSpacing',
  floatingKeyboardPos: 'settings:floatingKeyboardPos',
  readingWidth: 'settings:readingWidth',
  sidePanelWidth: 'settings:sidePanelWidth',
  lastActiveDocument: 'settings:lastActiveDocument',
  openTabs: 'settings:openTabs',
  recentFiles: 'settings:recentFiles',
  captureTemplates: 'settings:captureTemplates',
  globalVariables: 'settings:globalVariables',
};

/** Ships as the default so capture works immediately with no setup —
 *  these are the four example templates from the request, translated
 *  from org-capture-templates' elisp shape into this app's JSON one:
 *  `(file+olp "" ...)` becomes `olp: [...]` (no separate file field,
 *  since this app edits one open document at a time -- see
 *  capture-template.js's resolveOlpTarget for why "" is the only
 *  meaningful file value here anyway), and `:empty-lines N` becomes
 *  `emptyLines: N`. */
const DEFAULT_CAPTURE_TEMPLATES = [
  {
    // For anything shared in from another app (see "Capturing from other apps" in the README): a web page becomes a heading
    // that is a link to it, titled as the page is, and shared text goes in the body. With no link shared there is no
    // heading text, so the prompt asks for a title; for a web page it is left blank.
    key: 'w',
    description: 'Web page or text',
    type: 'plain',
    olp: ['Inbox'],
    template: '* %a%^{Title (leave blank for a web page)}\n:PROPERTIES:\n:CREATED: %U\n:END:\n  %i\n  %?',
    emptyLines: 1,
  },
  {
    key: 'b',
    description: 'Bullet List',
    type: 'item',
    olp: ['heading 1', 'heading n'],
    template: '%? [The captured text or note]',
    emptyLines: 1,
  },
  {
    key: 'c',
    description: 'Check List',
    type: 'checkitem',
    olp: ['heading 1', 'heading n'],
    template: '%^{Item description}',
    emptyLines: 0,
  },
  {
    key: 'm',
    description: 'Meeting',
    type: 'plain',
    olp: ['Meeting Notes'],
    template:
      '* %^{Meeting Title} :meeting:\n:PROPERTIES:\n:CREATED: %U\n:END:\n** Attendees\n- %?\n** Notes\n- \n** Action Items\n*** TODO [#A] %^{Top Priority Task}',
    emptyLines: 1,
  },
  {
    key: 't',
    description: 'Table Insert prompted for values',
    type: 'table-line',
    olp: ['heading 1', '%<%Y-%m>'],
    template: '| @# | %U | %^{Description} | %^{Amount} |',
    emptyLines: 0,
  },
];

const DEFAULT_GITHUB_CONFIG = { token: '', owner: '', repo: '', branch: 'main' };
const DEFAULT_WEBDAV_CONFIG = { baseUrl: '', username: '', password: '' };
const DEFAULT_THEME = 'system'; // 'system' | 'light' | 'dark'
const DEFAULT_FONT_FAMILY = 'system'; // 'system' | 'serif' | 'monospace'
const DEFAULT_MENU_SIZE = 'regular'; // 'regular' | 'small'
const DEFAULT_PARAGRAPH_SPACING = 10; // px between paragraphs
const DEFAULT_TABLES_SPACING = 10; // px around tables and the other secondary blocks (source/quote blocks, rules), independent of the paragraph value
const MIN_SPACING = 0; // px -- 0 packs things solid, for anyone who likes dense text
const MAX_SPACING = 32; // px
const DEFAULT_READING_WIDTH = null; // null = unlimited (full width); otherwise a ch value
const DEFAULT_SIDE_PANEL_WIDTH = 420; // px -- matches the previous hard-coded side panel width
const DEFAULT_FONT_SIZE = 16; // px
const DEFAULT_TABLES_FONT_SIZE = 13; // px -- matches the previous hard-coded table font size, so introducing this setting doesn't change anyone's current appearance until they actually adjust it

function unwrap(result) {
  return result && typeof result === 'object' && 'value' in result ? result.value : result;
}

async function getJson(kvAdapter, key, fallback) {
  try {
    const result = await kvAdapter.get(key);
    if (!result) return fallback;
    const raw = unwrap(result);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

async function setJson(kvAdapter, key, value) {
  await kvAdapter.set(key, JSON.stringify(value));
}

// ---- GitHub -------------------------------------------------------------

export async function getGithubConfig(kvAdapter) {
  const stored = await getJson(kvAdapter, KEYS.github, {});
  return { ...DEFAULT_GITHUB_CONFIG, ...stored };
}

export async function setGithubConfig(kvAdapter, config) {
  const merged = { ...DEFAULT_GITHUB_CONFIG, ...config };
  await setJson(kvAdapter, KEYS.github, merged);
  return merged;
}

// ---- WebDAV ------------------------------------------------------------

export async function getWebdavConfig(kvAdapter) {
  const stored = await getJson(kvAdapter, KEYS.webdav, {});
  return { ...DEFAULT_WEBDAV_CONFIG, ...stored };
}

export async function setWebdavConfig(kvAdapter, config) {
  const merged = { ...DEFAULT_WEBDAV_CONFIG, ...config };
  await setJson(kvAdapter, KEYS.webdav, merged);
  return merged;
}

// ---- CalDAV and CardDAV (the calendar the agenda is mirrored to, the address book the contacts are) ----------------

const DEFAULT_CALDAV_CONFIG = { url: '', contactsUrl: '', username: '', password: '' };
const CALDAV_SYNC_KEY = 'caldavSync'; // not in KEYS on purpose: KEYS is what backups export, and this is not a setting
const CARDDAV_SYNC_KEY = 'carddavSync'; // likewise

/** The calendar address (`url`), the contacts address (`contactsUrl`), and the credentials both use. A blank username or
 *  password means "use the WebDAV ones" (a CalDAV server is often the same host), which calendar-sync.js applies; what is
 *  stored here is only what was typed. */
export async function getCaldavConfig(kvAdapter) {
  const stored = await getJson(kvAdapter, KEYS.caldav, {});
  return { ...DEFAULT_CALDAV_CONFIG, ...stored };
}

export async function setCaldavConfig(kvAdapter, config) {
  const merged = { ...DEFAULT_CALDAV_CONFIG, ...config, url: String((config && config.url) || '').trim(), contactsUrl: String((config && config.contactsUrl) || '').trim() };
  await setJson(kvAdapter, KEYS.caldav, merged);
  return merged;
}

/** What the calendar mirror last sent, per event: `{ url, resources: { name: { hash, doc } } }`. Not a setting, and
 *  deliberately kept out of settings backups (see exportAllSettings), since it describes one device's last sync. */
export async function getCaldavSyncState(kvAdapter) {
  return getJson(kvAdapter, CALDAV_SYNC_KEY, { url: '', resources: {} });
}

export async function setCaldavSyncState(kvAdapter, state) {
  await setJson(kvAdapter, CALDAV_SYNC_KEY, state);
}

/** The same for the address book: what the contacts mirror last sent, per contact. Kept out of backups for the same reason. */
export async function getCarddavSyncState(kvAdapter) {
  return getJson(kvAdapter, CARDDAV_SYNC_KEY, { url: '', resources: {} });
}

export async function setCarddavSyncState(kvAdapter, state) {
  await setJson(kvAdapter, CARDDAV_SYNC_KEY, state);
}

// ---- agenda notifications (appt) ---------------------------------------------------------------------------------------

/** The agenda-notification settings, kept under their Emacs names (appt-activate, appt-message-warning-time, ...). A device
 *  setting: each device has its own, and a settings backup carries them. */
export async function getApptSettings(kvAdapter) {
  return normalizeApptSettings(await getJson(kvAdapter, KEYS.appt, {}));
}

/** Whether attaching a file also writes an [[attachment:...]] link into the heading's body: 'media' (default), 'always' or
 *  'never'. A per-device setting, carried by a settings backup. */
export async function getAttachLinkMode(kvAdapter) {
  return normalizeAttachLinkMode(await getJson(kvAdapter, KEYS.attachLink, 'media'));
}

export async function setAttachLinkMode(kvAdapter, mode) {
  const normalized = normalizeAttachLinkMode(mode);
  await setJson(kvAdapter, KEYS.attachLink, normalized);
  return normalized;
}

export async function setApptSettings(kvAdapter, settings) {
  const merged = normalizeApptSettings(settings);
  await setJson(kvAdapter, KEYS.appt, merged);
  return merged;
}

// ---- theme -----------------------------------------------------------

export async function getTheme(kvAdapter) {
  return getJson(kvAdapter, KEYS.theme, DEFAULT_THEME);
}

export async function setTheme(kvAdapter, theme) {
  await setJson(kvAdapter, KEYS.theme, theme);
}

/** Custom color overrides for the light/dark themes -- shape is
 *  `{ light: { "--bg": "#ffffff", ... }, dark: { "--fg": "#e8e8e8", ... } }`,
 *  storing only whichever CSS variables have actually been overridden
 *  (most people customizing nothing means this stays `{}` forever, not
 *  a full 11-variable-times-2 record nobody asked for). Applied on top
 *  of whichever theme is actually active -- see applyTheme's own
 *  handling in app.js -- so the built-in defaults are completely
 *  unaffected unless something's actually been customized. */
export async function getCustomThemeColors(kvAdapter) {
  return getJson(kvAdapter, KEYS.customThemeColors, {});
}

export async function setCustomThemeColors(kvAdapter, colors) {
  await setJson(kvAdapter, KEYS.customThemeColors, colors);
}

// ---- font --------------------------------------------------------------

export async function getFontFamily(kvAdapter) {
  return getJson(kvAdapter, KEYS.fontFamily, DEFAULT_FONT_FAMILY);
}

export async function setFontFamily(kvAdapter, fontFamily) {
  await setJson(kvAdapter, KEYS.fontFamily, fontFamily);
}

// ---- menu size ------------------------------------------------------------

/** Regular (default) is the larger, roomier sizing (15px text, a real
 *  44px minimum touch target) every popup menu originally shipped
 *  with; small is the more compact sizing Extras originally used on
 *  its own (14px text, tighter padding, no minimum height) before all
 *  the popup menus were unified onto one shared size. Applies to
 *  every popup menu at once -- File/View/More/Export/the backend
 *  picker, and Extras -- not configurable per-menu, so the whole app
 *  stays visually consistent regardless of which is chosen. */
export async function getMenuSize(kvAdapter) {
  return getJson(kvAdapter, KEYS.menuSize, DEFAULT_MENU_SIZE);
}

export async function setMenuSize(kvAdapter, menuSize) {
  await setJson(kvAdapter, KEYS.menuSize, menuSize);
}

/** Forces a spacing value into the allowed whole-pixel range. Anything that is
 *  not a finite number -- a missing key, a hand-edited or imported bundle
 *  holding text, null -- falls back to the DEFAULT rather than to 0, so a bad
 *  value can never silently pack everything together. */
export function clampSpacing(value, fallback = DEFAULT_PARAGRAPH_SPACING) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SPACING, Math.max(MIN_SPACING, Math.round(value)));
}

/** The vertical space, in px, between paragraphs in the outline: 0 to 32,
 *  default 10. Before this setting every paragraph had a fixed 4px margin,
 *  which collapses between two paragraphs to a 4px gap -- less than a blank
 *  line in the source, so consecutive paragraphs ran together. Headings and
 *  list items are unaffected; they already separate themselves with their own
 *  padding and border. Like font size, there is a second, independent value
 *  (getTablesSpacing) for tables and other secondary blocks. Where a paragraph
 *  meets one of those, CSS margin collapsing gives the larger of the two. */
export async function getParagraphSpacing(kvAdapter) {
  return clampSpacing(await getJson(kvAdapter, KEYS.paragraphSpacing, DEFAULT_PARAGRAPH_SPACING), DEFAULT_PARAGRAPH_SPACING);
}

export async function setParagraphSpacing(kvAdapter, px) {
  await setJson(kvAdapter, KEYS.paragraphSpacing, clampSpacing(px, DEFAULT_PARAGRAPH_SPACING));
}

/** The second spacing value, the counterpart of the tables font size: the
 *  vertical space around tables and the other secondary blocks (source, quote
 *  and other blocks, horizontal rules), 0 to 32, default 10. */
export async function getTablesSpacing(kvAdapter) {
  return clampSpacing(await getJson(kvAdapter, KEYS.tablesSpacing, DEFAULT_TABLES_SPACING), DEFAULT_TABLES_SPACING);
}

/** A saved floating-keyboard position -- `{ left, bottom }` in px (`left` null = its default right-hand
 *  corner) -- or null when the value is missing or malformed, so a bad stored value falls back to the
 *  default spot and never moves the panel somewhere unreachable. The panel's own placement code still
 *  keeps whatever is restored on screen and clear of the mode line, so a position saved on one screen
 *  size is safe on another. */
export function normalizeFloatingKeyboardPos(value) {
  if (!value || typeof value !== 'object') return null;
  const { bottom } = value;
  const left = value.left === undefined ? null : value.left;
  if (typeof bottom !== 'number' || !Number.isFinite(bottom)) return null;
  if (left !== null && (typeof left !== 'number' || !Number.isFinite(left))) return null;
  return { left, bottom };
}

/** Where the person last dragged the floating keyboard, or null for its default spot. */
export async function getFloatingKeyboardPos(kvAdapter) {
  return normalizeFloatingKeyboardPos(await getJson(kvAdapter, KEYS.floatingKeyboardPos, null));
}

export async function setFloatingKeyboardPos(kvAdapter, pos) {
  await setJson(kvAdapter, KEYS.floatingKeyboardPos, normalizeFloatingKeyboardPos(pos));
}

export async function setTablesSpacing(kvAdapter, px) {
  await setJson(kvAdapter, KEYS.tablesSpacing, clampSpacing(px, DEFAULT_TABLES_SPACING));
}

/** Opt-in maximum width for the outline/content column, in ch units
 *  (the width of the "0" character in whatever font/size is currently
 *  active -- so unlike a fixed pixel cap, the same character-count
 *  limit naturally computes to more pixels as font size goes up,
 *  rather than fighting a larger font on a larger screen). null (the
 *  default) means no limit at all -- full width, matching every other
 *  part of the app's own chrome. */
export async function getReadingWidth(kvAdapter) {
  return getJson(kvAdapter, KEYS.readingWidth, DEFAULT_READING_WIDTH);
}

export async function setReadingWidth(kvAdapter, readingWidth) {
  await setJson(kvAdapter, KEYS.readingWidth, readingWidth);
}

/** The Settings/Docs side panel's own user-dragged width on wide
 *  layouts (see #sidePanel's own resize handle) -- persisted so it
 *  survives reload rather than resetting to the default every
 *  session, the same way font size and menu size already do. */
export async function getSidePanelWidth(kvAdapter) {
  return getJson(kvAdapter, KEYS.sidePanelWidth, DEFAULT_SIDE_PANEL_WIDTH);
}

export async function setSidePanelWidth(kvAdapter, sidePanelWidth) {
  await setJson(kvAdapter, KEYS.sidePanelWidth, sidePanelWidth);
}

export async function getFontSize(kvAdapter) {
  return getJson(kvAdapter, KEYS.fontSize, DEFAULT_FONT_SIZE);
}

export async function setFontSize(kvAdapter, fontSize) {
  await setJson(kvAdapter, KEYS.fontSize, fontSize);
}

/** Font size for "other" elements -- currently just tables, which have
 *  their own fixed size rather than inheriting the main body font size
 *  (a table with the same font size as prose text tends to feel
 *  cramped or oversized depending on column count, so it's kept
 *  independently adjustable rather than tied 1:1 to the main size). */
export async function getTablesFontSize(kvAdapter) {
  return getJson(kvAdapter, KEYS.tablesFontSize, DEFAULT_TABLES_FONT_SIZE);
}

export async function setTablesFontSize(kvAdapter, fontSize) {
  await setJson(kvAdapter, KEYS.tablesFontSize, fontSize);
}


/** "Global Variables" -- the app-wide, cross-file counterpart to a
 *  file's own "# Local Variables:" block (see
 *  src/global-variables.js), configured here as one setting per line
 *  in the exact same "name: value" text format. Stored as raw text
 *  (not pre-parsed) since the Settings UI is a plain editable
 *  textarea -- parsing happens on read, the same relationship
 *  Local Variables' own raw file text has to parseLocalVariables. */
const DEFAULT_GLOBAL_VARIABLES = '';

export async function getGlobalVariables(kvAdapter) {
  return getJson(kvAdapter, KEYS.globalVariables, DEFAULT_GLOBAL_VARIABLES);
}

export async function setGlobalVariables(kvAdapter, text) {
  await setJson(kvAdapter, KEYS.globalVariables, text);
}

// ---- extension script ------------------------------------------------------
// Deliberately NOT in KEYS: the script and its approval stay on this device and are never part of an
// export, an import or a sync (a script that arrived with a file would run code nobody approved here).

const EXTENSION_SCRIPT_KEY = 'settings:extension-script';
const EXTENSION_APPROVAL_KEY = 'settings:extension-approved-hash';

export async function getExtensionScript(kvAdapter) {
  return getJson(kvAdapter, EXTENSION_SCRIPT_KEY, '');
}

export async function setExtensionScript(kvAdapter, text) {
  await setJson(kvAdapter, EXTENSION_SCRIPT_KEY, text);
}

/** The hash of the script text the user approved on this device, or ''. */
export async function getExtensionApproval(kvAdapter) {
  return getJson(kvAdapter, EXTENSION_APPROVAL_KEY, '');
}

export async function setExtensionApproval(kvAdapter, hash) {
  await setJson(kvAdapter, EXTENSION_APPROVAL_KEY, hash);
}

// ---- export/import all settings ------------------------------------------

/**
 * Bundles every currently-stored setting into one JSON-serializable
 * object: theme, fonts (including the per-element font sizes), capture
 * templates, GitHub/WebDAV config (including credentials -- this
 * function doesn't redact or omit them; the UI layer is responsible
 * for warning the person before an actual export that the file will
 * contain a plaintext token/password), and the last-active-document
 * pointer. Reuses KEYS directly rather than a second, separately
 * maintained list -- a future setting added to KEYS is automatically
 * included here with no further change needed.
 *
 * A setting that's never been configured (still at its default,
 * nothing ever written) is simply omitted from the bundle rather than
 * included as an explicit default value, so importing this bundle
 * elsewhere only touches settings that were actually customized.
 */
export async function exportAllSettings(kvAdapter) {
  const settings = {};
  for (const name of Object.keys(KEYS)) {
    const value = await getJson(kvAdapter, KEYS[name], undefined);
    if (value !== undefined) settings[name] = value;
  }
  return { format: 'org-pwa-settings', version: 1, exportedAt: new Date().toISOString(), settings };
}

/**
 * Writes every setting present in `bundle.settings` back to the kv
 * store. This is a MERGE onto whatever's already there, not a full
 * replace -- a key the bundle doesn't mention is left completely
 * untouched, so importing an older or partial export can never
 * silently wipe out a setting it simply doesn't know about. A key in
 * the bundle that this version of the app doesn't recognize (e.g. from
 * a newer export, or a hand-edited file) is skipped rather than
 * erroring, the same forward-compatibility reasoning
 * parseLocalVariables itself already applies to unknown keys.
 *
 * Returns the list of setting names actually written, so the caller
 * can report back what was imported.
 */
export async function importAllSettings(kvAdapter, bundle) {
  const settings = (bundle && typeof bundle === 'object' && bundle.settings) || {};
  const imported = [];
  for (const [name, value] of Object.entries(settings)) {
    const key = KEYS[name];
    if (!key) continue;
    await setJson(kvAdapter, key, value);
    imported.push(name);
  }
  return imported;
}

// ---- last active document (session resume) ------------------------------

/** { documentId, storageKind } of the document that was open when the app
 *  was last used, or null if there wasn't one (never opened anything yet,
 *  or explicitly closed). Used to resume a session on next launch, reading
 *  straight from the cache -- not a disk/network re-check, which is a
 *  separate, explicit action (Open) the person can still take any time. */
export async function getLastActiveDocument(kvAdapter) {
  return getJson(kvAdapter, KEYS.lastActiveDocument, null);
}

export async function setLastActiveDocument(kvAdapter, documentId, storageKind) {
  await setJson(kvAdapter, KEYS.lastActiveDocument, documentId ? { documentId, storageKind } : null);
}

/** The full list of tabs open when the app was last used -- an ordered
 *  array of { documentId, storageKind }, plus which index was the
 *  active one, or null if nothing was tracked yet (a brand new
 *  install, or every tab was explicitly closed). Read once at
 *  startup to restore the whole tab set, not just the single most
 *  recent document lastActiveDocument alone tracks. */
export async function getOpenTabs(kvAdapter) {
  return getJson(kvAdapter, KEYS.openTabs, null);
}

export async function setOpenTabs(kvAdapter, tabs, activeIndex) {
  await setJson(kvAdapter, KEYS.openTabs, tabs && tabs.length ? { tabs, activeIndex } : null);
}

// ---- recently opened files ------------------------------------------------

const RECENT_FILES_STORE_LIMIT = 30;

export async function getRecentFiles(kvAdapter) {
  return getJson(kvAdapter, KEYS.recentFiles, []);
}

export async function recordRecentFile(kvAdapter, documentId, storageKind) {
  if (!documentId || !storageKind) return;
  const existing = await getRecentFiles(kvAdapter);
  const deduped = existing.filter((f) => !(f.documentId === documentId && f.storageKind === storageKind));
  deduped.unshift({ documentId, storageKind, openedAt: Date.now() });
  await setJson(kvAdapter, KEYS.recentFiles, deduped.slice(0, RECENT_FILES_STORE_LIMIT));
}

export async function clearRecentFiles(kvAdapter) {
  await setJson(kvAdapter, KEYS.recentFiles, []);
}

// ---- capture templates ----------------------------------------------------

export async function getCaptureTemplates(kvAdapter) {
  return getJson(kvAdapter, KEYS.captureTemplates, DEFAULT_CAPTURE_TEMPLATES);
}

export async function setCaptureTemplates(kvAdapter, templates) {
  await setJson(kvAdapter, KEYS.captureTemplates, templates);
}

export { DEFAULT_CAPTURE_TEMPLATES };

export {
  DEFAULT_GITHUB_CONFIG,
  DEFAULT_WEBDAV_CONFIG,
  DEFAULT_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_MENU_SIZE,
  DEFAULT_PARAGRAPH_SPACING,
  DEFAULT_TABLES_SPACING,
  MIN_SPACING,
  MAX_SPACING,
  DEFAULT_FONT_SIZE,
  DEFAULT_TABLES_FONT_SIZE,
  DEFAULT_READING_WIDTH,
  DEFAULT_SIDE_PANEL_WIDTH,
  DEFAULT_GLOBAL_VARIABLES,
};
