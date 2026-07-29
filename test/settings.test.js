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
  getFontFamily,
  setFontFamily,
  getFontSize,
  setFontSize,
  getOtherFontSize,
  setOtherFontSize,
  exportAllSettings,
  importAllSettings,
  DEFAULT_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_OTHER_FONT_SIZE,
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

test('getOtherFontSize defaults sensibly and is independent of the main font size', async () => {
  const kv = createInMemoryAdapter();
  assert.equal(await getOtherFontSize(kv), DEFAULT_OTHER_FONT_SIZE);
  await setFontSize(kv, 24);
  assert.equal(await getOtherFontSize(kv), DEFAULT_OTHER_FONT_SIZE, 'changing the main font size must not affect the other-elements size');
});

test('setOtherFontSize round-trips and does not affect the main font size', async () => {
  const kv = createInMemoryAdapter();
  await setOtherFontSize(kv, 18);
  assert.equal(await getOtherFontSize(kv), 18);
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
  await setOtherFontSize(kv, 15);
  await setGithubConfig(kv, { token: 'secret-token', owner: 'me', repo: 'notes', branch: 'main' });
  await setWebdavConfig(kv, { baseUrl: 'https://example.com', username: 'me', password: 'secret-pw' });

  const bundle = await exportAllSettings(kv);
  assert.equal(bundle.settings.theme, 'dark');
  assert.equal(bundle.settings.fontFamily, 'monospace');
  assert.equal(bundle.settings.fontSize, 20);
  assert.equal(bundle.settings.otherFontSize, 15);
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
  await setOtherFontSize(kv1, 12);
  await setGithubConfig(kv1, { token: 'tok', owner: 'me', repo: 'notes', branch: 'main' });
  await setWebdavConfig(kv1, { baseUrl: 'https://cloud.example.com', username: 'me', password: 'pw' });

  const bundle = await exportAllSettings(kv1);

  const kv2 = createInMemoryAdapter();
  await importAllSettings(kv2, bundle);

  assert.equal(await getTheme(kv2), 'dark');
  assert.equal(await getFontFamily(kv2), 'monospace');
  assert.equal(await getFontSize(kv2), 19);
  assert.equal(await getOtherFontSize(kv2), 12);
  assert.deepEqual(await getGithubConfig(kv2), await getGithubConfig(kv1));
  assert.deepEqual(await getWebdavConfig(kv2), await getWebdavConfig(kv1));
});
