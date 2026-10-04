// Dev check, not part of the build: bundles the PWA, serves ./www, and loads it in a real browser together with Capacitor's
// REAL native-bridge.js (the script Android injects into the page), with only the native plugins beneath it faked, to check
// that native-platform.js and the app work together the way the shell relies on:
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

// What Android puts in the page before any of the app's own scripts, as faithfully as a browser allows: the shell's JavaScript
// interface (window.androidBridge), Capacitor's REAL bridge script (native-bridge.js, read from node_modules), and the plugin
// objects the native side generates for each plugin it registered (Capacitor.Plugins.<Name>, built as JSExport.java builds
// them: an addListener, and one nativePromise call per @PluginMethod). Only what is beneath androidBridge is faked: the
// native plugins, as plain functions that record what they are asked. A page that assumes more than the real bridge offers
// (the standalone @capacitor/core runtime has registerPlugin; this bridge does not) fails here, as it would on the phone.
const BRIDGE_JS = fs.readFileSync(path.join(nativeDir, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js'), 'utf8');

function nativeSide() {
  window.__calls = [];
  window.__unhandled = [];
  window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
  const files = new Map([['phone.org', '* From the phone\nbody text\n']]);
  const tree = { name: null, files: new Map() }; // the attachments folder
  const impls = {
    ShareTarget: {},
    CaptureShortcuts: {
      setShortcuts: async (a) => { if (window.__failShortcuts) throw new Error('boom'); window.__calls.push(['setShortcuts', a]); return { sent: a.shortcuts.length, max: 4, published: a.shortcuts.length }; },
      info: async () => ({ max: 4, dynamic: ['capture:b'], canPin: true }),
      canPin: async () => ({ value: true }),
      pin: async (a) => { window.__calls.push(['pin', a]); return { requested: true }; },
    },
    Attachments: {
      pickFolder: async () => { if (window.__cancelFolder) { window.__cancelFolder = false; throw new Error('cancelled'); } tree.name = 'org-pwa'; return { name: 'org-pwa' }; },
      folder: async () => (tree.name ? { name: tree.name } : {}),
      read: async ({ path }) => (tree.files.has(path) ? { found: true, base64: tree.files.get(path) } : { found: false }),
      write: async ({ path, base64 }) => { tree.files.set(path, base64); window.__calls.push(['attachWrite', path, base64]); },
      remove: async ({ path }) => ({ deleted: tree.files.delete(path) }),
      exists: async ({ path }) => ({ value: tree.files.has(path) }),
    },
    LocalFiles: {
      pickOpen: async () => { if (window.__cancelNext) { window.__cancelNext = false; throw new Error('cancelled'); } return { name: 'phone.org' }; },
      pickNew: async ({ name }) => { files.set(name, ''); return { name }; },
      read: async ({ name }) => (files.has(name) ? { found: true, content: files.get(name) } : { found: false }),
      write: async ({ name, content }) => { files.set(name, content); window.__calls.push(['write', name, content]); },
      exists: async ({ name }) => ({ value: files.has(name) }),
      access: async ({ name }) => ({ value: files.has(name) ? 'granted' : 'none' }),
      saveFile: async (a) => { if (window.__saveFails) throw new Error('disk full'); if (window.__saveBackedOut) return { saved: false }; window.__calls.push(['saveFile', a]); return { saved: true, where: 'Downloads' }; },
      viewFile: async (a) => { if (window.__noViewer) throw new Error('No app on this phone can open ' + a.name); window.__calls.push(['viewFile', a]); return { opened: true }; },
    },
  };
  const listeners = [];
  let retained = [];
  const reply = (callbackId, pluginId, methodName, success, data, error) => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success, data, error, save: false });
  window.__native = {
    impls,
    listenerKeys: () => listeners.map((l) => `${l.pluginId}:${l.eventName}`).sort(),
    // Plugin.notifyListeners(name, data, retainUntilConsumed=true): held until a listener exists, then delivered
    emit(pluginId, eventName, data) {
      const targets = listeners.filter((l) => l.pluginId === pluginId && l.eventName === eventName);
      if (targets.length === 0) { retained.push({ pluginId, eventName, data }); return; }
      for (const l of targets) window.Capacitor.fromNative({ callbackId: l.callbackId, pluginId, methodName: 'addListener', save: true, success: true, data });
    },
  };
  window.androidBridge = {
    postMessage(json) {
      const message = JSON.parse(json);
      if (message.methodName === 'addListener') {
        if (window.__refuseListeners) return reply(message.callbackId, message.pluginId, 'addListener', false, undefined, { message: 'listener refused' });
        listeners.push({ callbackId: message.callbackId, pluginId: message.pluginId, eventName: message.options.eventName });
        const waiting = retained;
        retained = [];
        for (const r of waiting) window.__native.emit(r.pluginId, r.eventName, r.data);
        return;
      }
      const impl = (impls[message.pluginId] || {})[message.methodName];
      if (!impl) return reply(message.callbackId, message.pluginId, message.methodName, false, undefined, { message: `"${message.pluginId}.${message.methodName}()" is not implemented on android` });
      Promise.resolve()
        .then(() => impl(message.options))
        .then((data) => reply(message.callbackId, message.pluginId, message.methodName, true, data), (e) => reply(message.callbackId, message.pluginId, message.methodName, false, undefined, { message: e.message }));
    },
  };
  if (window.__earlyShare) window.__native.emit('ShareTarget', 'shareReceived', window.__earlyShare);
  if (window.__earlyCapture) window.__native.emit('CaptureShortcuts', 'captureRequested', window.__earlyCapture);
}

