#!/usr/bin/env node
/**
 * Browser smoke test: drives the real app in a real (headless) Chromium
 * through the flows that have actually broken before -- the ones the unit
 * tests can't see, because app.js is UI wiring, not importable modules.
 *
 *   node tools/smoke.mjs              run everything
 *   node tools/smoke.mjs conflict     only checks whose name contains "conflict"
 *
 * This is a dev-only tool, run by hand; nothing in package.json depends on
 * it (the app itself stays zero-dependency). It needs Playwright and a
 * Chromium build, installed once with:
 *
 *   npm install -g playwright && npx playwright install chromium
 *
 * Set CHROMIUM_PATH to use a specific browser binary instead.
 *
 * Everything else is built in: a static file server for the app (with
 * Cache-Control: no-store, so a stale HTTP cache can never hide a missing
 * file), and a small in-memory WebDAV server standing in for a real one --
 * the app's sync, conflict and persistence features are only reachable
 * through a remote backend. Exits 0 if every check passes, 1 otherwise.
 *
 * The file is deliberately NOT named *-test.mjs: `node --test` discovers
 * files with that suffix and would launch a browser as part of the ordinary
 * unit suite, which must stay dependency-free.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    // an ES module doesn't see globally installed packages; look there explicitly
  }
  try {
    return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch {
    console.error('Playwright not found. Install it once with:\n  npm install -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}

// ---- servers ------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.org': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** A tiny in-memory WebDAV store: GET/HEAD/PUT/PROPFIND on a flat folder,
 *  with a content-derived ETag and If-Match / If-None-Match honoured, the
 *  way a real server behaves. */
function createDav() {
  const files = new Map();
  const etag = (text) => '"' + crypto.createHash('md5').update(text).digest('hex') + '"';
  return {
    files,
    set: (name, text) => files.set(name, text),
    get: (name) => files.get(name),
    reset(initial = {}) {
      files.clear();
      for (const [name, text] of Object.entries(initial)) files.set(name, text);
    },
    handle(req, res, name, body) {
      const has = files.has(name);
      if (req.method === 'PROPFIND') {
        const items = [
          '<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>',
          ...[...files.keys()].map(
            (n) => `<d:response><d:href>/dav/${encodeURIComponent(n)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>`
          ),
        ];
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`);
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!has) {
          res.writeHead(404);
          return res.end();
        }
        const text = files.get(name);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ETag: etag(text) });
        return res.end(req.method === 'GET' ? text : undefined);
      }
      if (req.method === 'PUT') {
        const ifMatch = req.headers['if-match'];
        const ifNoneMatch = req.headers['if-none-match'];
        if ((ifMatch && (!has || ifMatch !== etag(files.get(name)))) || (ifNoneMatch === '*' && has)) {
          res.writeHead(412);
          return res.end();
        }
        files.set(name, body);
        res.writeHead(has ? 204 : 201, { ETag: etag(body) });
        return res.end();
      }
      res.writeHead(405);
      res.end();
    },
  };
}

function startServer(dav) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/dav' || pathname.startsWith('/dav/')) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => dav.handle(req, res, pathname.replace(/^\/dav\/?/, ''), body));
      return;
    }
    const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        base: `http://localhost:${port}`,
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    })
  );
}

// ---- small browser helpers ------------------------------------------------

const dav = createDav();
let browser;
let main;

async function freshPage(server = main, { withDav = false, serviceWorkers = 'block' } = {}) {
  // The service worker is blocked except where it is the thing under test:
  // its activation can reload the page mid-check and make the rest flaky.
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  if (withDav) {
    await page.evaluate(
      (baseUrl) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('org-pwa', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(JSON.stringify({ baseUrl, username: 'u', password: 'p' }), 'settings:webdav');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
      `${server.base}/dav`
    );
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
  }
  return { context, page, errors };
}

const modeline = (page) => page.locator('#modeline').innerText();
async function waitForModeline(page, text, timeout = 8000) {
  await page.waitForFunction((t) => document.getElementById('modeline').innerText.includes(t), text, { timeout });
}
async function openHelp(page) {
  await openPalette(page);
  await page.keyboard.type('help');
  await page.keyboard.press('Enter');
  await waitForModeline(page, 'Help');
}
const status = (page) => page.locator('#status').innerText();

async function pick(page, panel, label) {
  await page.locator(panel).getByText(label, { exact: true }).first().click();
}
async function fileMenu(page, ...labels) {
  await page.click('#fileMenuBtn');
  for (const label of labels) await pick(page, '#fileMenuPanel', label);
}
async function viewMenu(page, label) {
  await page.click('#viewMenuBtn');
  await pick(page, '#viewMenuPanel', label);
  await page.waitForTimeout(250);
}
async function waitForStatus(page, text, timeout = 8000) {
  await page.waitForFunction((t) => document.getElementById('status').innerText.includes(t), text, { timeout });
}

/** File -> New, then type `text` into the Text view and return to Org. */
async function newDocument(page, text) {
  await fileMenu(page, 'New');
  await page.waitForFunction(() => !document.getElementById('viewMenuBtn').disabled, null, { timeout: 8000 });
  await setDocumentText(page, text);
}

async function setDocumentText(page, text) {
  await viewMenu(page, 'Text');
  await page.locator('#document-text-edit-input').fill(text);
  await viewMenu(page, 'Org');
}

async function documentText(page) {
  await viewMenu(page, 'Text');
  const text = await page.locator('#document-text-edit-input').inputValue();
  await viewMenu(page, 'Org');
  return text;
}

async function openDav(page, name) {
  await fileMenu(page, 'Open', 'WebDAV');
  await page.getByText(name, { exact: false }).first().click();
  await page.waitForFunction((n) => document.getElementById('modeline').innerText.includes(n), name, { timeout: 8000 });
  await page.waitForTimeout(300);
}

async function replaceInDocument(page, from, to) {
  const text = await documentText(page);
  if (!text.includes(from)) throw new Error(`document has no "${from}" to replace`);
  await setDocumentText(page, text.replace(from, to));
}

const SAMPLE = ['* One', 'body 1', '* Two', 'body 2', '* Three', 'body 3', '* Four', 'body 4', '* Five', 'body 5', ''].join('\n');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- the checks -------------------------------------------------------------

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('app loads with no JavaScript errors, and Help opens', async () => {
  const { context, page, errors } = await freshPage();
  await openHelp(page);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('read-only toggle: a read-only buffer becomes editable in Text view and stays writable back in Org', async () => {
  const { context, page } = await freshPage();
  await openHelp(page); // the Help buffer is read-only by its own file header
  expect((await modeline(page)).startsWith('%%'), 'Help should start read-only');
  await viewMenu(page, 'Text');
  expect(await page.locator('#document-text-edit-input').evaluate((t) => t.readOnly), 'textarea should start read-only');
  await openPalette(page);
  await page.keyboard.type('toggle read-only');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(!(await page.locator('#document-text-edit-input').evaluate((t) => t.readOnly)), 'textarea stayed read-only after toggling');
  await page.locator('#document-text-edit-input').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('ZZZ');
  expect((await page.locator('#document-text-edit-input').inputValue()).startsWith('ZZZ'), 'typing was not accepted');
  await viewMenu(page, 'Org');
  expect(!(await modeline(page)).startsWith('%%'), `read-only came back after leaving Text view: ${await modeline(page)}`);
  await context.close();
});

check('offline: a cold start with the server gone still loads (every module is precached)', async () => {
  const dead = await startServer(createDav());
  const { context, page } = await freshPage(dead, { serviceWorkers: 'allow' });
  // Wait until the service worker has cached the whole shell list. Its
  // activation may reload the page, so a poll that tolerates that.
  const expected = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/^\s+'\.\/[^']*',?$/gm) || []).length;
  let cached = 0;
  for (let attempt = 0; attempt < 40 && cached < expected; attempt++) {
    try {
      cached = await page.evaluate(async () => {
        const names = await caches.keys();
        return names.length ? (await (await caches.open(names[0])).keys()).length : 0;
      });
    } catch {
      // navigated mid-poll -- try again
    }
    if (cached < expected) await page.waitForTimeout(500);
  }
  expect(cached >= expected, `the service worker cached only ${cached} of ${expected} shell files`);
  await page.reload({ waitUntil: 'load' });
  await dead.stop();
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await openHelp(page).catch(() => {});
  expect((await modeline(page)).includes('Help'), 'the app did not work with the server stopped');
  await context.close();
});

check('effort: any duration form is stored as typed, an invalid one is refused, and the modeline shows it against a running clock', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* Write report\n');
  const setEffort = async (value) => {
    await page.locator('.heading-title').first().click();
    await openPalette(page);
    await page.keyboard.type('set effort estimate');
    await page.keyboard.press('Enter');
    await page.locator('textarea').last().fill(value);
    await page.getByText('OK', { exact: true }).last().click();
    await page.waitForTimeout(400);
  };
  const badge = () => page.locator('.priority-badge').allInnerTexts();
  for (const value of ['1d 3h', '2.35h', '90', '1d3h5min']) {
    await setEffort(value);
    expect((await badge()).join().includes(value), `"${value}" was not stored as typed: ${await badge()}`);
  }
  await setEffort('3 hours');
  expect((await badge()).join().includes('1d3h5min'), 'an invalid value replaced the old one');
  expect((await status(page)).includes('Not a valid duration'), `no refusal message: ${await status(page)}`);
  await setEffort('1.5h');
  await page.locator('.heading-title').first().click();
  await openPalette(page);
  await page.keyboard.type('clock in');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  // the elapsed part ticks, so only the estimate (1.5h -> 1:30) is asserted exactly
  expect(/\[\u23f1 \d+:\d\d \/ 1:30\]/.test(await modeline(page)), `modeline: ${await modeline(page)}`);
  await context.close();
});

check('refile: criteria combine, and entries that cannot be understood are listed, not swallowed', async () => {
  const { context, page } = await freshPage();
  await newDocument(
    page,
    [
      '#+TODO: TODO NEXT | DONE',
      '* Projects :work:',
      '** TODO Alpha :work:',
      '** NEXT Beta',
      '** Gamma',
      '* Home :personal:',
      '** Garden',
      '* Inbox item',
      '',
      '# Local Variables:',
      '# org-refile-targets: current tag=work; current todo=NEXT level=2; current regexp=^\\*+ Gar; current bogus=1; current regexp=\\(',
      '# End:',
      '',
    ].join('\n')
  );
  await page.locator('.heading-title', { hasText: 'Inbox item' }).first().click();
  await page.locator('[aria-label="Archive"]').first().click();
  await page.locator('button', { hasText: 'Refile' }).first().click();
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();
  const panel = body.slice(body.indexOf('Refile "Inbox item"'));
  expect(panel.includes('Skipped target entry "current bogus=1"'), 'unknown criterion was not reported');
  expect(panel.includes('Skipped target entry "current regexp=\\("'), 'bad regexp was not reported');
  const offered = ['Projects', 'Projects / Alpha', 'Projects / Beta', 'Home / Garden'];
  for (const path of offered) expect(panel.includes(path), `missing target: ${path}`);
  expect(!panel.includes('Projects / Gamma'), 'Gamma should not be offered');
  await context.close();
});

function orgToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `<${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${d.toLocaleDateString('en-US', { weekday: 'short' })}>`;
}

