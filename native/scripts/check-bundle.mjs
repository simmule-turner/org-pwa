// Dev check, not part of the build: bundles the PWA, serves ./www, and loads it in a real browser against a stand-in for
// Capacitor, to check that native-platform.js does what the shell relies on: names the platform, skips the service worker,
// registers the share listener, and gets a share into Capture whether it arrived before the app started or after.
// Needs Playwright (npm install -g playwright && npx playwright install chromium). Run: node scripts/check-bundle.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, '..');
const www = path.join(nativeDir, 'www');
execSync('node scripts/sync.mjs', { cwd: nativeDir, stdio: 'pipe' });

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.org': 'text/plain' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(www, decodeURIComponent(url.pathname));
  if (file.endsWith('/')) file += 'index.html';
  if (!file.startsWith(www) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

let failures = 0;
const check = (ok, what, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (extra ? '  ' + extra : ''));
  if (!ok) failures++;
};

async function open(init) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'allow' });
  await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  return { context, page, problems };
}

// 1. Capacitor present, ShareTarget registered, and a share that started the app already waiting (a retained event)
{
  const { context, page, problems } = await open(() => {
    window.__registered = [];
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
    window.Capacitor = {
      getPlatform: () => 'android',
      isNativePlatform: () => true,
      registerPlugin: (name) => ({
        addListener: (event, callback) => {
          window.__registered.push(`${name}:${event}`);
          window.__callback = callback;
          callback({ title: 'Early', text: 'shared before the app was ready' }); // retained natively, delivered on registration
          return Promise.resolve({ remove() {} });
        },
      }),
    };
  });
  const info = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    const { S } = await import('/src-browser/app-state.js');
    return { name: platform.name, sw: platform.usesServiceWorker, registrations: (await navigator.serviceWorker.getRegistrations()).length, registered: window.__registered, shared: S.captureShared, panel: getComputedStyle(document.getElementById('capturePanel')).display, unhandled: window.__unhandled };
  });
  check(info.name === 'capacitor-android' && info.sw === false && info.registrations === 0, 'the platform is named, and no service worker is registered', JSON.stringify({ name: info.name, registrations: info.registrations }));
  check(JSON.stringify(info.registered) === JSON.stringify(['ShareTarget:shareReceived']), 'the share listener is registered with the plugin', JSON.stringify(info.registered));
  check(info.shared && info.shared.text === 'shared before the app was ready' && info.panel !== 'none', 'a share that arrived before the app started opens Capture with it', JSON.stringify(info.shared));
  await page.evaluate(() => document.querySelector('#capturePanel button:last-of-type') && null);
  await page.locator('#capturePanel button', { hasText: 'Close' }).first().click();
  await page.evaluate(() => window.__callback({ title: 'Later', text: 'shared while the app was open' }));
  await page.waitForTimeout(800);
  const later = await page.evaluate(async () => (await import('/src-browser/app-state.js')).S.captureShared);
  check(later && later.text === 'shared while the app was open', 'a share that arrives while the app is open is handled at once', JSON.stringify(later));
  check(problems.length === 0 && info.unhandled.length === 0, 'no errors or unhandled rejections', JSON.stringify([...problems, ...info.unhandled]));
  await context.close();
}

// 2. Capacitor present but the plugin missing (a build without it): the app must still start, quietly
{
  const { context, page, problems } = await open(() => {
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
    window.Capacitor = { getPlatform: () => 'android', registerPlugin: () => ({ addListener: () => Promise.reject(new Error('"ShareTarget" plugin is not implemented on android')) }) };
  });
  const ok = await page.evaluate(() => ({ ui: !!document.getElementById('moreBtn'), unhandled: window.__unhandled }));
  check(ok.ui && ok.unhandled.length === 0 && problems.length === 0, 'with the plugin missing the app still starts, with no unhandled rejection', JSON.stringify([...problems, ...ok.unhandled]));
  await context.close();
}

// 3. No Capacitor at all (the bundle opened in a plain browser)
{
  const { context, page, problems } = await open(() => {});
  const info = await page.evaluate(async () => ({ ui: !!document.getElementById('moreBtn'), name: (await import('/src-browser/platform.js')).platform.name }));
  check(info.ui && info.name === 'capacitor' && problems.length === 0, 'without Capacitor it still starts, as plain "capacitor"', JSON.stringify(info));
  await context.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