// The plugin objects, generated as JSExport.getPluginJS does, for the plugins the native side registered.
function definePlugins() {
  const missing = window.__missing || [];
  for (const id of Object.keys(window.__native.impls)) {
    if (missing.includes(id)) continue;
    const plugins = (window.Capacitor.Plugins = window.Capacitor.Plugins || {});
    const t = (plugins[id] = {});
    t.addListener = function (eventName, callback) { return window.Capacitor.addListener(id, eventName, callback); };
    for (const method of Object.keys(window.__native.impls[id])) t[method] = function (_options) { return window.Capacitor.nativePromise(id, method, _options); };
  }
}

// `flags` are set on window before anything runs; `capacitor: false` means no Capacitor at all (a plain browser).
async function open(flags = {}, { capacitor = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'allow' });
  const shell = `(${nativeSide.toString()})(); ${BRIDGE_JS}\n;(${definePlugins.toString()})();`;
  await context.addInitScript({ content: `Object.assign(window, ${JSON.stringify(flags)}); ${capacitor ? shell : ''}` });
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
    return { name: platform.name, sw: platform.usesServiceWorker, registrations: (await navigator.serviceWorker.getRegistrations()).length, listeners: window.__native.listenerKeys(), unhandled: window.__unhandled };
  });
  check(info.name === 'capacitor-android' && info.sw === false && info.registrations === 0, 'the platform is named, and no service worker is registered', JSON.stringify({ name: info.name, registrations: info.registrations }));
  check(JSON.stringify(info.listeners) === JSON.stringify(['CaptureShortcuts:captureRequested', 'ShareTarget:shareReceived']), 'both native events are listened for', JSON.stringify(info.listeners));
  const early = await sharedNow(page);
  check((await captureShown(page)) && early && early.text === 'shared before the app was ready', 'a share that arrived before the app started opens Capture with it', JSON.stringify(early));
  await closeCapture(page);
  await page.evaluate(() => window.__native.emit('ShareTarget', 'shareReceived', { title: 'Later', text: 'shared while the app was open' }));
  await page.waitForTimeout(600);
  const later = await sharedNow(page);
  check((await captureShown(page)) && later && later.text === 'shared while the app was open', 'a share that arrives while the app is open is handled at once', JSON.stringify(later));
  await closeCapture(page);

  // capture shortcuts: published at startup, tapped, and pinned
  const published = await calls(page, 'setShortcuts');
  const list = published.length ? published[published.length - 1][1].shortcuts : [];
  check(list.length > 0 && list.every((x) => x.key && x.label), 'the capture templates were published to the launcher at startup', JSON.stringify(list).slice(0, 140));
  await page.evaluate(() => window.__native.emit('CaptureShortcuts', 'captureRequested', { key: '' }));
  await page.waitForTimeout(600);
  check(await captureShown(page), 'tapping the Capture shortcut opens the template list');
  await closeCapture(page);
  await page.evaluate((key) => window.__native.emit('CaptureShortcuts', 'captureRequested', { key }), list[0].key);
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
  // Settings > Updates names the real versions, read from the files the shell is built from
  const web = /CACHE_NAME\s*=\s*'org-pwa-shell-(v\d+)'/.exec(fs.readFileSync(path.join(nativeDir, '..', 'sw.js'), 'utf8'))[1];
  const shell = JSON.parse(fs.readFileSync(path.join(nativeDir, 'package.json'), 'utf8')).version;
  await page.locator('textarea').last().locator("xpath=ancestor::div[@class='panel'][1]").getByRole('button', { name: 'Cancel' }).click(); // the measurements popup is still open
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.waitForTimeout(1200);
  const updates = await page.evaluate(() => [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Updates').innerText.replace(/\n+/g, ' | '));
  check(updates.includes(`Version: ${web} (app ${shell})`) && updates.includes('updated by installing a newer version'), 'Settings > Updates shows the web and app versions, and how the app is updated', updates);
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
  const said = await page.locator('#status').innerText();
  check(said.includes('Saved \u201corg-pwa-settings.json\u201d to Downloads.'), 'and the app says where it went', said);
  await page.evaluate(() => { window.__saveFails = true; });
  await page.getByRole('button', { name: 'Export Settings' }).click();
  await page.waitForTimeout(700);
  const failed = await page.locator('#status').innerText();
  check(failed.includes('Couldn\u2019t save') || failed.includes("Couldn't save"), 'a failure of the phone to save it is reported', failed);
  await page.evaluate(() => { window.__saveFails = false; });
  await page.evaluate(async () => { const { setStatus } = await import('/src-browser/editing.js'); setStatus('untouched'); window.__saveBackedOut = true; });
  await page.getByRole('button', { name: 'Export Settings' }).click();
  await page.waitForTimeout(700);
  const quiet = await page.locator('#status').innerText();
  check(!quiet.includes('Saved \u201c') && !quiet.includes('Couldn'), 'a save the person backed out of is not reported as one', quiet);
  await page.evaluate(() => { window.__saveBackedOut = false; });
  // an attachment opened in another app: the bytes go across as base64 with their type, and a refusal reaches the caller
  const viewResult = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    await platform.viewFile(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'doc.pdf');
    window.__noViewer = true;
    try {
      await platform.viewFile(new Blob(['x'], { type: 'application/pdf' }), 'other.pdf');
      return 'resolved';
    } catch (e) {
      return e.message;
    }
  });
  const viewed = (await calls(page, 'viewFile'))[0];
  check(viewed && viewed[1].name === 'doc.pdf' && viewed[1].mime === 'application/pdf' && Buffer.from(viewed[1].base64, 'base64').toString() === '%PDF-1.4', 'viewFile sends the name, the type and the bytes to the plugin', JSON.stringify(viewed).slice(0, 120));
  check(viewResult === 'No app on this phone can open other.pdf', 'and a refusal from the phone reaches the caller as an error', viewResult);
  check(problems.length === 0, 'no page errors', JSON.stringify(problems));
  await context.close();
}

