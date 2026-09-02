import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import {
  getGithubConfig,
  setGithubConfig,
  getWebdavConfig,
  setWebdavConfig,
  getTheme,
  setTheme,
  getCustomThemeColors,
  setCustomThemeColors,
  getDocsViewState,
  setDocsViewState,
  getFontFamily,
  setFontFamily,
  getFontSize,
  setFontSize,
  getTablesFontSize,
  setTablesFontSize,
  exportAllSettings,
  importAllSettings,
  getRecentFiles,
  recordRecentFile,
  clearRecentFiles,
  DEFAULT_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_TABLES_FONT_SIZE,
} from '../src-browser/settings.js';

// ---- GitHub config --------------------------------------------------------

test('getGithubConfig returns all-blank defaults when nothing is stored', async () => {
  const kv = createInMemoryAdapter();
  const config = await getGithubConfig(kv);
  assert.deepEqual(config, { token: '', owner: '', repo: '', branch: 'main' });
});

test('setGithubConfig then getGithubConfig round-trips', async () => {
  const kv = createInMemoryAdapter();
  await setGithubConfig(kv, { token: 'tok', owner: 'me', repo: 'notes', branch: 'dev' });
  const config = await getGithubConfig(kv);
  assert.deepEqual(config, { token: 'tok', owner: 'me', repo: 'notes', branch: 'dev' });
});

test('setGithubConfig with a partial object merges over defaults rather than replacing wholesale', async () => {
  const kv = createInMemoryAdapter();
  await setGithubConfig(kv, { token: 'tok', owner: 'me', repo: 'notes' });
  const config = await getGithubConfig(kv);
  assert.equal(config.branch, 'main'); // default, since not provided
});

test('getGithubConfig fails open to defaults on corrupt stored data', async () => {
  const badKv = { get: async () => ({ key: 'x', value: '{not valid json' }) };
  const config = await getGithubConfig(badKv);
  assert.deepEqual(config, { token: '', owner: '', repo: '', branch: 'main' });
});

// ---- WebDAV config --------------------------------------------------------

test('getWebdavConfig returns all-blank defaults when nothing is stored', async () => {
  const kv = createInMemoryAdapter();
  const config = await getWebdavConfig(kv);
  assert.deepEqual(config, { baseUrl: '', username: '', password: '' });
});

test('setWebdavConfig then getWebdavConfig round-trips', async () => {
  const kv = createInMemoryAdapter();
  await setWebdavConfig(kv, { baseUrl: 'https://cloud.example.com/dav', username: 'me', password: 'pw' });
  const config = await getWebdavConfig(kv);
  assert.deepEqual(config, { baseUrl: 'https://cloud.example.com/dav', username: 'me', password: 'pw' });
});

test('GitHub and WebDAV settings do not clobber each other', async () => {
  const kv = createInMemoryAdapter();
  await setGithubConfig(kv, { token: 't', owner: 'o', repo: 'r' });
  await setWebdavConfig(kv, { baseUrl: 'https://x.com', username: 'u', password: 'p' });
  assert.equal((await getGithubConfig(kv)).owner, 'o');
  assert.equal((await getWebdavConfig(kv)).username, 'u');
});

// ---- theme -----------------------------------------------------------

test('getTheme defaults to "system"', async () => {
  const kv = createInMemoryAdapter();
  assert.equal(await getTheme(kv), DEFAULT_THEME);
});

test('setTheme then getTheme round-trips', async () => {
  const kv = createInMemoryAdapter();
  await setTheme(kv, 'dark');
  assert.equal(await getTheme(kv), 'dark');
});

// ---- custom theme colors ------------------------------------------------

test('getCustomThemeColors defaults to an empty object -- no customizations, unless something has actually been set', async () => {
  const kv = createInMemoryAdapter();
  assert.deepEqual(await getCustomThemeColors(kv), {});
});

test('setCustomThemeColors then getCustomThemeColors round-trips', async () => {
  const kv = createInMemoryAdapter();
  await setCustomThemeColors(kv, { light: { '--bg': '#f0f0f0' }, dark: { '--fg': '#ffffff' } });
  assert.deepEqual(await getCustomThemeColors(kv), { light: { '--bg': '#f0f0f0' }, dark: { '--fg': '#ffffff' } });
});

test('setCustomThemeColors only stores whichever variables were actually overridden, not a full record of all 11 for both themes', async () => {
  const kv = createInMemoryAdapter();
  await setCustomThemeColors(kv, { light: { '--accent': '#ff0000' } });
  const stored = await getCustomThemeColors(kv);
  assert.deepEqual(Object.keys(stored), ['light']);
  assert.deepEqual(Object.keys(stored.light), ['--accent']);
});

