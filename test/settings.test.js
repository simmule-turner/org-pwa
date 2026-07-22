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
  DEFAULT_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
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

test('settings for different categories do not clobber each other', async () => {
  const kv = createInMemoryAdapter();
  await setTheme(kv, 'dark');
  await setFontFamily(kv, 'monospace');
  await setGithubConfig(kv, { token: 't', owner: 'o', repo: 'r' });
  assert.equal(await getTheme(kv), 'dark');
  assert.equal(await getFontFamily(kv), 'monospace');
  assert.equal((await getGithubConfig(kv)).owner, 'o');
});
