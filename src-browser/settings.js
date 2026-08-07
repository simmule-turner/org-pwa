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

const KEYS = {
  github: 'settings:github',
  webdav: 'settings:webdav',
  theme: 'settings:theme',
  customThemeColors: 'settings:customThemeColors',
  fontFamily: 'settings:fontFamily',
  fontSize: 'settings:fontSize',
  tablesFontSize: 'settings:otherFontSize', // storage key deliberately left as "otherFontSize" -- renaming the key itself would silently reset every existing user's saved table font size back to default
  lastActiveDocument: 'settings:lastActiveDocument',
  captureTemplates: 'settings:captureTemplates',
  agendaFiles: 'settings:agendaFiles',
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

/** Real org's own org-agenda-files idea: additional files the Agenda
 *  and TODO views scan across, beyond whichever file is currently
 *  open. Each entry is a "scheme:path" string (e.g. "github:journal.org"),
 *  split on the first colon only -- scheme restricted to 'github'/'webdav'
 *  since they're the only backends that can read an arbitrary path
 *  directly, without the fresh per-file picker gesture File System Access
 *  (local files, iOS import) requires; see archiveHeadingToLocation/
 *  openFileLink/image loading for the same limitation stated the same way
 *  elsewhere in this app. Empty by default -- the agenda scans only the
 *  currently open file until this is configured, exactly as before this
 *  existed. */
const DEFAULT_AGENDA_FILES = [];

export async function getAgendaFiles(kvAdapter) {
  return getJson(kvAdapter, KEYS.agendaFiles, DEFAULT_AGENDA_FILES);
}

export async function setAgendaFiles(kvAdapter, agendaFiles) {
  await setJson(kvAdapter, KEYS.agendaFiles, agendaFiles);
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
  DEFAULT_FONT_SIZE,
  DEFAULT_TABLES_FONT_SIZE,
  DEFAULT_AGENDA_FILES,
  DEFAULT_GLOBAL_VARIABLES,
};
