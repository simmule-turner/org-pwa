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
  fontFamily: 'settings:fontFamily',
  fontSize: 'settings:fontSize',
  lastActiveDocument: 'settings:lastActiveDocument',
};

const DEFAULT_GITHUB_CONFIG = { token: '', owner: '', repo: '', branch: 'main' };
const DEFAULT_WEBDAV_CONFIG = { baseUrl: '', username: '', password: '' };
const DEFAULT_THEME = 'system'; // 'system' | 'light' | 'dark'
const DEFAULT_FONT_FAMILY = 'system'; // 'system' | 'serif' | 'monospace'
const DEFAULT_FONT_SIZE = 16; // px

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

export { DEFAULT_GITHUB_CONFIG, DEFAULT_WEBDAV_CONFIG, DEFAULT_THEME, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE };
