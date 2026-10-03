// Dev check, not part of the build: bundles the PWA, serves ./www, and loads it in a real browser against a stand-in for
// Capacitor and its plugins, to check that native-platform.js and the app work together the way the shell relies on:
// the platform is named, the service worker is skipped, shares and launcher shortcuts reach Capture (whether they arrived
// before the app started or after), capture shortcuts are published and can be pinned, files on the device open, save and
// can be cancelled, and a file saved out goes through the plugin. It cannot check the Android side (the Java plugins):
// that is what the CI build and the phone are for.
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

// A stand-in for Capacitor: the plugins the shell has, as plain functions that record what they are asked.
function fakeCapacitor() {
  window.__calls = [];
  window.__listeners = {};
  window.__unhandled = [];
  window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
  const files = new Map([['phone.org', '* From the phone\nbody text\n']]);
  const plugins = {
    ShareTarget: {},
    CaptureShortcuts: {
      setShortcuts: async (a) => { if (window.__failShortcuts) throw new Error('boom'); window.__calls.push(['setShortcuts', a]); return { sent: a.shortcuts.length, max: 4, published: a.shortcuts.length }; },
      info: async () => ({ max: 4, dynamic: ['capture:b'], canPin: true }),
      canPin: async () => ({ value: true }),
      pin: async (a) => { window.__calls.push(['pin', a]); return { requested: true }; },
    },
    LocalFiles: {
      pickOpen: async () => { if (window.__cancelNext) { window.__cancelNext = false; throw new Error('cancelled'); } return { name: 'phone.org' }; },
      pickNew: async ({ name }) => { files.set(name, ''); return { name }; },
      read: async ({ name }) => (files.has(name) ? { found: true, content: files.get(name) } : { found: false }),
      write: async ({ name, content }) => { files.set(name, content); window.__calls.push(['write', name, content]); },
      exists: async ({ name }) => ({ value: files.has(name) }),
      access: async ({ name }) => ({ value: files.has(name) ? 'granted' : 'none' }),
      saveFile: async (a) => { window.__calls.push(['saveFile', a]); return { saved: true }; },
    },
  };
  window.Capacitor = {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
    isPluginAvailable: (name) => name in plugins && !(window.__missing || []).includes(name),
    registerPlugin: (name) => ({
      ...(plugins[name] || {}),
      addListener: (event, callback) => {
        if (window.__refuseListeners) return Promise.reject(new Error('listener refused'));
        window.__listeners[`${name}:${event}`] = callback;
        if (name === 'ShareTarget' && window.__earlyShare) callback(window.__earlyShare); // retained natively, delivered on registration
        if (name === 'CaptureShortcuts' && window.__earlyCapture) callback(window.__earlyCapture);
        return Promise.resolve({ remove() {} });
      },
    }),
  };
}

// `flags` are set on window before anything runs; `capacitor: false` means no Capacitor at all (a plain browser).
async function open(flags = {}, { capacitor = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'allow' });
  await context.addInitScript({ content: `Object.assign(window, ${JSON.stringify(flags)}); ${capacitor ? `(${fakeCapacitor.toString()})();` : ''}` });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { context, page, problems };
}
const pick = (page, panel, label) => page.locator(panel).getByText(label, { exact: true }).first().click();
const fileMenu = async (page, ...labels) => {
  await page.click('#fileMenuBtn');
  for (const label of labels) await pick(page, '#fileMenuPanel', label);
};
const viewMenu = async (page, label) => {
  await page.click('#viewMenuBtn');
  await pick(page, '#viewMenuPanel', label);
  await page.waitForTimeout(250);
};
const captureShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('capturePanel')).display !== 'none');
const closeCapture = async (page) => {
  await page.locator('#capturePanel button', { hasText: /^(Close|Cancel)$/ }).first().click(); // the list says Close, a template's form says Cancel
  await page.waitForTimeout(300);
};
const sharedNow = (page) => page.evaluate(async () => (await import('/src-browser/app-state.js')).S.captureShared);
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);

// 1. The shell with every plugin, and a share that started the app already waiting (a retained native event)
{
  const { context, page, problems } = await open({ __earlyShare: { title: 'Early', text: 'shared before the app was ready' } });
  const info = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    return { name: platform.name, sw: platform.usesServiceWorker, registrations: (await navigator.serviceWorker.getRegistrations()).length, listeners: Object.keys(window.__listeners).sort(), unhandled: window.__unhandled };
  });
  check(info.name === 'capacitor-android' && info.sw === false && info.registrations === 0, 'the platform is named, and no service worker is registered', JSON.stringify({ name: info.name, registrations: info.registrations }));
  check(JSON.stringify(info.listeners) === JSON.stringify(['CaptureShortcuts:captureRequested', 'ShareTarget:shareReceived']), 'both native events are listened for', JSON.stringify(info.listeners));
  const early = await sharedNow(page);
  check((await captureShown(page)) && early && early.text === 'shared before the app was ready', 'a share that arrived before the app started opens Capture with it', JSON.stringify(early));
  await closeCapture(page);
  await page.evaluate(() => window.__listeners['ShareTarget:shareReceived']({ title: 'Later', text: 'shared while the app was open' }));
  await page.waitForTimeout(600);
  const later = await sharedNow(page);
  check((await captureShown(page)) && later && later.text === 'shared while the app was open', 'a share that arrives while the app is open is handled at once', JSON.stringify(later));
  await closeCapture(page);

  // capture shortcuts: published at startup, tapped, and pinned
  const published = await calls(page, 'setShortcuts');
  const list = published.length ? published[published.length - 1][1].shortcuts : [];
  check(list.length > 0 && list.every((x) => x.key && x.label), 'the capture templates were published to the launcher at startup', JSON.stringify(list).slice(0, 140));
  await page.evaluate(() => window.__listeners['CaptureShortcuts:captureRequested']({ key: '' }));
  await page.waitForTimeout(600);
  check(await captureShown(page), 'tapping the Capture shortcut opens the template list');
  await closeCapture(page);
  await page.evaluate((key) => window.__listeners['CaptureShortcuts:captureRequested']({ key }), list[0].key);
  await page.waitForTimeout(800);
  const panelText = await page.locator('#capturePanel').innerText();
  // the list shows every template, so the template's own form is told apart by the OTHER templates being absent
  check((await captureShown(page)) && panelText.includes(list[0].label) && !panelText.includes(list[1].label), `tapping a template shortcut opens that template (${list[0].label}), not the list`);
  await closeCapture(page);
  await page.evaluate(async () => (await import('/src-browser/capture-shortcuts.js')).addCaptureIconToHomeScreen());
  await page.getByRole('button', { name: 'Capture (the template list)', exact: true }).click();
  await page.waitForTimeout(300);
  const pins = await calls(page, 'pin');
  check(pins.length === 1 && pins[0][1].key === '' && pins[0][1].label === 'Capture (the template list)', 'adding a capture icon asks the plugin to pin it', JSON.stringify(pins));
  // the measurements report carries what the launcher says, so a missing long-press list can be diagnosed
  await page.evaluate(async () => (await import('/src-browser/display-info.js')).showDisplayMeasurements());
  const report = await page.locator('textarea').last().inputValue();
  check(report.includes('launcher shortcuts: launcher {"max":4,"dynamic":["capture:b"],"canPin":true}; last publish: ') && report.includes('tab bar: top, height:'), 'the display measurements include the launcher\'s report and the tab bar', JSON.stringify(report.split('\n').filter((l) => /launcher|tab bar/.test(l))));
  check(problems.length === 0 && info.unhandled.length === 0, 'no errors or unhandled rejections', JSON.stringify([...problems, ...info.unhandled]));
  await context.close();
}

// 1b. Publishing the shortcuts fails: it is shown, not hidden
{
  const { context, page, problems } = await open({ __failShortcuts: true });
  const status = await page.locator('#status').innerText();
  check(status.includes('Launcher shortcuts could not be published: boom') && problems.length === 0, 'a failure to publish the shortcuts is shown in the status line', status);
  await context.close();
}

// 2. A launcher shortcut that started the app is waiting too
{
  const { context, page, problems } = await open({ __earlyCapture: { key: '' } });
  check((await captureShown(page)) && problems.length === 0, 'a shortcut tap that started the app opens the template list once the app is ready', JSON.stringify(problems));
  await context.close();
}

// 3. Files on the device, through the real File menu and the real glue
{
  const { context, page, problems } = await open();
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  check((await page.locator('#outline').innerText()).includes('From the phone'), 'Open > Local file reads the file through the plugin');
  await viewMenu(page, 'Text');
  await page.locator('#document-text-edit-input').fill('* From the phone\n* Added here\nbody text\n');
  await viewMenu(page, 'Org');
  await fileMenu(page, 'Save');
  await page.waitForFunction(() => document.getElementById('status').innerText.includes('Saved'), null, { timeout: 8000 });
  const writes = await calls(page, 'write');
  check(writes.length === 1 && writes[0][1] === 'phone.org' && writes[0][2] === '* From the phone\n* Added here\nbody text\n', 'Save writes it back through the plugin', JSON.stringify(writes));

  await page.evaluate(() => { window.__cancelNext = true; });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForTimeout(800);
  const status = await page.locator('#status').innerText();
  check(!status.includes('Could not open file'), 'backing out of the file picker is not reported as an error', status);

  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.getByRole('button', { name: 'Export Settings' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === 'saveFile'), null, { timeout: 5000 });
  const saved = (await calls(page, 'saveFile'))[0][1];
  const decoded = Buffer.from(saved.base64, 'base64').toString('utf8');
  check(saved.name === 'org-pwa-settings.json' && decoded.includes('"format": "org-pwa-settings"'), 'a file saved out goes to the plugin, as UTF-8 bytes', `${saved.name}: ${decoded.slice(0, 50)}`);
  check(problems.length === 0, 'no page errors', JSON.stringify(problems));
  await context.close();
}

// 4. A build of the shell missing its plugins: the app starts, and offers nothing it cannot do
{
  const { context, page, problems } = await open({ __missing: ['ShareTarget', 'CaptureShortcuts', 'LocalFiles'] });
  const info = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    return { ui: !!document.getElementById('moreBtn'), shortcuts: platform.captureShortcuts.supported(), files: platform.localFiles.supported(), unhandled: window.__unhandled };
  });
  check(info.ui && !info.shortcuts && info.unhandled.length === 0 && problems.length === 0, 'with the plugins missing the app still starts, and does not claim shortcuts', JSON.stringify({ ...info, problems }));
  await context.close();
}

// 5. A plugin that exists but refuses to register a listener must not leave an unhandled rejection
{
  const { context, page, problems } = await open({ __refuseListeners: true });
  const bad = await page.evaluate(() => window.__unhandled);
  check(problems.length === 0 && bad.length === 0, 'a refused listener is handled quietly', JSON.stringify([...problems, ...bad]));
  await context.close();
}

// 6. No Capacitor at all (the bundle opened in a plain browser)
{
  const { context, page, problems } = await open({}, { capacitor: false });
  const info = await page.evaluate(async () => ({ ui: !!document.getElementById('moreBtn'), name: (await import('/src-browser/platform.js')).platform.name }));
  check(info.ui && info.name === 'capacitor' && problems.length === 0, 'without Capacitor it still starts, as plain "capacitor"', JSON.stringify(info));
  await context.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