check('agenda: rows show their effort, and each day totals what is planned (counting TODOs still without an estimate)', async () => {
  const { context, page, errors } = await freshPage();
  const today = orgToday();
  const task = (title, effort) => `* TODO ${title}\nSCHEDULED: ${today}\n${effort ? `:PROPERTIES:\n:EFFORT: ${effort}\n:END:\n` : ''}`;
  await newDocument(page, ['#+TODO: TODO NEXT | DONE', task('Write report', '1:30'), task('Review', '2h'), task('Inbox zero', null), `* Dentist ${today.replace('>', ' 10:00>')}`, ''].join('\n'));
  await viewMenu(page, 'Agenda');
  await page.waitForSelector('[data-day-effort]');
  const total = await page.locator('[data-day-effort]').first().innerText();
  expect(total.includes('3:30') && total.includes('+1?'), `day total: ${JSON.stringify(total)} (want 3:30 and 1 unestimated; the appointment must not count as a gap)`);
  const badges = (await page.locator('[data-item-effort]').allInnerTexts()).join('|');
  expect(badges.includes('1:30') && badges.includes('2h'), `row badges: ${badges}`);
  expect((await page.locator('[data-item-effort]').count()) === 2, 'only the two estimated tasks should carry a badge');

  await viewMenu(page, 'TODO');
  await page.waitForTimeout(400);
  const todoBadges = (await page.locator('[data-item-effort]').allInnerTexts()).join('|');
  expect(todoBadges.includes('1:30') && todoBadges.includes('2h'), `TODO view badges: ${todoBadges}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('agenda: a day where nothing is estimated shows no effort at all', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, `#+TODO: TODO NEXT | DONE\n* TODO Plain task\nSCHEDULED: ${orgToday()}\n`);
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(600);
  expect((await page.locator('[data-day-effort]').count()) === 0 && (await page.locator('[data-item-effort]').count()) === 0, 'no effort UI should appear');
  await context.close();
});

check('effort: Effort_ALL shows quick-picks (from #+PROPERTY), one tap saves the value, and none appear when it is not defined', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '#+PROPERTY: Effort_ALL 0:15 0:30 1:00 bogus\n* Write report\n');
  await page.locator('.heading-title').first().click();
  await openPalette(page);
  await page.keyboard.type('set effort estimate');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-quick-picks]');
  const picks = await page.locator('[data-quick-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-quick-pick')));
  expect(JSON.stringify(picks) === '["0:15","0:30","1:00"]', `quick-picks: ${JSON.stringify(picks)} (the invalid "bogus" must not be offered)`);
  await page.locator('[data-quick-pick="0:30"]').click();
  await page.waitForTimeout(400);
  expect((await page.locator('.priority-badge').allInnerTexts()).join().includes('0:30'), 'tapping a quick-pick should set the effort');
  expect(!(await page.locator('[data-quick-picks]').count()), 'the prompt should have closed');

  const second = await freshPage();
  await newDocument(second.page, '* No list defined\n');
  await second.page.locator('.heading-title').first().click();
  await openPalette(second.page);
  await second.page.keyboard.type('set effort estimate');
  await second.page.keyboard.press('Enter');
  await second.page.waitForSelector('textarea');
  expect((await second.page.locator('[data-quick-picks]').count()) === 0, 'no Effort_ALL means the prompt stays plain free text');
  await second.context.close();

  // the global setting, here as a file's own Local Variables line
  const third = await freshPage();
  await newDocument(third.page, '* Global list\n\n# Local Variables:\n# org-global-properties: Effort_ALL: 0:15 0:45 3:00\n# End:\n');
  await third.page.locator('.heading-title').first().click();
  await openPalette(third.page);
  await third.page.keyboard.type('set effort estimate');
  await third.page.keyboard.press('Enter');
  await third.page.waitForSelector('[data-quick-picks]');
  const globalPicks = await third.page.locator('[data-quick-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-quick-pick')));
  expect(JSON.stringify(globalPicks) === '["0:15","0:45","3:00"]', `org-global-properties quick-picks: ${JSON.stringify(globalPicks)}`);
  await third.context.close();
  await context.close();
});

