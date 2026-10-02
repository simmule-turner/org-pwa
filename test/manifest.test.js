import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLaunchParams } from '../src/capture-shared.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST_URL = 'https://example.test/app/manifest.json';
const SCOPE = new URL('./', MANIFEST_URL).href; // with no "scope" member, the manifest's own directory
const resolve = (u) => new URL(u, MANIFEST_URL);

test('the manifest still has what installability needs', () => {
  assert.ok(manifest.name && manifest.start_url && manifest.display);
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
});

test('share_target has the members the spec requires (action and params), uses GET, and points inside the scope', () => {
  const st = manifest.share_target;
  assert.ok(st, 'a share_target is declared');
  assert.equal(st.method, 'GET');
  assert.ok(resolve(st.action).href.startsWith(SCOPE), 'the action is within the manifest scope');
  assert.ok(st.params && typeof st.params === 'object');
  assert.deepEqual(Object.keys(st.params).sort(), ['text', 'title', 'url'], 'only title, text and url are mapped (no files)');
  assert.ok(Object.values(st.params).every((v) => typeof v === 'string' && v), 'each maps to a non-empty parameter name');
  assert.equal(new Set(Object.values(st.params)).size, 3, 'and the three names are distinct');
});

test('share_target launches the same page as the app, so the service worker\u2019s cached copy serves it', () => {
  assert.equal(resolve(manifest.share_target.action).pathname, resolve(manifest.start_url).pathname);
});

test('what the share sheet sends is exactly what the app reads: the manifest\u2019s parameter names feed parseLaunchParams', () => {
  const p = manifest.share_target.params;
  const query = '?' + new URLSearchParams({ [p.title]: 'A title', [p.text]: 'Some words', [p.url]: 'https://example.com/x' }).toString();
  assert.deepEqual(parseLaunchParams(query), { capture: null, shared: { title: 'A title', text: 'Some words', url: 'https://example.com/x' } });
});

test('every shortcut has the required name and url, and its url is inside the scope', () => {
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0);
  for (const s of manifest.shortcuts) {
    assert.ok(s.name && s.url, JSON.stringify(s));
    assert.ok(resolve(s.url).href.startsWith(SCOPE), `${s.url} is within the scope`);
  }
});

test('the Capture shortcut\u2019s URL is one the app understands: a bare ?capture, which shows the template list', () => {
  const capture = manifest.shortcuts.find((s) => s.name === 'Capture');
  assert.ok(capture);
  assert.deepEqual(parseLaunchParams(resolve(capture.url).search), { capture: '', shared: null });
});
