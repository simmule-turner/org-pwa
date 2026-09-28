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
  await page.click('#helpBtn');
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
  await page.click('#viewMenuBtn');
  await pick(page, '#viewMenuPanel', '**RW');
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
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Clocking');
    await pick(page, '#morePanel', 'Effort');
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
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Clocking');
  await pick(page, '#morePanel', 'Clock-in');
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
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Clocking');
  await pick(page, '#morePanel', 'Effort');
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
  await second.page.click('#moreBtn');
  await pick(second.page, '#morePanel', 'Clocking');
  await pick(second.page, '#morePanel', 'Effort');
  await second.page.waitForSelector('textarea');
  expect((await second.page.locator('[data-quick-picks]').count()) === 0, 'no Effort_ALL means the prompt stays plain free text');
  await second.context.close();

  // the global setting, here as a file's own Local Variables line
  const third = await freshPage();
  await newDocument(third.page, '* Global list\n\n# Local Variables:\n# org-global-properties: Effort_ALL: 0:15 0:45 3:00\n# End:\n');
  await third.page.locator('.heading-title').first().click();
  await third.page.click('#moreBtn');
  await pick(third.page, '#morePanel', 'Clocking');
  await pick(third.page, '#morePanel', 'Effort');
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
  await page.click('#viewMenuBtn');
  await pick(page, '#viewMenuPanel', '%%RO');
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
