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

// ---- the shortcut's icon ----------------------------------------------------------------------

import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readFile = (src) => fs.readFileSync(path.join(ROOT, src)); // manifest icon paths are relative to the manifest, which sits in the root

/** A small PNG decoder (8-bit RGB or RGBA, not interlaced), enough to look at real pixels. */
function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG signature');
  let pos = 8, width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  assert.ok(bitDepth === 8 && interlace === 0 && (colorType === 2 || colorType === 6), `unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, rgb: (x, y) => [px[y * stride + x * bpp], px[y * stride + x * bpp + 1], px[y * stride + x * bpp + 2]] };
}
const captureShortcut = () => manifest.shortcuts.find((s) => s.name === 'Capture');
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

test('the Capture shortcut has icons: PNG files that exist, whose declared size is their real size, with at least a 96 and a 192', () => {
  const icons = captureShortcut().icons;
  assert.ok(Array.isArray(icons) && icons.length >= 2);
  for (const icon of icons) {
    assert.equal(icon.type, 'image/png');
    const png = decodePng(readFile(icon.src));
    assert.equal(`${png.width}x${png.height}`, icon.sizes, `${icon.src} is really ${png.width}x${png.height}`);
    assert.ok(resolve(icon.src).href.startsWith(SCOPE), `${icon.src} is within the scope`);
  }
  const sizes = icons.map((i) => Number(i.sizes.split('x')[0]));
  assert.ok(sizes.some((s) => s === 96) && sizes.some((s) => s === 192), 'Chrome\u2019s guidance: 192, with 96 as the minimum Android tooling accepts');
});

test('the shortcut\u2019s icon is its own picture, not the app icon: different files and a visibly different background', () => {
  const appIconSrcs = new Set(manifest.icons.map((i) => i.src));
  const app = decodePng(readFile(manifest.icons.find((i) => i.sizes === '192x192').src));
  for (const icon of captureShortcut().icons) {
    assert.ok(!appIconSrcs.has(icon.src), `${icon.src} is not one of the app icons`);
    const png = decodePng(readFile(icon.src));
    assert.ok(distance(png.rgb(2, 2), app.rgb(2, 2)) > 120, `${icon.src}\u2019s background differs clearly from the app icon\u2019s`);
  }
});

test('a maskable shortcut icon keeps its picture inside the safe zone (a circle of 40% of the width) on a full-bleed background', () => {
  for (const icon of captureShortcut().icons.filter((i) => /maskable/.test(i.purpose || ''))) {
    const png = decodePng(readFile(icon.src));
    const background = png.rgb(1, 1);
    const corners = [png.rgb(png.width - 2, 1), png.rgb(1, png.height - 2), png.rgb(png.width - 2, png.height - 2)];
    assert.ok(corners.every((c) => distance(c, background) < 6), `${icon.src}: the background fills every corner (full bleed)`);
    let farthest = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (distance(png.rgb(x, y), background) > 20) farthest = Math.max(farthest, Math.hypot(x - png.width / 2, y - png.height / 2));
      }
    }
    assert.ok(farthest <= 0.4 * png.width, `${icon.src}: the picture reaches ${farthest.toFixed(1)}px from the centre, the safe zone is ${(0.4 * png.width).toFixed(1)}px`);
  }
});