// ---- font --------------------------------------------------------------

test('getFontFamily and getFontSize default sensibly', async () => {
  const kv = createInMemoryAdapter();
  assert.equal(await getFontFamily(kv), DEFAULT_FONT_FAMILY);
  assert.equal(await getFontSize(kv), DEFAULT_FONT_SIZE);
});

test('setFontFamily / setFontSize round-trip independently', async () => {
  const kv = createInMemoryAdapter();
  await setFontFamily(kv, 'serif');
  await setFontSize(kv, 20);
  assert.equal(await getFontFamily(kv), 'serif');
  assert.equal(await getFontSize(kv), 20);
});

test('getTablesFontSize defaults sensibly and is independent of the main font size', async () => {
  const kv = createInMemoryAdapter();
  assert.equal(await getTablesFontSize(kv), DEFAULT_TABLES_FONT_SIZE);
  await setFontSize(kv, 24);
  assert.equal(await getTablesFontSize(kv), DEFAULT_TABLES_FONT_SIZE, 'changing the main font size must not affect the tables size');
});

test('setTablesFontSize round-trips and does not affect the main font size', async () => {
  const kv = createInMemoryAdapter();
  await setTablesFontSize(kv, 18);
  assert.equal(await getTablesFontSize(kv), 18);
  assert.equal(await getFontSize(kv), DEFAULT_FONT_SIZE);
});

test('settings for different categories do not clobber each other', async () => {
  const kv = createInMemoryAdapter();
  await setTheme(kv, 'dark');
  await setFontFamily(kv, 'monospace');
  await setGithubConfig(kv, { token: 't', owner: 'o', repo: 'r' });
  assert.equal(await getTheme(kv), 'dark');
  assert.equal(await getFontFamily(kv), 'monospace');
  assert.equal((await getGithubConfig(kv)).owner, 'o');
});

// ---- exportAllSettings / importAllSettings --------------------------------

test('exportAllSettings omits keys that were never configured', async () => {
  const kv = createInMemoryAdapter();
  const bundle = await exportAllSettings(kv);
  assert.equal(bundle.format, 'org-pwa-settings');
  assert.equal(bundle.version, 1);
  assert.ok(bundle.exportedAt);
  assert.deepEqual(bundle.settings, {});
});

test('exportAllSettings includes every configured setting, across categories', async () => {
  const kv = createInMemoryAdapter();
  await setTheme(kv, 'dark');
  await setFontFamily(kv, 'monospace');
  await setFontSize(kv, 20);
  await setTablesFontSize(kv, 15);
  await setGithubConfig(kv, { token: 'secret-token', owner: 'me', repo: 'notes', branch: 'main' });
  await setWebdavConfig(kv, { baseUrl: 'https://example.com', username: 'me', password: 'secret-pw' });

  const bundle = await exportAllSettings(kv);
  assert.equal(bundle.settings.theme, 'dark');
  assert.equal(bundle.settings.fontFamily, 'monospace');
  assert.equal(bundle.settings.fontSize, 20);
  assert.equal(bundle.settings.tablesFontSize, 15);
  assert.equal(bundle.settings.github.token, 'secret-token');
  assert.equal(bundle.settings.webdav.password, 'secret-pw');
});

test('importAllSettings writes every setting present in the bundle', async () => {
  const kv = createInMemoryAdapter();
  const bundle = {
    format: 'org-pwa-settings',
    version: 1,
    settings: { theme: 'dark', fontSize: 22, github: { token: 't2', owner: 'o2', repo: 'r2', branch: 'main' } },
  };
  const imported = await importAllSettings(kv, bundle);
  assert.deepEqual(imported.sort(), ['fontSize', 'github', 'theme'].sort());
  assert.equal(await getTheme(kv), 'dark');
  assert.equal(await getFontSize(kv), 22);
  assert.equal((await getGithubConfig(kv)).token, 't2');
});

test('importAllSettings is a merge, not a full replace -- a key absent from the bundle is left untouched', async () => {
  const kv = createInMemoryAdapter();
  await setTheme(kv, 'light');
  await setFontFamily(kv, 'serif');
  await importAllSettings(kv, { settings: { theme: 'dark' } }); // fontFamily not mentioned
  assert.equal(await getTheme(kv), 'dark');
  assert.equal(await getFontFamily(kv), 'serif', 'a setting not present in the imported bundle must be left exactly as it was');
});

test('importAllSettings skips an unrecognized key rather than throwing', async () => {
  const kv = createInMemoryAdapter();
  const imported = await importAllSettings(kv, { settings: { theme: 'dark', 'some-future-setting': 'x' } });
  assert.deepEqual(imported, ['theme']);
  assert.equal(await getTheme(kv), 'dark');
});