// 3b. Attachments for a local document, kept in a folder the person chooses once
{
  const { context, page, problems } = await open();
  const first = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    return { supported: platform.attachments.supported(), folderBefore: await platform.attachments.folder() };
  });
  check(first.supported === true && first.folderBefore === null, 'before a choice there is a platform folder service but no folder', JSON.stringify(first));
  await page.evaluate(() => { window.__cancelFolder = true; });
  const cancelled = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    try { await platform.attachments.pickFolder(); return 'resolved'; } catch (e) { return e.name; }
  });
  check(cancelled === 'AbortError', 'backing out of the folder picker is an AbortError, which the app ignores', cancelled);

  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  const outcome = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { ensureAttachmentsStorage } = await import('/src-browser/attachments-store.js');
    const { uploadAttachmentToHeading, openAttachmentLink, deleteAttachment } = await import('/src-browser/attachments-flow.js');
    const { platform } = await import('/src-browser/platform.js');
    const storage = await ensureAttachmentsStorage();
    const heading = S.state.doc.children[0];
    await uploadAttachmentToHeading(heading, { name: 'doc.pdf', type: 'application/pdf', base64: 'JVBERi0xLjQ=' });
    const link = heading.bodyLines.join('|');
    await openAttachmentLink('attachment:doc.pdf', heading);
    await deleteAttachment(heading, 'doc.pdf');
    return { storage, link, after: heading.bodyLines.join('|'), folder: await platform.attachments.folder() };
  });
  const wrote = (await calls(page, 'attachWrite'))[0];
  const viewedAttachment = (await calls(page, 'viewFile')).pop();
  check(outcome.storage === 'ok' && outcome.folder && outcome.folder.name === 'org-pwa', 'the first attach asks for the folder, which is then remembered', JSON.stringify(outcome.folder));
  check(wrote && /^data\/[^/]{2}\/[^/]+\/doc\.pdf$/.test(wrote[1]) && wrote[2] === 'JVBERi0xLjQ=', 'the attachment is written under data/xx/rest/ with its bytes intact', wrote && wrote[1]);
  check(outcome.link.includes('attachment:doc.pdf'), 'and linked from the heading', outcome.link);
  check(viewedAttachment && viewedAttachment[1].name === 'doc.pdf' && Buffer.from(viewedAttachment[1].base64, 'base64').toString() === '%PDF-1.4', 'opening it reads the same bytes back from the folder and hands them to the viewer');
  check(!outcome.after.includes('attachment:doc.pdf'), 'deleting removes the link', outcome.after);

  // local files by name, found in the same folder: read, written, listed as present or absent, with text that is not ASCII
  // and a file far larger than a function call can take as arguments (the base64 conversion must go in pieces)
  const byName = await page.evaluate(async () => {
    const { filesystemAdapter } = await import('/src-browser/adapters.js');
    const text = '* Caf\u00e9 \u2014 \u2713 \u65e5\u672c\u8a9e\n' + 'x'.repeat(400000) + '\n';
    await filesystemAdapter.write('notes/new.org', text);
    const back = await filesystemAdapter.read('notes/new.org');
    return {
      access: await filesystemAdapter.access('notes/new.org'),
      exists: await filesystemAdapter.exists('notes/new.org'),
      same: !!back && back.content === text,
      length: back ? back.content.length : 0,
      missing: await filesystemAdapter.read('nope.org'),
      missingAccess: await filesystemAdapter.access('nope.org'),
      missingExists: await filesystemAdapter.exists('nope.org'),
    };
  });
  check(byName.access === 'granted' && byName.exists === true && byName.same === true, 'a local file by name is written to the folder and read back exactly, non-ASCII text and 400 KB included', JSON.stringify(byName));
  check(byName.missing === null && byName.missingAccess === 'none' && byName.missingExists === false, 'a name that is in neither place is reported as absent, not as an error', JSON.stringify(byName));
  check(problems.length === 0, 'no page errors', JSON.stringify(problems));
  await context.close();
}

// 4. A build of the shell missing its plugins: the app starts, and offers nothing it cannot do
{
  const { context, page, problems } = await open({ __missing: ['ShareTarget', 'CaptureShortcuts', 'LocalFiles', 'Attachments'] });
  const info = await page.evaluate(async () => {
    const { platform } = await import('/src-browser/platform.js');
    return { ui: !!document.getElementById('moreBtn'), shortcuts: platform.captureShortcuts.supported(), files: platform.localFiles.supported(), folders: platform.attachments.supported(), unhandled: window.__unhandled };
  });
  check(info.ui && !info.shortcuts && !info.folders && info.unhandled.length === 0 && problems.length === 0, 'with the plugins missing the app still starts, and does not claim shortcuts or an attachments folder', JSON.stringify({ ...info, problems }));
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