check('agenda: sort, per-day limit and filter by effort, on real rows and day totals', async () => {
  const { context, page, errors } = await freshPage();
  const today = orgToday();
  const task = (title, effort) => `* TODO ${title}\nSCHEDULED: ${today}\n${effort ? `:PROPERTIES:\n:EFFORT: ${effort}\n:END:\n` : ''}`;
  // a neutral first heading, because the tab is named after it and would otherwise match the row text
  await newDocument(page, ['#+TODO: TODO NEXT | DONE', '* Plan', task('Two hours', '2h'), task('One hour', '1:00'), task('Half hour', '0:30'), task('Unestimated', null), ''].join('\n'));
  await viewMenu(page, 'Agenda');
  await page.waitForSelector('[data-day-effort]');
  const order = async () => {
    const text = await page.locator('body').innerText();
    return ['Two hours', 'One hour', 'Half hour', 'Unestimated'].filter((t) => text.includes(t)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
  };
  expect((await order()).length === 4, 'all four tasks should show to begin with');

  await page.locator('[aria-label="Sort, filter and limit the agenda by effort"]').click();
  await page.waitForSelector('[data-agenda-effort-panel]');
  await page.selectOption('[data-effort-sort]', 'up');
  await page.waitForTimeout(300);
  expect(JSON.stringify(await order()) === '["Half hour","One hour","Two hours","Unestimated"]', `sorted up: ${JSON.stringify(await order())} (no effort counts as high, so last)`);
  await page.selectOption('[data-effort-sort]', 'down');
  await page.waitForTimeout(300);
  expect(JSON.stringify(await order()) === '["Unestimated","Two hours","One hour","Half hour"]', `sorted down: ${JSON.stringify(await order())}`);

  await page.selectOption('[data-effort-sort]', 'up');
  await page.locator('[data-effort-max]').fill('1:30');
  await page.locator('[data-effort-max]').press('Tab');
  await page.waitForTimeout(300);
  expect(JSON.stringify(await order()) === '["Half hour","One hour"]', `limit 1:30: ${JSON.stringify(await order())}`);
  expect((await page.locator('[data-day-effort]').first().innerText()).includes('1:30'), 'the day total should describe what is shown');

  await page.locator('[data-effort-max]').fill('');
  await page.locator('[data-effort-max]').press('Tab');
  await page.selectOption('[data-effort-filter-op]', '>');
  await page.selectOption('[data-effort-filter-value]', '1:00');
  await page.waitForTimeout(300);
  expect(JSON.stringify(await order()) === '["One hour","Two hours","Unestimated"]', `at least 1:00 (inclusive; no-effort counts as high): ${JSON.stringify(await order())}`);

  await page.getByText('Reset', { exact: true }).click();
  await page.waitForTimeout(300);
  expect((await order()).length === 4, 'Reset should bring everything back');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('tabs: two documents keep their own content, unsaved state and read-only flag when switching', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Alpha heading\nalpha body\n');
  await newDocument(page, '* Beta heading\nbeta body\n');
  // the outline pane only: the tab labels are named after each document's first heading
  const outline = () => page.locator('#outline').innerText();
  expect((await outline()).includes('Beta heading') && !(await outline()).includes('Alpha heading'), 'the second document should be showing');

  // make Beta read-only, then look at Alpha: it must be writable and show its own text
  await openPalette(page);
  await page.keyboard.type('toggle read-only');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await modeline(page)).startsWith('%'), `Beta should now be read-only: ${await modeline(page)}`);

  await page.locator('#tabBar > div', { hasText: 'Alpha heading' }).first().click();
  await page.waitForTimeout(500);
  const alpha = await outline();
  expect(alpha.includes('Alpha heading') && !alpha.includes('Beta heading'), 'switching should show Alpha, not Beta');
  expect(!(await modeline(page)).startsWith('%'), `read-only belongs to Beta only: ${await modeline(page)}`);

  // an edit made in Alpha stays with Alpha
  await replaceInDocument(page, 'alpha body', 'alpha body EDITED');
  expect((await modeline(page)).startsWith('**'), `Alpha should be unsaved: ${await modeline(page)}`);
  await page.locator('#tabBar > div', { hasText: 'Beta heading' }).first().click();
  await page.waitForTimeout(500);
  expect(!(await documentText(page)).includes('EDITED'), 'the edit leaked into Beta');
  expect((await modeline(page)).startsWith('%'), `Beta is still read-only: ${await modeline(page)}`);
  await page.locator('#tabBar > div', { hasText: 'Alpha heading' }).first().click();
  await page.waitForTimeout(500);
  expect((await documentText(page)).includes('alpha body EDITED'), 'Alpha lost its edit when switching away and back');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('tags: the editor suggests tags already used or declared on #+TAGS:, narrows as you type, and one tap adds it', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, ['#+TAGS: errand', '* Alpha :work:home:', ':PROPERTIES:', ':OWNER: me', ':END:', '* Beta :work:', '* Gamma', ''].join('\n'));
  await page.locator('.heading-title', { hasText: 'Gamma' }).first().click();
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Commands');
  await page.waitForSelector('#command-palette');
  await page.keyboard.type('edit details');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-tag-suggestions]', { state: 'attached' });
  const offered = () => page.locator('[data-tag-suggestion]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tag-suggestion')));
  expect(JSON.stringify(await offered()) === '["work","home","errand"]', `all suggestions: ${JSON.stringify(await offered())} (most used first, then the declared-only tag)`);

  await page.locator('input[placeholder="New tag"]').fill('ho');
  expect(JSON.stringify(await offered()) === '["home"]', `after typing "ho": ${JSON.stringify(await offered())}`);
  await page.locator('[data-tag-suggestion="home"]').click();
  expect((await page.locator('[aria-label="Remove tag home"]').count()) === 1, 'tapping a suggestion should add that tag');
  expect(!(await offered()).includes('home'), 'an applied tag must not be offered again');
  await page.locator('input[placeholder="New tag"]').fill('');
  expect(JSON.stringify(await offered()) === '["work","errand"]', `after adding home: ${JSON.stringify(await offered())}`);

  // Enter adds what was typed, suggested or not
  await page.locator('input[placeholder="New tag"]').fill('brandnew');
  await page.locator('input[placeholder="New tag"]').press('Enter');
  expect((await page.locator('[aria-label="Remove tag brandnew"]').count()) === 1, 'Enter should add the typed tag');

  // property keys are offered too: one already used, and ones the app knows
  await page.getByText('+ Add property').click();
  const keys = await page.evaluate(() => [...document.querySelectorAll('datalist[id^="property-keys-"] option')].map((o) => o.value));
  expect(keys.includes('OWNER') && keys.includes('EFFORT') && keys.includes('CUSTOM_ID'), `property keys offered: ${JSON.stringify(keys)}`);

  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(500);
  const text = await documentText(page);
  expect(/^\* Gamma\s+:home:brandnew:\s*$/m.test(text), `saved heading: ${JSON.stringify(text.split('\n').find((l) => l.includes('Gamma')))}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('command palette: capture templates and Extras entries are commands you can run by name', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, ['* Note', '', '# Local Variables:', '# org-xx-extra-menu: "\'org-clock-out;Stop the clock"', '# End:', ''].join('\n'));
  const { DEFAULT_CAPTURE_TEMPLATES } = await import(ROOT + '/src-browser/settings.js');

  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Commands');
  await page.waitForSelector('#command-palette');
  await page.keyboard.type('capture:');
  const captureRows = (await paletteRows(page)).map((r) => r.split('\n')[0]);
  const expected = DEFAULT_CAPTURE_TEMPLATES.map((t) => `Capture: ${t.description}`);
  expect(JSON.stringify([...captureRows].sort()) === JSON.stringify([...expected].sort()), `capture rows: ${JSON.stringify(captureRows)} vs ${JSON.stringify(expected)}`);

  // an Extras entry from the document's own Local Variables
  await page.keyboard.press('Control+A');
  await page.keyboard.type('extras');
  const extraRows = (await paletteRows(page)).map((r) => r.split('\n')[0]);
  expect(extraRows.length === 1 && extraRows[0] === 'Extras: Stop the clock', `extras rows: ${JSON.stringify(extraRows)}`);

  // running a template that asks questions opens its form
  await page.keyboard.press('Control+A');
  await page.keyboard.type('capture: meeting');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#capturePanel', { state: 'visible', timeout: 5000 });
  const panel = await page.locator('#capturePanel').innerText();
  expect(panel.includes('Meeting'), `the capture form for the chosen template should be showing: ${JSON.stringify(panel.slice(0, 120))}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('more menu: the Commands entry can be renamed or omitted via org-xx-menu-aliases, and stays visible (default order) when left unmentioned', async () => {
  const localVars = (line) => ['* A', '', '# Local Variables:', `# ${line}`, '# End:', ''].join('\n');

  let { context, page, errors } = await freshPage();
  await newDocument(page, localVars('org-xx-menu-aliases: "more:Commands;\u{1F4B2}Commands"'));
  await page.click('#moreBtn');
  let menuText = await page.locator('#morePanel').innerText();
  expect(menuText.includes('\u{1F4B2}Commands'), `renamed label should appear: ${JSON.stringify(menuText)}`);
  expect(!/(^|\n)Commands(\n|$)/.test(menuText), 'the original label should no longer appear on its own');
  await page.locator('#morePanel').getByText('\u{1F4B2}Commands').click();
  await page.waitForSelector('#command-palette');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  ({ context, page, errors } = await freshPage());
  await newDocument(page, localVars('org-xx-menu-aliases: "more:Commands;"'));
  await page.click('#moreBtn');
  menuText = await page.locator('#morePanel').innerText();
  expect(!menuText.includes('Commands'), `Commands should be omitted entirely: ${JSON.stringify(menuText)}`);
  expect(menuText.includes('Export') && menuText.includes('Settings'), 'the other entries should be unaffected');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  ({ context, page, errors } = await freshPage());
  await newDocument(page, localVars('org-xx-menu-aliases: "more:Export;" "more:Import;" "more:Settings;\u2699\uFE0F"'));
  await page.click('#moreBtn');
  menuText = await page.locator('#morePanel').innerText();
  expect(menuText.includes('Commands'), `Commands should still show even though this alias list never mentions it: ${JSON.stringify(menuText)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

async function openPalette(page) {
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Commands');
  await page.waitForSelector('#command-palette');
}
const paletteRows = (page) => page.locator('#command-palette [role=option]').allInnerTexts();

check('command palette: finds a command by name or real Org name, runs it on the open heading, and explains the ones it cannot run', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.click('#moreBtn');
  const menu = (await page.locator('#morePanel').innerText()).split('\n').filter(Boolean);
  expect(menu[0] === 'Commands', `Commands should be the first More entry: ${menu.join(' | ')}`);
  await page.click('#moreBtn'); // close it again

  await page.locator('.heading-title').first().click(); // opens this heading's action menu = the command's target
  await openPalette(page);
  await page.keyboard.type('org-set-effort');
  const rows = await paletteRows(page);
  expect(rows.length === 1 && rows[0].includes('Set effort estimate'), `rows: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea');
  await page.locator('textarea').last().fill('45min');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  expect((await page.locator('.priority-badge').allInnerTexts()).join().includes('45min'), 'the effort was not set on the heading');

  await openPalette(page);
  await page.keyboard.type('widen');
  const blocked = (await paletteRows(page)).join(' ');
  expect(blocked.includes('nothing is narrowed'), `an unavailable command should say why: ${blocked}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await status(page)).includes('nothing is narrowed'), `status: ${await status(page)}`);

  await openPalette(page); // empty query: the command just used comes first
  expect((await paletteRows(page))[0].includes('Set effort estimate'), 'the most recently used command should lead');
  await page.keyboard.press('Escape');
  expect(!(await page.locator('#command-palette').count()), 'Escape should close the palette');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('command palette: available commands are listed before unavailable ones', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* Write report\n');
  await openPalette(page);
  await page.keyboard.type('clock');
  const rows = await paletteRows(page);
  const firstBlocked = rows.findIndex((r) => r.includes('unavailable'));
  const lastAvailable = rows.map((r) => r.includes('unavailable')).lastIndexOf(false);
  expect(firstBlocked !== -1 && lastAvailable < firstBlocked, `order: ${JSON.stringify(rows.map((r) => r.split('\n')[0]))}`);
  await context.close();
});

check('command palette: opens from the keyboard with god-mode "g x" (M-x)', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape'); // enter god-mode
  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await page.waitForSelector('#command-palette', { timeout: 4000 });
  await context.close();
});

check('god-mode: bare left/right collapse/expand the focused heading (a new capability, since only their Shift forms had any meaning before)', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Parent\n** Child\nbody text\n');
  const godSeq = async (...keys) => {
    if ((await page.locator('#minibuffer').innerText()) !== '\ud83e\udde0 God-mode (Esc to exit)') {
      await page.keyboard.press('Escape');
      if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) {
        await page.keyboard.press('Escape');
      }
    }
    for (const k of keys) await page.keyboard.press(k);
    await page.waitForTimeout(250);
  };
  await page.locator('.heading-title', { hasText: 'Parent' }).first().click();
  await godSeq('ArrowLeft'); // collapseFully
  const foldGlyph = () => page.locator('.heading-title', { hasText: 'Parent' }).locator('xpath=..').innerText();
  expect((await foldGlyph()).includes('\u25b8'), `expected the collapsed glyph after ArrowLeft: ${await foldGlyph()}`);
  expect(!(await page.locator('body').innerText()).includes('Child'), 'Child should be hidden once collapsed');

  await page.locator('.heading-title', { hasText: 'Parent' }).first().click();
  await godSeq('ArrowRight'); // expandOneLevel
  expect((await page.locator('body').innerText()).includes('Child'), 'Child should be visible again after ArrowRight');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: [g] opens it with god-mode and the hidden input; its buttons work without stealing focus; Shift is one-shot; it drags; [g] again or a dismissed device keyboard closes everything', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Parent\n** Child\nbody\n');
  const fk = page.locator('#floatingKeyboard');
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const godOn = async () => (await page.locator('#minibuffer').innerText()).includes('God-mode');

  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  expect(await godOn(), 'tapping [g] should enter god-mode');
  expect((await activeId()) === 'godModeKeyboardInput', `the hidden input should hold focus: ${await activeId()}`);
  const labels = await fk.locator('button').allInnerTexts();
  expect(JSON.stringify(labels) === JSON.stringify(['Tab', '\u2190', '\u2192', '\u2191', '\u2193', 'S', 'g']), `layout T \u2190 \u2192 \u2191 \u2193 S g: ${JSON.stringify(labels)}`);

  await fk.locator('[data-fk-key=ArrowLeft]').click(); // collapse the auto-focused Parent
  expect(!(await page.locator('#outline').innerText()).includes('Child'), 'the left-arrow button should collapse the focused heading');
  expect((await activeId()) === 'godModeKeyboardInput', 'tapping a floating-keyboard button must not move focus off the input');
  expect(await godOn(), 'god-mode should stay on after a button tap');
  await fk.locator('[data-fk-key=ArrowRight]').click();
  expect((await page.locator('#outline').innerText()).includes('Child'), 'the right-arrow button should expand it again');

  const shift = fk.locator('[data-fk-shift]');
  await shift.click();
  expect((await shift.getAttribute('aria-pressed')) === 'true', 'S should arm Shift');
  expect((await fk.locator('[data-fk-key=g]').innerText()) === 'G', 'g should read G while Shift is armed');
  await fk.locator('[data-fk-key=g]').click();
  expect((await shift.getAttribute('aria-pressed')) === 'false', 'Shift should be consumed by the next tap');
  expect((await fk.locator('[data-fk-key=g]').innerText()) === 'g', 'g should read g again');
  await shift.click();
  await shift.click();
  expect((await shift.getAttribute('aria-pressed')) === 'false', 'tapping S twice should disarm it');

  const before = await fk.boundingBox();
  const handle = await fk.locator('[data-fk-handle]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 90, handle.y - 120, { steps: 6 });
  await page.mouse.up();
  const after = await fk.boundingBox();
  expect(Math.abs(after.y - before.y) > 40, `dragging the handle should move it (horizontal travel is legitimately clamped on a phone-width viewport): ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  expect((await activeId()) === 'godModeKeyboardInput', 'dragging must not move focus off the input');

  await page.click('#godModeBtn'); // toggle off
  await fk.waitFor({ state: 'hidden' });
  expect(!(await godOn()), 'tapping [g] again should leave god-mode');
  expect((await activeId()) !== 'godModeKeyboardInput', 'and dismiss the device keyboard');

  await page.click('#godModeBtn'); // on again -- keeps its dragged position
  await fk.waitFor({ state: 'visible' });
  const again = await fk.boundingBox();
  expect(Math.abs(again.x - after.x) < 2 && Math.abs(again.y - after.y) < 2, 'the dragged position should be remembered for the session');
  await page.evaluate(() => document.getElementById('godModeKeyboardInput').blur()); // the device keyboard dismissed itself
  await fk.waitFor({ state: 'hidden' });
  expect(!(await godOn()), 'a dismissed device keyboard should end god-mode too');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('org-clock-goto (C-c C-x C-j, "Go to clocked task"): dimmed with no clock, then jumps to the clocked heading -- revealing it if folded away, and switching tabs if the clock is in another one', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Parent\n** Child\n* Other\n');
  const outline = () => page.locator('#outline').innerText();
  const palette = async (text) => {
    await openPalette(page);
    await page.keyboard.type(text);
  };

  // no clock running: the command is listed but dimmed, with the reason
  await palette('go to clocked');
  const rows = await paletteRows(page);
  expect(rows.some((r) => r.includes('Go to clocked task') && r.includes('no clock is running')), `should be dimmed with no clock: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Escape');

  // clock in on Child, then fold it out of sight
  await page.locator('.heading-title', { hasText: 'Child' }).first().click();
  await palette('clock in');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await modeline(page)).includes('\u23f1') && (await modeline(page)).includes('Child'), `Child should be clocked: ${await modeline(page)}`);
  await page.locator('.fold-btn').first().click(); // fold Parent
  expect(!(await outline()).includes('Child'), 'Child should be folded out of sight');
  expect(!(await page.locator('#navBackBtn').isVisible()), 'nothing has been navigated yet');

  await palette('go to clocked');
  const live = await paletteRows(page); // available now, so it shows its chord instead of a reason
  expect(live.some((r) => r.includes('Go to clocked task') && r.includes('C-c C-x C-j') && !r.includes('unavailable')), `available, with its chord, once a clock runs: ${JSON.stringify(live)}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect((await outline()).includes('Child'), 'going to the clocked task should unfold whatever hides it');
  expect(await page.locator('#navBackBtn').isVisible(), 'and, like every jump, leave a way back');

  // the same chord from god-mode
  await page.locator('.fold-btn').first().click(); // fold it away again
  expect(!(await outline()).includes('Child'), 'Child folded again');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  for (const k of ['c', 'x', 'j']) await page.keyboard.press(k);
  await page.waitForTimeout(400);
  expect((await outline()).includes('Child'), 'C-c C-x C-j should do the same from god-mode');

  // the clock is in the first tab; open a second and go to it from there
  await newDocument(page, '* Second document\nsecond body\n');
  expect(!(await outline()).includes('Child') && (await outline()).includes('Second document'), 'the second tab should be showing');
  await palette('go to clocked');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  expect((await outline()).includes('Child') && !(await outline()).includes('Second document'), `it should switch to the tab holding the clock: ${await outline()}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('quick setting: "Show the floating [g] god-mode button" hides and shows [g], survives a reload (even on the empty start screen), and a document\u2019s own Local Variables line overrides it', async () => {
  const { context, page, errors } = await freshPage();
  const g = page.locator('#godModeBtn');
  const box = () => page.locator('label', { hasText: 'Show the floating [g] god-mode button' }).locator('input[type=checkbox]');
  // the checkbox handler saves, then re-renders: wait for the result rather than sampling mid-way
  const becomes = async (visible, msg) => {
    try { await g.waitFor({ state: visible ? 'visible' : 'hidden', timeout: 4000 }); } catch { throw new Error(msg); }
  };
  const openSettings = async () => {
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Settings');
    await box().waitFor({ state: 'visible' });
  };
  expect(await g.isVisible(), '[g] is on by default');
  await openSettings();
  expect(await box().isChecked(), 'the setting should default to on');
  await box().uncheck();
  await becomes(false, 'turning the setting off should hide [g] at once');

  await page.reload();
  await page.locator('#moreBtn').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await becomes(false, 'the setting is remembered across a reload, with no document open');
  await openSettings();
  expect(!(await box().isChecked()), 'and the checkbox shows it off');
  await box().check();
  await becomes(true, 'turning it back on shows [g] again');

  // a document's own Local Variables line wins over the global value, as for every other variable
  await box().uncheck();
  const local = (v) => ['* Plain', '', '# Local Variables:', `# org-xx-god-mode-button: ${v}`, '# End:', ''].join('\n');
  await newDocument(page, local('t'));
  await becomes(true, 'a document that says t shows it even though the global setting is off');
  await openSettings(); // opening a document closed Settings
  await box().check();
  await newDocument(page, local('nil'));
  await becomes(false, 'a document that says nil hides it even though the global setting is on');

  // hiding it moves nothing else: the Extras button stays exactly where it was
  await newDocument(page, ['* Plain', '', '# Local Variables:', '# org-xx-god-mode-button: nil', '# org-xx-extra-menu: "\'org-clock-out;Stop the clock"', '# End:', ''].join('\n'));
  await page.locator('#extraMenuBtn').waitFor({ state: 'visible' });
  const ml = await page.locator('#modelineBar').boundingBox();
  const extras = await page.locator('#extraMenuBtn').boundingBox();
  expect(Math.abs(extras.y + extras.height - (ml.y - 16)) < 1.5, `Extras must not move when [g] is hidden: bottom ${extras.y + extras.height}, mode line top ${ml.y}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating [g]: after switching documents, god-mode acts on the NEW document (keyboard focus left over from the old one is dropped)', async () => {
  const { context, page, errors } = await freshPage();
  const fk = page.locator('#floatingKeyboard');
  await newDocument(page, '* Old\n');
  await page.click('#godModeBtn'); // focuses Old
  await fk.waitFor({ state: 'visible' });
  await page.click('#godModeBtn'); // and leave, with keyboard focus still on Old
  await newDocument(page, '* New\n');
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  await fk.locator('[data-fk-key=g]').click();
  await page.keyboard.press('Enter'); // M-RET: add a heading after the focused one
  await page.waitForSelector('#heading-title-edit-popup', { timeout: 4000 });
  await page.keyboard.type('Added');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  await viewMenu(page, 'Text');
  const text = (await page.locator('#document-text-edit-input').inputValue()).replace(/\n\n+/g, '\n').trim();
  expect(text === '* New\n* Added', `the new heading should land in the new document: ${JSON.stringify(text)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: g, then S, then Return on the DEVICE keyboard is M-S-RET (a TODO heading) -- whether the Return arrives as a real keydown (iOS) or an input event (Android); S is one-shot and also capitalises a typed letter', async () => {
  const { context, page, errors } = await freshPage();
  const fk = page.locator('#floatingKeyboard');
  const shift = fk.locator('[data-fk-shift]');
  const outlineText = async () => {
    await viewMenu(page, 'Text');
    const t = await page.locator('#document-text-edit-input').inputValue();
    await viewMenu(page, 'Org');
    return t.replace(/\n\n+/g, '\n'); // adding a heading after the last one puts a blank line before it; not what is under test
  };
  const fresh = async () => {
    await newDocument(page, '* One\n');
    await page.click('#godModeBtn');
    await fk.waitFor({ state: 'visible' });
  };
  const androidReturn = () => page.evaluate(() => {
    document.getElementById('godModeKeyboardInput').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }));
  });
  const finishTitle = async (title) => {
    await page.waitForSelector('#heading-title-edit-popup', { timeout: 4000 });
    await page.keyboard.type(title);
    await page.getByText('OK', { exact: true }).last().click();
    await page.waitForTimeout(300);
  };

  // 1. iOS-style: the device keyboard's Return is a real keydown
  await fresh();
  await fk.locator('[data-fk-key=g]').click(); // g: waits for the next key
  await shift.click();
  expect((await shift.getAttribute('aria-pressed')) === 'true', 'S should light up');
  await page.keyboard.press('Enter'); // the phone keyboard's Return
  await finishTitle('Two');
  expect((await outlineText()).trim() === '* One\n* TODO Two'.trim(), `g, S, Return should insert a TODO heading (M-S-RET): ${JSON.stringify(await outlineText())}`);

  // 2. Android-style: the Return arrives as an input event, not a keydown
  await fresh();
  await fk.locator('[data-fk-key=g]').click();
  await shift.click();
  await androidReturn();
  await finishTitle('Three');
  expect((await outlineText()).trim() === '* One\n* TODO Three'.trim(), `the same through an input event: ${JSON.stringify(await outlineText())}`);

  // 3. without S the very same taps are plain M-RET: a heading, no TODO keyword
  await fresh();
  await fk.locator('[data-fk-key=g]').click();
  await page.keyboard.press('Enter');
  await finishTitle('Plain');
  expect((await outlineText()).trim() === '* One\n* Plain'.trim(), `g then Return alone is M-RET: ${JSON.stringify(await outlineText())}`);

  // 4. one-shot: S is consumed by the device-keyboard key, so a later Return is plain again
  await fresh();
  await shift.click();
  await page.keyboard.press('h'); // consumes S (it becomes H, an unrecognized chord -- irrelevant here)
  expect((await shift.getAttribute('aria-pressed')) === 'false', 'S should be used up by the device-keyboard key');
  await fk.locator('[data-fk-key=g]').click();
  await page.keyboard.press('Enter');
  await finishTitle('After');
  expect((await outlineText()).trim() === '* One\n* After'.trim(), `a Return after S was consumed is plain M-RET: ${JSON.stringify(await outlineText())}`);

  // 5. a letter typed after S is capitalised: g becomes G (C-M-), so the Return that follows is C-M-RET, not M-RET
  await fresh();
  await shift.click();
  await page.keyboard.press('g');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect((await page.locator('#heading-title-edit-popup').count()) === 0, 'S then a typed g is G (C-M-), which is not M-: no heading should be inserted');
  expect((await outlineText()).trim() === '* One', `nothing inserted: ${JSON.stringify(await outlineText())}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: entering god-mode with a real Escape does NOT show it, and ending god-mode any other way hides it', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* Parent\n');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  expect((await page.locator('#floatingKeyboard').isVisible()) === false, 'a desktop Escape should not bring up an on-screen keyboard');
  await page.keyboard.press('Escape'); // leave
  await page.click('#godModeBtn');
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
  // keys typed on the device keyboard land in the hidden input and must still reach god-mode
  await page.keyboard.press('x'); // x then q would toggle read-only; just prove the sequence advances
  expect((await page.locator('#minibuffer').innerText()).includes('C-x'), `a key typed into the hidden input should reach god-mode: ${await page.locator('#minibuffer').innerText()}`);
  await page.keyboard.press('Escape'); // cancels that sequence
  await page.keyboard.press('Escape'); // a real Escape ends god-mode from the hidden input too
  await page.locator('#floatingKeyboard').waitFor({ state: 'hidden' });
  await context.close();
});

check('floating [g]: a floating button stacked directly above Extras (taking its place when there is none); it is not in the top bar and nothing already on screen moves', async () => {
  let { context, page } = await freshPage();
  await newDocument(page, '* Plain\n');
  expect((await page.locator('#topBar #godModeBtn').count()) === 0, '[g] must not be in the top bar -- that displaced the buttons already there');
  expect((await page.locator('#godModeBtn').evaluate((el) => getComputedStyle(el).position)) === 'fixed', '[g] should be a floating button');
  let ml = await page.locator('#modelineBar').boundingBox();
  let g = await page.locator('#godModeBtn').boundingBox();
  expect(Math.abs(g.y + g.height - (ml.y - 16)) < 1.5, `with no Extras menu [g] takes the Extras slot, 16px above the mode line: g bottom ${g.y + g.height}, mode line top ${ml.y}`);
  await context.close();

  ({ context, page } = await freshPage());
  await newDocument(page, ['* Plain', '', '# Local Variables:', '# org-xx-extra-menu: "\'org-clock-out;Stop the clock"', '# End:', ''].join('\n'));
  await page.locator('#extraMenuBtn').waitFor({ state: 'visible' });
  ml = await page.locator('#modelineBar').boundingBox();
  const extras = await page.locator('#extraMenuBtn').boundingBox();
  g = await page.locator('#godModeBtn').boundingBox();
  expect(Math.abs(extras.y + extras.height - (ml.y - 16)) < 1.5, `the Extras button must not move: bottom ${extras.y + extras.height}, mode line top ${ml.y}`);
  expect(g.y + g.height <= extras.y - 5, `[g] sits above Extras: g bottom ${g.y + g.height}, extras top ${extras.y}`);
  expect(Math.abs(g.x + g.width - (extras.x + extras.width)) < 1.5, '[g] lines up with Extras on the right');
  await context.close();
});

check('floating keyboard: always above the mode line -- by default, however far it is dragged, and when the viewport shrinks', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* Parent\n');
  const fk = page.locator('#floatingKeyboard');
  const clear = async (what) => {
    const ml = await page.locator('#modelineBar').boundingBox();
    const box = await fk.boundingBox();
    expect(box.y + box.height <= ml.y + 0.5, `${what}: panel bottom ${box.y + box.height} must be at or above the mode line top ${ml.y}`);
    expect(box.y >= -0.5, `${what}: panel top ${box.y} must stay on screen`);
    return box;
  };
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  await clear('by default');
  const g = await page.locator('#godModeBtn').boundingBox();
  const start = await fk.boundingBox();
  expect(start.y + start.height <= g.y, 'by default the panel is clear of the [g] button that closes it');

  const handle = await fk.locator('[data-fk-handle]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y + 900, { steps: 8 }); // dragged far below the mode line
  await page.mouse.up();
  await clear('dragged far down');
  const moved = await fk.boundingBox();
  // the device keyboard: the app learns of it only through visualViewport, and lifts its mode line by the
  // covered height -- the panel must ride up with it instead of staying underneath (the reported bug)
  const setKeyboard = (px) => page.evaluate((h) => {
    const vv = window.visualViewport;
    if (h) Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
    else delete vv.height;
    vv.dispatchEvent(new Event('resize'));
  }, px);
  await setKeyboard(300);
  await page.waitForTimeout(300);
  const lifted = await page.locator('#modelineBar').boundingBox();
  expect(lifted.y < (await page.viewportSize()).height - 250, `the app should have lifted its mode line above the emulated keyboard: ${lifted.y}`);
  await clear('with a 300px device keyboard up');
  const withKeyboard = await fk.boundingBox();
  await setKeyboard(0);
  await page.waitForTimeout(300);
  await clear('after the device keyboard went away');
  expect(withKeyboard.y < (await fk.boundingBox()).y, 'the panel should come back down with the mode line');
  await page.setViewportSize({ width: 400, height: 420 });
  await page.waitForTimeout(300);
  await clear('after the viewport shrank');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(300);
  await clear('after it grew back');
  expect(moved.y > start.y, 'the drag itself should have moved it down toward the mode line');
  await context.close();
});

check('floating keyboard: tapping the move area minimizes it to just that handle, tapping again restores it, and dragging does neither', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Parent\n');
  const fk = page.locator('#floatingKeyboard');
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  const full = await fk.boundingBox();
  const handle = fk.locator('[data-fk-handle]');

  const h = await handle.boundingBox(); // a drag must not count as a tap
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 30, h.y + h.height / 2 - 50, { steps: 5 });
  await page.mouse.up();
  expect((await fk.locator('button').count()) === 7, 'a drag should not minimize it');

  await handle.click();
  expect((await fk.locator('button').count()) === 0, 'a tap on the move area should hide every key');
  expect((await fk.getAttribute('role')) === 'toolbar' && (await handle.isVisible()), 'the handle stays, so it can be restored');
  const small = await fk.boundingBox();
  expect(small.width < full.width / 2, `minimized should be far narrower: ${full.width} -> ${small.width}`);
  expect((await page.locator('#minibuffer').innerText()).includes('God-mode'), 'minimizing must not end god-mode');
  expect((await activeId()) === 'godModeKeyboardInput', 'or dismiss the device keyboard');

  await handle.click();
  expect((await fk.locator('button').count()) === 7, 'tapping the minimized handle restores every key');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: letters typed the way Android delivers them (keydown "Unidentified"/229, then an input event or an IME composition) reach god-mode, exactly once', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Parent\n');
  const mini = async () => (await page.locator('#minibuffer').innerText()).replace(/\s+/g, ' ');
  await page.click('#godModeBtn');
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
  const androidKeydown = () => page.evaluate(() => {
    document.getElementById('godModeKeyboardInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true, cancelable: true }));
  });

  // 1. a plain insertText, as after a 229 keydown on a keyboard that does not compose
  await androidKeydown();
  await page.keyboard.insertText('h');
  expect((await mini()).includes('C-h'), `typing h should show C-h in the minibuffer, as it does everywhere else: ${await mini()}`);
  await page.click('#godModeBtn'); // off, then on: a clean sequence
  await page.click('#godModeBtn');
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });

  // 2. an IME composition growing in place: c, then cx -- two keystrokes, not one and not three. Each is preceded by
  //    the keydown with no key; if that were treated as a keystroke it would be an unrecognized dead end that resets
  //    the sequence in progress (the status message it sets is overwritten at once, so the sequence is what shows it)
  const cdp = await context.newCDPSession(page);
  await androidKeydown();
  await cdp.send('Input.imeSetComposition', { text: 'c', selectionStart: 1, selectionEnd: 1 });
  await androidKeydown();
  await cdp.send('Input.imeSetComposition', { text: 'cx', selectionStart: 2, selectionEnd: 2 });
  expect((await mini()).includes('C-c C-x'), `a composition c then cx should be C-c then C-x: ${await mini()}`);
  await page.click('#godModeBtn');
  await page.click('#godModeBtn');
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });

  // 3. a keyboard that sends BOTH a real keydown and the input event must not double-count
  await page.evaluate(() => {
    document.getElementById('godModeKeyboardInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'h', keyCode: 72, bubbles: true, cancelable: true }));
  });
  await page.keyboard.insertText('h');
  expect((await mini()).endsWith('C-h'), `one h, seen twice, must count once: ${await mini()}`);
  await page.click('#godModeBtn');
  await page.click('#godModeBtn');
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });

  // 4. an uppercase letter carries its own shift: G is god-mode's C-M- prefix
  await page.keyboard.insertText('G');
  expect((await mini()).includes('\u2026'), `G should leave god-mode waiting on a C-M- prefix: ${await mini()}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: i/a/e enter insert mode at the focused row (the special, non-chord fresh-sequence cases)', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.locator('.heading-title').first().click();
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) {
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('i');
  await page.waitForSelector('#heading-title-edit-popup', { timeout: 4000 });
  expect(true, 'i should open the title editor for the keyboard-focused heading');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: C-h m opens Help, and C-s opens search', async () => {
  let { context, page, errors } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  await page.keyboard.press(' ');
  await page.keyboard.press('m');
  await waitForModeline(page, 'Help');
  expect((await modeline(page)).includes('Help'), `expected Help to open: ${await modeline(page)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  ({ context, page, errors } = await freshPage());
  await newDocument(page, '* Write report\n');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.waitForSelector('#search-query-input', { state: 'visible', timeout: 4000 });
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: C-/ undoes, and C-f then C-/ redoes -- repeatedly, until it falls back to undo again', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Alpha\n* Beta\n');
  const godSeq = async (...keys) => {
    await page.locator('body').click({ position: { x: 200, y: 800 } });
    await page.keyboard.press('Escape');
    // Escape's first press only clears keyboard focus if a heading is
    // currently focused (real, correct behavior) -- a second press is
    // then needed to actually enter god-mode. Neither undo nor redo
    // cares which heading ends up focused, so this is safe here.
    if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) {
      await page.keyboard.press('Escape');
    }
    for (const k of keys) await page.keyboard.press(k);
    await page.waitForTimeout(250);
  };
  // two edits: title changes, made via the title editor (each is its own undo step)
  const renameHeading = async (from, to) => {
    await page.locator('.heading-title', { hasText: from }).first().click();
    await page.getByRole('button', { name: 'Edit title' }).click();
    await page.waitForSelector('#heading-title-edit-popup');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(to);
    await page.getByText('OK', { exact: true }).last().click();
    await page.waitForTimeout(300);
  };
  await renameHeading('Alpha', 'Alpha1');
  await renameHeading('Beta', 'Beta1');
  expect((await documentText(page)).includes('Alpha1') && (await documentText(page)).includes('Beta1'), `both edits should be applied: ${await documentText(page)}`);

  await godSeq('/'); // plain undo: reverts the second edit (Beta1 -> Beta)
  expect((await documentText(page)).includes('Alpha1') && (await documentText(page)).includes('* Beta\n'), `first undo should revert only Beta1: ${await documentText(page)}`);

  await godSeq('/'); // undo again: reverts the first edit too (Alpha1 -> Alpha)
  expect((await documentText(page)).includes('* Alpha\n') && (await documentText(page)).includes('* Beta\n'), `second undo should also revert Alpha1: ${await documentText(page)}`);

  await godSeq('f', '/'); // break the chain, then redo: brings Alpha1 back
  expect((await documentText(page)).includes('Alpha1') && !(await documentText(page)).includes('Beta1'), `C-f then C-/ should redo just the first step: ${await documentText(page)}`);

  await godSeq('/'); // keep pressing / to continue redoing, no further C-f needed: brings Beta1 back too
  expect((await documentText(page)).includes('Alpha1') && (await documentText(page)).includes('Beta1'), `a second C-/ should continue redoing: ${await documentText(page)}`);

  await godSeq('/'); // nothing left to redo -- falls back to a plain undo (reverts Beta1 again)
  expect((await documentText(page)).includes('Alpha1') && !(await documentText(page)).includes('Beta1'), `redo exhausted should fall back to undo: ${await documentText(page)}`);

  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: the new chords for refile/attach/clocking/export reach their real targets', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.locator('.heading-title').first().click();
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  const godSeq = async (...keys) => {
    // god-mode stays active across dispatches by design, so only press
    // Escape (once or twice, as needed) when NOT already in a clean,
    // ready-for-a-fresh-chord god-mode state -- pressing it unconditionally
    // would otherwise EXIT an already-active god-mode instead of entering it.
    if ((await page.locator('#minibuffer').innerText()) !== '\ud83e\udde0 God-mode (Esc to exit)') {
      await page.keyboard.press('Escape');
      if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) {
        await page.keyboard.press('Escape');
      }
    }
    for (const k of keys) await page.keyboard.press(k);
    await page.waitForTimeout(300);
  };

  await godSeq('c', 'w'); // C-c C-w: refile
  const refileVisible = (await page.locator('body').innerText()).includes('Refile');
  expect(refileVisible, 'C-c C-w should open the refile picker');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await godSeq('c', 'a'); // C-c C-a: attach
  const attachVisible = (await page.locator('body').innerText()).includes('Attachments for');
  expect(attachVisible, 'C-c C-a should open the attachment choice prompt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await godSeq('c', 'x', 'i'); // C-c C-x C-i: clock in
  expect((await modeline(page)).includes('\u23f1'), `clock-in should show in the modeline: ${await modeline(page)}`);

  await godSeq('c', 'x', 'o'); // C-c C-x C-o: clock out
  expect(!(await modeline(page)).includes('\u23f1'), `clock-out should clear the modeline's clock indicator: ${await modeline(page)}`);

  await godSeq('c', 'x', 'i'); // clock in again, then cancel
  await page.waitForTimeout(200);
  expect((await modeline(page)).includes('\u23f1'), `clock-in (second time) should show in the modeline: ${await modeline(page)}`);
  await godSeq('c', 'x', 'q'); // C-c C-x C-q: cancel clock
  expect(!(await modeline(page)).includes('\u23f1'), `clock-cancel should clear the modeline's clock indicator: ${await modeline(page)}`);

  await godSeq('c', 'x', 'x'); // C-c C-x C-x: continue last clock
  await page.waitForTimeout(200);
  expect((await modeline(page)).includes('\u23f1'), `C-c C-x C-x should resume clocking: ${await modeline(page)}`);

  await godSeq('c', 'e'); // C-c C-e: export dispatcher, within the More menu
  expect((await page.locator('body').innerText()).includes('HTML'), 'C-c C-e should open the export flow');

  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('add heading: inserts as a sibling right after the selected heading (the common case); works on a genuinely empty document (M-RET and M-S-RET both insert at the top); appends at the bottom when nothing is selected', async () => {
  // 1. a truly empty document: M-RET (god-mode "g" then Enter) inserts a
  // single top-level heading at the top, cursor ready to type.
  let { context, page, errors } = await freshPage();
  await newDocument(page, '');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape'); // enter god-mode
  await page.keyboard.press('g');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#heading-title-edit-popup');
  await page.keyboard.type('First');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  expect((await documentText(page)).trim() === '* First', `M-RET on an empty doc: ${JSON.stringify(await documentText(page))}`);
  await context.close();

  // 2. M-S-RET on an empty document: a top-level heading with the default
  // TODO keyword, also at the top.
  ({ context, page } = await freshPage());
  await newDocument(page, '');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await page.keyboard.press('Shift+Enter');
  await page.waitForSelector('#heading-title-edit-popup');
  await page.keyboard.type('Second');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  expect((await documentText(page)).trim() === '* TODO Second', `M-S-RET on an empty doc: ${JSON.stringify(await documentText(page))}`);
  await context.close();

  // 3. a document WITH headings, but nothing selected: running "Add heading
  // after" from the palette (where the palette itself must now let the
  // command through, not dim it for lack of a target) appends at the
  // bottom rather than doing nothing.
  ({ context, page, errors } = await freshPage());
  await newDocument(page, '* One\n* Two\n');
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Commands');
  await page.waitForSelector('#command-palette');
  await page.keyboard.type('add heading after');
  const rows = await page.locator('#command-palette [role=option]').allInnerTexts();
  expect(!rows.join('\n').includes('unavailable'), `should not be dimmed with nothing selected: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#heading-title-edit-popup');
  await page.keyboard.type('Third');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  const text = await documentText(page);
  expect(text.trim().endsWith('* Third'), `expected the new heading appended at the bottom: ${JSON.stringify(text)}`);
  expect(text.startsWith('* One'), `existing headings should be untouched: ${JSON.stringify(text)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  // 4. the common case: a heading IS selected, so the new one is inserted
  // as its sibling right after it -- not at the top or bottom.
  ({ context, page, errors } = await freshPage());
  await newDocument(page, '* One\n* Two\n* Three\n');
  await page.locator('.heading-title', { hasText: 'Two' }).first().click();
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Commands');
  await page.waitForSelector('#command-palette');
  await page.keyboard.type('add heading after');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#heading-title-edit-popup');
  await page.keyboard.type('Inserted');
  await page.getByText('OK', { exact: true }).last().click();
  await page.waitForTimeout(300);
  const siblingText = await documentText(page);
  expect(
    siblingText.trim() === '* One\n* Two\n* Inserted\n* Three'.trim(),
    `expected Inserted right after Two, before Three: ${JSON.stringify(siblingText)}`
  );
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('refile: the destination used last is offered first, under RECENT', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Home\n* Work\n* Task one\n* Task two\n');
  const openPicker = async (title) => {
    await page.locator('.heading-title', { hasText: title }).first().click();
    await page.locator('[aria-label="Archive"]').first().click();
    await page.locator('button', { hasText: 'Refile' }).first().click();
    await page.waitForTimeout(700);
  };
  await openPicker('Task one');
  expect((await page.locator('[data-recent-target]').count()) === 0, 'nothing is recent before the first refile');
  await page.locator('.menu-list-item', { hasText: 'Home' }).first().click();
  await page.waitForTimeout(600);

  await openPicker('Task two');
  const recent = await page.locator('[data-recent-target]').allInnerTexts();
  expect(recent.length === 1 && recent[0].includes('Home'), `recent: ${JSON.stringify(recent)}`);
  const body = await page.locator('body').innerText();
  expect(body.includes('RECENT') && body.includes('ALL TARGETS'), 'the picker should label both sections');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('webdav: a document opens from the server and Save writes it back', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await replaceInDocument(page, 'body 1', 'body 1 edited');
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'Saved');
  expect(dav.get('notes.org') === SAMPLE.replace('body 1', 'body 1 edited'), `server has: ${JSON.stringify(dav.get('notes.org'))}`);
  await context.close();
});

check('conflict: edits in different places merge automatically, keeping both', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await replaceInDocument(page, 'body 1', 'body 1 -- mine');
  dav.set('notes.org', SAMPLE.replace('body 5', 'body 5 -- theirs'));
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'merged');
  expect(!(await page.locator('#conflict-resolver').count()), 'a clean merge should not ask anything');
  const expected = SAMPLE.replace('body 1', 'body 1 -- mine').replace('body 5', 'body 5 -- theirs');
  expect(dav.get('notes.org') === expected, `server has: ${JSON.stringify(dav.get('notes.org'))}`);
  expect((await documentText(page)) === expected, 'the open document was not updated to the merged text');
  await context.close();
});

async function overlappingConflict(page) {
  await openDav(page, 'notes.org');
  await replaceInDocument(page, 'body 1', 'body 1 -- mine');
  await replaceInDocument(page, 'body 3', 'body 3 -- mine');
  dav.set('notes.org', SAMPLE.replace('body 3', 'body 3 -- theirs').replace('body 5', 'body 5 -- theirs'));
  await fileMenu(page, 'Save');
  await page.waitForSelector('#conflict-resolver', { timeout: 8000 });
}

check('conflict: overlapping edits are decided region by region, and Apply waits for every decision', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await overlappingConflict(page);
  const dialog = await page.locator('#conflict-resolver').innerText();
  expect(dialog.includes('Difference 1 of 1'), `dialog: ${dialog}`);
  expect(dialog.includes('body 3 -- mine') && dialog.includes('body 3 -- theirs'), 'both versions should be shown');
  expect(await page.locator('[data-action="apply"]').isDisabled(), 'Apply should be disabled until the conflict is decided');
  await page.locator('#conflict-resolver [data-choice="theirs"]').click();
  expect(!(await page.locator('[data-action="apply"]').isDisabled()), 'Apply should enable once decided');
  await page.locator('[data-action="apply"]').click();
  await waitForStatus(page, 'merged');
  const expected = SAMPLE.replace('body 1', 'body 1 -- mine').replace('body 3', 'body 3 -- theirs').replace('body 5', 'body 5 -- theirs');
  expect(dav.get('notes.org') === expected, `server has: ${JSON.stringify(dav.get('notes.org'))}`);
  await context.close();
});

check('conflict: choosing "Both" keeps both versions of the contested lines', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await overlappingConflict(page);
  await page.locator('#conflict-resolver [data-choice="both"]').click();
  await page.locator('[data-action="apply"]').click();
  await waitForStatus(page, 'merged');
  expect(dav.get('notes.org').includes('body 3 -- mine\nbody 3 -- theirs'), `server has: ${JSON.stringify(dav.get('notes.org'))}`);
  await context.close();
});

check('conflict: Cancel changes nothing anywhere, and the same conflict returns on the next Save', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await overlappingConflict(page);
  const theirs = dav.get('notes.org');
  await page.locator('#conflict-resolver').getByText('Cancel', { exact: true }).click();
  await waitForStatus(page, 'Save cancelled');
  expect(dav.get('notes.org') === theirs, 'Cancel must not write to the server');
  expect((await modeline(page)).startsWith('**'), `the local edit should still be unsaved: ${await modeline(page)}`);
  await fileMenu(page, 'Save');
  await page.waitForSelector('#conflict-resolver', { timeout: 8000 });
  await context.close();
});

check('conflict: the banner\'s Merge combines unsaved edits with the other version, and the next Save is a plain write', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await replaceInDocument(page, 'body 1', 'body 1 -- mine');
  dav.set('notes.org', SAMPLE.replace('body 5', 'body 5 -- theirs'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('externalChangeBanner')).display !== 'none', null, { timeout: 8000 });
  await page.click('#externalChangeMergeBtn');
  await waitForStatus(page, 'Merged');
  const expected = SAMPLE.replace('body 1', 'body 1 -- mine').replace('body 5', 'body 5 -- theirs');
  expect((await documentText(page)) === expected, 'the document should hold both edits after Merge');
  expect(dav.get('notes.org') === SAMPLE.replace('body 5', 'body 5 -- theirs'), 'Merge alone must not write to the server');
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'Saved');
  expect(!(await page.locator('#conflict-resolver').count()), 'Save after Merge should not conflict again');
  expect(dav.get('notes.org') === expected, `server has: ${JSON.stringify(dav.get('notes.org'))}`);
  await context.close();
});

check('narrowing persists across a reload', async () => {
  dav.reset({ 'notes.org': SAMPLE });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await page.locator('.heading-title', { hasText: 'Two' }).first().click();
  await page.locator('[aria-label="Narrow"]').first().click();
  await page.waitForTimeout(500);
  expect(await page.getByText('Narrowed to: Two').count(), 'narrowing did not take effect');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  if (!(await page.getByText('Narrowed to: Two').count())) await openDav(page, 'notes.org');
  await page.waitForTimeout(500);
  expect(await page.getByText('Narrowed to: Two').count(), 'narrowing was lost across the reload');
  await context.close();
});

// ---- runner -------------------------------------------------------------------

const filter = process.argv[2];
const selected = filter ? checks.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())) : checks;
if (selected.length === 0) {
  console.error(`no checks match "${filter}"`);
  process.exit(2);
}

const { chromium } = loadPlaywright();
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
browser = await chromium.launch(launchOptions);
main = await startServer(dav);

let failed = 0;
for (const { name, fn } of selected) {
  const started = Date.now();
  try {
    await fn();
    console.log(`PASS  ${name}  (${Date.now() - started}ms)`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}
await browser.close();
await main.stop();
console.log(`\n${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);