test('importAllSettings tolerates a missing or malformed settings field without throwing', async () => {
  const kv = createInMemoryAdapter();
  assert.deepEqual(await importAllSettings(kv, {}), []);
  assert.deepEqual(await importAllSettings(kv, null), []);
  assert.deepEqual(await importAllSettings(kv, { settings: null }), []);
});

test('a full export/import round trip preserves every setting exactly', async () => {
  const kv1 = createInMemoryAdapter();
  await setTheme(kv1, 'dark');
  await setFontFamily(kv1, 'monospace');
  await setFontSize(kv1, 19);
  await setTablesFontSize(kv1, 12);
  await setGithubConfig(kv1, { token: 'tok', owner: 'me', repo: 'notes', branch: 'main' });
  await setWebdavConfig(kv1, { baseUrl: 'https://cloud.example.com', username: 'me', password: 'pw' });

  const bundle = await exportAllSettings(kv1);

  const kv2 = createInMemoryAdapter();
  await importAllSettings(kv2, bundle);

  assert.equal(await getTheme(kv2), 'dark');
  assert.equal(await getFontFamily(kv2), 'monospace');
  assert.equal(await getFontSize(kv2), 19);
  assert.equal(await getTablesFontSize(kv2), 12);
  assert.deepEqual(await getGithubConfig(kv2), await getGithubConfig(kv1));
  assert.deepEqual(await getWebdavConfig(kv2), await getWebdavConfig(kv1));
});

// ---- docs view state ------------------------------------------------------

test('getDocsViewState defaults to null -- nothing recorded yet', async () => {
  const kv = createInMemoryAdapter();
  assert.equal(await getDocsViewState(kv), null);
});

test('setDocsViewState then getDocsViewState round-trips', async () => {
  const kv = createInMemoryAdapter();
  await setDocsViewState(kv, { scrollTop: 400, collapsedPaths: ['Export', 'Export/ODT'] });
  assert.deepEqual(await getDocsViewState(kv), { scrollTop: 400, collapsedPaths: ['Export', 'Export/ODT'] });
});

// ---- recently opened files -------------------------------------------------

test('getRecentFiles defaults to an empty array -- nothing opened yet', async () => {
  const kv = createInMemoryAdapter();
  assert.deepEqual(await getRecentFiles(kv), []);
});

test('recordRecentFile then getRecentFiles round-trips, most recent first', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, 'notes.org', 'github');
  await recordRecentFile(kv, 'journal.org', 'webdav');
  const recent = await getRecentFiles(kv);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].documentId, 'journal.org');
  assert.equal(recent[0].storageKind, 'webdav');
  assert.equal(recent[1].documentId, 'notes.org');
  assert.ok(typeof recent[0].openedAt === 'number');
});

test('THE FEATURE: re-opening the same file moves it to the front rather than duplicating it', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, 'a.org', 'github');
  await recordRecentFile(kv, 'b.org', 'github');
  await recordRecentFile(kv, 'a.org', 'github');
  const recent = await getRecentFiles(kv);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].documentId, 'a.org');
  assert.equal(recent[1].documentId, 'b.org');
});

test('THE FEATURE: the same documentId on a different backend is tracked as a distinct entry', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, 'notes.org', 'github');
  await recordRecentFile(kv, 'notes.org', 'webdav');
  const recent = await getRecentFiles(kv);
  assert.equal(recent.length, 2);
});

test('THE FEATURE: an unsaved document (no storageKind) is never recorded', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, '\u0000unsaved-new-document', null);
  assert.deepEqual(await getRecentFiles(kv), []);
});

test('THE FEATURE: a blank documentId is never recorded', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, null, 'github');
  await recordRecentFile(kv, '', 'github');
  assert.deepEqual(await getRecentFiles(kv), []);
});

test('THE FEATURE: the stored list is capped, oldest entries dropped first', async () => {
  const kv = createInMemoryAdapter();
  for (let i = 0; i < 35; i++) {
    await recordRecentFile(kv, `file${i}.org`, 'github');
  }
  const recent = await getRecentFiles(kv);
  assert.ok(recent.length <= 30, `expected the stored list capped at 30, got ${recent.length}`);
  assert.equal(recent[0].documentId, 'file34.org'); // most recent survives
  assert.ok(!recent.some((f) => f.documentId === 'file0.org')); // oldest was evicted
});

test('clearRecentFiles empties the list', async () => {
  const kv = createInMemoryAdapter();
  await recordRecentFile(kv, 'notes.org', 'github');
  await clearRecentFiles(kv);
  assert.deepEqual(await getRecentFiles(kv), []);
});
