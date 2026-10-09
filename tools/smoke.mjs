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
  // Which folders exist, for a folder-aware PROPFIND (a calendar is a folder). null means any folder does.
  let collections = null;
  const requests = []; // every request the server saw, as "METHOD name", so a check can prove something stopped asking
  const auths = []; // and the Authorization header each carried, as { request, authorization }
  const etag = (text) => '"' + crypto.createHash('md5').update(text).digest('hex') + '"';
  return {
    files,
    requests,
    auths,
    setCollections: (names) => { collections = names ? new Set(names) : null; },
    set: (name, text) => files.set(name, text),
    get: (name) => files.get(name),
    reset(initial = {}) {
      collections = null;
      requests.length = 0;
      auths.length = 0;
      files.clear();
      for (const [name, text] of Object.entries(initial)) files.set(name, text);
    },
    handle(req, res, name, body) {
      requests.push(`${req.method} ${name}`);
      auths.push({ request: `${req.method} ${name}`, authorization: req.headers.authorization || '' });
      const has = files.has(name);
      if (req.method === 'PROPFIND' && name !== '') {
        // a folder other than the root: list just what is directly inside it, with real (unencoded) slashes in the path
        const prefix = name.endsWith('/') ? name : name + '/';
        if (collections && !collections.has(prefix)) {
          res.writeHead(404);
          return res.end();
        }
        const children = [...files.keys()].filter((n) => n.startsWith(prefix) && !n.slice(prefix.length).includes('/'));
        const items = [
          `<d:response><d:href>/dav/${prefix}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`,
          ...children.map((n) => `<d:response><d:href>/dav/${prefix}${encodeURIComponent(n.slice(prefix.length))}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>`),
        ];
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`);
      }
      if (req.method === 'DELETE') {
        if (!has) {
          res.writeHead(404);
          return res.end();
        }
        files.delete(name);
        res.writeHead(204);
        return res.end();
      }
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

async function freshPage(server = main, { withDav = false, serviceWorkers = 'block', initScript = null } = {}) {
  // The service worker is blocked except where it is the thing under test:
  // its activation can reload the page mid-check and make the rest flaky.
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (initScript) await context.addInitScript(initScript); // runs before the app's own code, on every load of every page in this context
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
    // ready for a fresh chord = in god-mode and not mid-sequence ("God-mode: C-c"); it may be showing the last command's name
    const ready = await page.locator('#minibuffer').innerText().then((t) => t.includes('God-mode') && !t.includes('God-mode: '));
    if (!ready) {
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

check('floating keyboard: [g] opens it with god-mode and the hidden input; its buttons work without stealing focus; Shift is one-shot; it drags; [g] again ends everything, but a dismissed device keyboard does not', async () => {
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
  expect(JSON.stringify(labels) === JSON.stringify(['\u2328', 'Tab', '\u2190', '\u2192', '\u2191', '\u2193', 'S', 'g']), `layout \u2328 T \u2190 \u2192 \u2191 \u2193 S g: ${JSON.stringify(labels)}`);

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
  await page.waitForTimeout(300);
  expect(await fk.isVisible(), 'a dismissed device keyboard must NOT hide the floating keyboard');
  expect(await godOn(), 'nor end god-mode: that is what [g] and Escape are for');
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'hidden' });
  expect(!(await godOn()), '[g] still ends it');
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

check('Extras menu: a quoted function is the palette command with that real Emacs/Org name -- it runs like the palette (acting on the tapped heading), says why when it cannot run, and names any function it does not recognize, including the two retired names', async () => {
  const { context, page, errors } = await freshPage();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); // cut copies before it deletes, and refuses to delete what it could not copy
  const names = [
    ["'org-clock-out", 'Stop'], ["'org-frobnicate", 'Mystery'], ["'org-xx-calendar", 'OldCal'], ["'org-clock-continue", 'OldResume'],
    ["'calendar", 'Cal'], ["'isearch-forward", 'Find'], ["'org-clock-in-last", 'Resume'], ["'org-cut-subtree", 'Cut'],
    ["'org-table-recalculate-buffer-tables", 'Recalc'], ["'org-org-export-as-org", 'AsOrg'],
    ["'text-mode", 'TextV'], ["'org-mode", 'OrgV'], ["'org-unarchive-subtree", 'Unarch'],
  ];
  const vars = ['# Local Variables:', `# org-xx-extra-menu: ${names.map(([n, l]) => `"${n};${l}"`).join(' ')}`, '# End:'].join('\n');
  const doc = ['* One', '* Two', '* Three', '** Table', '| 3 | |', '#+TBLFM: $2=$1*2', '', '* Old thing :ARCHIVE:', '', vars, ''].join('\n');
  await newDocument(page, doc);
  await page.locator('#extraMenuBtn').waitFor({ state: 'visible' });
  const status = async () => (await page.locator('#status').innerText()).replace(/\s+/g, ' ');
  const pick = async (label) => {
    await page.click('#extraMenuBtn');
    await page.locator('#extraMenuPanel').getByText(label, { exact: true }).click();
    await page.waitForTimeout(250);
  };
  const text = async () => {
    await viewMenu(page, 'Text');
    const t = await page.locator('#document-text-edit-input').inputValue();
    await viewMenu(page, 'Org');
    return t;
  };

  await pick('Stop'); // org-clock-out with nothing running: the palette's own reason, not a silent no-op
  expect((await status()).includes('Clock out') && (await status()).includes('no clock is running'), `an unavailable command says why: ${await status()}`);
  await pick('Mystery');
  expect((await status()) === "'org-frobnicate is not a recognized function.", `an unknown name is reported by name: ${await status()}`);
  await pick('OldCal'); // no backwards compatibility: the retired names are unknown now
  expect((await status()) === "'org-xx-calendar is not a recognized function.", `the retired calendar name: ${await status()}`);
  await pick('OldResume');
  expect((await status()) === "'org-clock-continue is not a recognized function.", `the retired resume name: ${await status()}`);

  await pick('Resume'); // org-clock-in-last: real org's name for it
  expect((await status()).includes('Nothing has been clocked yet'), `org-clock-in-last resumes the last clock (nothing yet): ${await status()}`);
  await pick('Find'); // isearch-forward is Search
  await page.locator('#search-query-input').waitFor({ state: 'visible', timeout: 4000 });
  await page.keyboard.press('Escape');
  await pick('Cal'); // calendar is the calendar overview
  await page.locator('#refilePanel').waitFor({ state: 'visible', timeout: 4000 });
  expect((await page.locator('#refilePanel').innerText()).includes('Today'), 'calendar opens the calendar overview');
  await page.keyboard.press('Escape');

  await pick('Recalc'); // org-table-recalculate-buffer-tables, now an ordinary palette command
  expect((await text()).includes('| 3 | 6 |'), `every table formula is recalculated: ${JSON.stringify((await text()).split('\n').filter((l) => l.startsWith('|')))}`);
  await pick('AsOrg'); // org-org-export-as-org
  await page.waitForTimeout(600);
  expect((await status()).includes('Exported to *Org ORG Export* in a new buffer'), `export-as-org opens its own buffer: ${await status()}`);
  expect((await page.locator('#tabBar > div').count()) === 2, 'as a second tab, leaving the original document alone');

  // back in the first tab: cut acts on the heading whose menu is open, like the palette
  await page.locator('#tabBar > div').first().click();
  await page.waitForTimeout(300);
  await page.locator('.heading-title', { hasText: 'Two' }).first().click();
  await pick('Cut');
  expect(!(await text()).includes('* Two') && (await text()).includes('* One') && (await text()).includes('* Three'), 'org-cut-subtree cuts the tapped heading and only it');
  await viewMenu(page, 'Org');
  await pick('TextV'); // the two views have the Emacs major-mode names
  expect(await page.locator('#document-text-edit-input').isVisible(), "'text-mode switches to the Text view");
  await pick('OrgV');
  expect(!(await page.locator('#document-text-edit-input').isVisible()), "'org-mode switches back to the Outline view");

  // org-unarchive-subtree: a heading that is not archived says so; a hand-tagged one is restored (here: its tag stripped, as no location was recorded)
  await page.locator('.heading-title', { hasText: 'One' }).first().click();
  await pick('Unarch');
  expect((await status()).includes('Unarchive (restore)') && (await status()).includes('archived'), `an unarchived heading explains itself: ${await status()}`);
  await page.locator('.heading-title', { hasText: 'Old thing' }).first().click();
  page.once('dialog', (d) => d.accept()); // it confirms first, naming where the heading is going back to
  await pick('Unarch');
  expect(!(await text()).includes(':ARCHIVE:') && (await text()).includes('Old thing'), "org-unarchive-subtree restores an archived heading: the tag is gone and the heading is kept");
  await viewMenu(page, 'Org');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('command palette: the real Emacs/Org names are searchable, the two former Extras-only functions are palette commands, and a read-only buffer points at Toggle read-only (not the removed View-menu item)', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, '* One\n');
  const find = async (q) => {
    await openPalette(page);
    await page.keyboard.type(q);
    const rows = await paletteRows(page);
    await page.keyboard.press('Escape');
    return rows;
  };
  const html = await find('org-html-export-to-html');
  expect(html.some((r) => r.includes('Export this file as HTML')), `the Emacs name finds the command: ${JSON.stringify(html)}`);
  expect((await find('isearch-forward')).some((r) => r.includes('Search')), 'Search is isearch-forward');
  expect((await find('describe-mode')).some((r) => r.includes('Help')), 'Help is describe-mode');
  expect((await find('org-table-recalculate-buffer-tables')).some((r) => r.includes('Recalculate all tables')), 'the former Extras-only table command is in the palette');
  expect((await find('org-org-export-as-org')).some((r) => r.includes('Export as an Org buffer')), 'and so is export-as-org');
  expect((await find('org-unarchive-subtree')).some((r) => r.includes('Unarchive (restore)')), 'Unarchive is org-unarchive-subtree');
  await openPalette(page);
  await page.keyboard.type('toggle read-only');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const rows = await find('recalculate all');
  expect(rows.some((r) => r.includes('Recalculate all tables') && r.includes('Toggle read-only') && !r.includes('View menu')), `a read-only buffer names the real way out: ${JSON.stringify(rows)}`);
  await context.close();
});

check('affiliated keywords: #+CAPTION shows as a caption, #+NAME and #+ATTR_* show as muted lines, #+ATTR_HTML sizes the image, a plain paragraph is untouched, and the saved text does not change', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 412, height: 900 });
  const doc = ['#+STARTUP: inlineimages', '* Figures', '#+NAME: fig:cat', '#+CAPTION: A *fluffy* cat', '#+ATTR_HTML: :width 300 :align center', '[[https://example.invalid/cat.png]]', '',
    '#+NAME: tbl:scores', '#+CAPTION: Scores by term', '| a | b |', '|---+---|', '| 1 | 2 |', '', 'A plain paragraph with no keywords.', ''].join('\n');
  await newDocument(page, doc);
  for (let round = 0; round < 4; round++) {
    const n = await page.evaluate(() => {
      const folds = [...document.querySelectorAll('#outline .row *')].filter((el) => el.children.length === 0 && el.textContent === '\u25b8');
      folds.forEach((el) => el.click());
      return folds.length;
    });
    if (!n) break;
    await page.waitForTimeout(250);
  }
  const caps = await page.locator('[data-affiliated="caption"]').allInnerTexts();
  expect(JSON.stringify(caps) === JSON.stringify(['A fluffy cat', 'Scores by term']), `both captions show as captions, without the #+CAPTION: prefix: ${JSON.stringify(caps)}`);
  expect((await page.locator('[data-affiliated="caption"] b').count()) === 1, 'and a caption\u2019s inline markup is rendered (*fluffy* is bold)');
  const metas = (await page.locator('[data-affiliated="meta"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(JSON.stringify(metas) === JSON.stringify(['#+NAME: fig:cat #+ATTR_HTML: :width 300 :align center', '#+NAME: tbl:scores']), `the other keyword lines stay visible, muted: ${JSON.stringify(metas)}`);
  const img = await page.locator('#outline img').first().evaluate((el) => ({ width: el.style.width, left: el.style.marginLeft, right: el.style.marginRight }));
  expect(img.width === '300px' && img.left === 'auto' && img.right === 'auto', `#+ATTR_HTML :width 300 :align center sizes and centers the image: ${JSON.stringify(img)}`);
  const outlineText = await page.locator('#outline').innerText();
  expect(!outlineText.includes('#+CAPTION'), 'no raw #+CAPTION: line is shown as text');
  const plainUntouched = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#outline div')].filter((d) => d.style.whiteSpace === 'pre-wrap' && d.innerText.trim() === 'A plain paragraph with no keywords.');
    return els.length === 1 && els[0].querySelector('[data-affiliated]') === null;
  });
  expect(plainUntouched, 'a paragraph with no keywords has no decoration');
  await viewMenu(page, 'Text');
  const text = await page.locator('#document-text-edit-input').inputValue();
  expect(text.includes('#+CAPTION: A *fluffy* cat\n#+ATTR_HTML: :width 300 :align center\n[[https://example.invalid/cat.png]]') && text.includes('#+NAME: tbl:scores\n#+CAPTION: Scores by term\n| a | b |'), 'the saved text still has every keyword line exactly as written');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('local file: switching tabs and regaining focus never ask the browser for permission (only Save, which the person starts, does), yet a granted file is still checked for outside changes', async () => {
  const { context, page, errors } = await freshPage();
  // A real file handle from the browser's private file system stands in for a file picked from the device,
  // and the permission calls are replaced by ones that report whatever state the check sets and count how often they are made.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('perm-test.org', { create: true });
    const w = await fh.createWritable();
    await w.write('* One\n');
    await w.close();
    window.__perm = { query: 0, request: 0, state: 'granted' };
    window.showOpenFilePicker = async () => [fh];
    FileSystemHandle.prototype.queryPermission = async function () { window.__perm.query += 1; return window.__perm.state; };
    FileSystemHandle.prototype.requestPermission = async function () { window.__perm.request += 1; window.__perm.state = 'granted'; return 'granted'; };
  });
  const perm = () => page.evaluate(() => ({ ...window.__perm }));
  const setPerm = (state) => page.evaluate((st) => { window.__perm = { query: 0, request: 0, state: st }; }, state);
  const status = async () => (await page.locator('#status').innerText()).replace(/\s+/g, ' ');
  const tab = (n) => page.locator('#tabBar > div').nth(n);

  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('status').innerText.includes('Opened'), null, { timeout: 8000 });
  await fileMenu(page, 'New'); // a second tab, so there is something to switch away from and back to
  await page.waitForFunction(() => document.querySelectorAll('#tabBar > div').length === 2);

  // 1. the browser has NOT granted access (it reports "prompt"): switching to the local file's tab must not ask
  await setPerm('prompt');
  await tab(0).click();
  await page.waitForTimeout(900);
  let p = await perm();
  expect(p.query >= 1, `the check should still have looked at the permission (else this proves nothing): ${JSON.stringify(p)}`);
  expect(p.request === 0, `switching tabs must not request permission, which is what shows the prompt: ${JSON.stringify(p)}`);

  // 2. nor does the app regaining focus, or returning to the page
  await setPerm('prompt');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(900);
  p = await perm();
  expect(p.request === 0, `focus and visibility changes must not request permission: ${JSON.stringify(p)}`);

  // 3. something the person starts still asks: an edit, then Save, with access not yet granted
  await setDocumentText(page, '* One\n* Two\n');
  await setPerm('prompt');
  await page.click('#saveBtn');
  await page.waitForFunction(() => document.getElementById('status').innerText.includes('Saved'), null, { timeout: 8000 });
  p = await perm();
  expect(p.request >= 1, `Save is user-initiated, so it may still ask: ${JSON.stringify(p)}`);

  // 4. when access IS granted the background check still works: a change made outside the app raises the banner
  await setPerm('granted');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('perm-test.org');
    const w = await fh.createWritable();
    await w.write('* One\n* Two\n* Added elsewhere\n');
    await w.close();
  });
  await tab(1).click();
  await page.waitForTimeout(400);
  await tab(0).click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('externalChangeBanner')).display !== 'none', null, { timeout: 6000 });
  expect((await page.locator('#externalChangeBanner').innerText()).includes('changed elsewhere'), 'a granted file is still checked, and the banner says it changed');
  p = await perm();
  expect(p.request === 0, `and it still asked for nothing: ${JSON.stringify(p)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
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
  expect(moved.y + moved.height <= g.y, 'dragged down as far as it goes it still stops above the floating buttons, never over [g]');
  // the device keyboard: the app learns of it only through visualViewport, and lifts its mode line by the
  // covered height -- the panel must ride up with it instead of staying underneath (the reported bug)
  const setKeyboard = (px) => page.evaluate((h) => {
    const vv = window.visualViewport;
    if (h) Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
    else delete vv.height;
    vv.dispatchEvent(new Event('resize'));
  }, px);
  await setKeyboard(300);
  await page.waitForTimeout(900); // long enough for the panel to settle and keep its push, as a person's own pace is
  const lifted = await page.locator('#modelineBar').boundingBox();
  expect(lifted.y < (await page.viewportSize()).height - 250, `the app should have lifted its mode line above the emulated keyboard: ${lifted.y}`);
  await clear('with a 300px device keyboard up');
  const withKeyboard = await fk.boundingBox();
  await setKeyboard(0);
  await page.waitForTimeout(900);
  await clear('after the device keyboard went away');
  expect(Math.abs(withKeyboard.y - (await fk.boundingBox()).y) < 2, 'the panel must STAY where the keyboard pushed it, not drop back down when the keyboard goes');
  await page.setViewportSize({ width: 400, height: 420 });
  await page.waitForTimeout(300);
  await clear('after the viewport shrank');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(300);
  await clear('after it grew back');
  expect(Math.abs(moved.y - start.y) < 2, 'its default spot is already the lowest it may go, so dragging down changes nothing');
  await context.close();
});

// the device keyboard, as the app itself learns of it: through visualViewport, which it lifts its mode line by
const emulateDeviceKeyboard = (page, px) => page.evaluate((h) => {
  const vv = window.visualViewport;
  if (h) Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
  else delete vv.height;
  vv.dispatchEvent(new Event('resize'));
}, px);

check('floating keyboard: its keyboard key hides and shows the device keyboard without ending god-mode; the device keyboard going away any other way changes nothing but that key', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 360, height: 740 });
  await newDocument(page, '* One\n');
  const fk = page.locator('#floatingKeyboard');
  const key = fk.locator('[data-fk-keyboard]');
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const stillOn = async () => (await fk.isVisible()) && (await page.locator('#minibuffer').innerText()).includes('God-mode');
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  expect((await key.count()) === 1 && (await key.innerText()) === '\u2328', 'the panel has one keyboard key, first after the move area');
  expect((await fk.locator('button').first().getAttribute('data-fk-keyboard')) !== null, 'and it comes before Tab');

  await emulateDeviceKeyboard(page, 300);
  await page.waitForTimeout(400);
  expect((await key.getAttribute('aria-pressed')) === 'true', 'lit while the device keyboard is up');

  await key.click(); // hide
  expect((await activeId()) !== 'godModeKeyboardInput', 'tapping it hides the device keyboard (the field lets go of focus)');
  expect(await stillOn(), 'and god-mode and the panel stay exactly as they were');
  expect((await key.getAttribute('aria-pressed')) === 'false', 'the key goes dark');
  await emulateDeviceKeyboard(page, 0); // the OS lowers it
  await page.waitForTimeout(400);

  await emulateDeviceKeyboard(page, 300);
  await key.click(); // show again
  expect((await activeId()) === 'godModeKeyboardInput', 'tapping it again gives the field focus, which is what brings the keyboard back');
  await page.waitForTimeout(400);
  expect((await key.getAttribute('aria-pressed')) === 'true', 'lit again');

  // the device keyboard hidden some other way (its own dismiss control, a popup taking focus): nothing ends
  await page.evaluate(() => document.getElementById('godModeKeyboardInput').blur());
  await emulateDeviceKeyboard(page, 0);
  await page.waitForTimeout(400);
  expect(await stillOn(), 'the device keyboard going away by itself must not end god-mode or hide the panel');
  expect((await key.getAttribute('aria-pressed')) === 'false', 'only the key changes');

  // Android's back gesture hides the keyboard but can leave the field focused: the key reads unlit, and a tap still brings it back
  await page.evaluate(() => document.getElementById('godModeKeyboardInput').focus());
  await page.waitForTimeout(200);
  expect((await key.getAttribute('aria-pressed')) === 'false', 'focused but no keyboard on screen must not read as showing');
  await key.click();
  expect((await activeId()) === 'godModeKeyboardInput', 'a tap still leaves the field focused, having blurred and refocused it to bring the keyboard back');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: pushed up by the device keyboard it STAYS up when the keyboard goes away (no drop lower); only a drag lowers it', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 360, height: 740 });
  await newDocument(page, '* One\n');
  const fk = page.locator('#floatingKeyboard');
  const y = async () => Math.round((await fk.boundingBox()).y);
  const settle = () => page.waitForTimeout(900);
  const aboveModeLine = async (what) => {
    const ml = await page.locator('#modelineBar').boundingBox();
    const b = await fk.boundingBox();
    expect(b.y + b.height <= ml.y + 0.5, `${what}: panel bottom ${b.y + b.height} must be above the mode line top ${ml.y}`);
  };
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  await settle();
  const resting = await y();

  await emulateDeviceKeyboard(page, 300);
  await settle();
  const up = await y();
  expect(up < resting - 150, `the device keyboard pushes it up: ${resting} -> ${up}`);
  await aboveModeLine('keyboard up');

  await emulateDeviceKeyboard(page, 0); // hiding the phone keyboard: the reported bug was the panel dropping lower right here
  await settle();
  expect(Math.abs((await y()) - up) < 2, `it stays where it was pushed instead of dropping: ${up} -> ${await y()}`);
  await aboveModeLine('keyboard gone');

  await emulateDeviceKeyboard(page, 300); // and back up: it is already clear, so it does not move
  await settle();
  expect(Math.abs((await y()) - up) < 2, `and does not move when the keyboard returns: ${up} -> ${await y()}`);
  await emulateDeviceKeyboard(page, 0);
  await settle();

  // only a drag lowers it
  const handle = await fk.locator('[data-fk-handle]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 400, { steps: 8 });
  await page.mouse.up();
  const dragged = await y();
  expect(dragged > up + 100, `a drag does lower it: ${up} -> ${dragged}`);
  await aboveModeLine('after dragging down');
  await emulateDeviceKeyboard(page, 300); // a panel dragged low is covered by the keyboard, so it is pushed up again ...
  await settle();
  const pushed = await y();
  expect(pushed < dragged - 100, `covered, so pushed up: ${dragged} -> ${pushed}`);
  await aboveModeLine('pushed again');
  await emulateDeviceKeyboard(page, 0); // ... and stays up when it leaves
  await settle();
  expect(Math.abs((await y()) - pushed) < 2, `still no drop: ${pushed} -> ${await y()}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: where the person drags it is remembered across a reload, but a push by the device keyboard is not', async () => {
  const dragTop = async (page) => { // drag the panel up by 220px and report its top edge before and after
    const fk = page.locator('#floatingKeyboard');
    const before = Math.round((await fk.boundingBox()).y);
    const handle = await fk.locator('[data-fk-handle]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 220, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    return [before, Math.round((await fk.boundingBox()).y)];
  };
  const reopen = async (page) => {
    await page.reload();
    await page.locator('#moreBtn').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await newDocument(page, '* One\n');
    await page.click('#godModeBtn');
    await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    return Math.round((await page.locator('#floatingKeyboard').boundingBox()).y);
  };

  // 1. a drag is remembered
  {
    const { context, page, errors } = await freshPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await newDocument(page, '* One\n');
    await page.click('#godModeBtn');
    await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const [before, after] = await dragTop(page);
    expect(after < before - 150, `the drag should move the panel up: ${before} -> ${after}`);
    const restored = await reopen(page);
    expect(Math.abs(restored - after) <= 3, `after a reload the panel opens where it was dragged to: dragged to ${after}, reopened at ${restored}`);
    expect(restored < before - 150, `and not at its default spot (${before}): ${restored}`);
    expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // 2. being pushed up by the device keyboard is not
  {
    const { context, page } = await freshPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await newDocument(page, '* One\n');
    await page.click('#godModeBtn');
    await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const resting = Math.round((await page.locator('#floatingKeyboard').boundingBox()).y);
    await emulateDeviceKeyboard(page, 300);
    await page.waitForTimeout(900);
    const pushed = Math.round((await page.locator('#floatingKeyboard').boundingBox()).y);
    expect(pushed < resting - 150, `the keyboard pushes it up: ${resting} -> ${pushed}`);
    const reopened = await reopen(page);
    expect(Math.abs(reopened - resting) <= 3, `a one-off push is not kept: it should reopen at its default (${resting}), not ${reopened}`);
    await context.close();
  }
});

check('floating keyboard: a thick accent-coloured border identifies it, and it fits a 360px screen with every key at least 34px wide and 44px tall', async () => {
  const { context, page } = await freshPage();
  await page.setViewportSize({ width: 360, height: 740 });
  await newDocument(page, '* One\n');
  const fk = page.locator('#floatingKeyboard');
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  const look = await fk.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { width: cs.borderTopWidth, style: cs.borderTopStyle, color: cs.borderTopColor, accent, scroll: el.scrollWidth, client: el.clientWidth, glow: cs.boxShadow };
  });
  expect(look.width === '3px' && look.style === 'solid', `a 3px solid border: ${look.width} ${look.style}`);
  expect(look.color === look.accent, `in the theme's accent colour: ${look.color} vs ${look.accent}`);
  expect(look.glow.includes(look.accent), `with a faint glow of it: ${look.glow}`);
  const box = await fk.boundingBox();
  expect(box.x >= 0 && box.x + box.width <= 360, `inside a 360px screen: x=${box.x} width=${box.width}`);
  expect(look.scroll <= look.client + 1, `nothing overflows the panel: ${look.scroll} > ${look.client}`);
  const keys = await fk.locator('button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  expect(keys.length === 8 && keys.every(([w, h]) => w >= 34 && h >= 44), `every key at least 34 wide and 44 tall: ${JSON.stringify(keys)}`);
  await page.locator('[data-fk-handle]').click(); // minimized keeps the border, so it is still findable
  expect((await fk.evaluate((el) => getComputedStyle(el).borderTopWidth)) === '3px', 'the minimized handle keeps the border');
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
  expect((await fk.locator('button').count()) === 8, 'a drag should not minimize it');

  await handle.click();
  expect((await fk.locator('button').count()) === 0, 'a tap on the move area should hide every key');
  expect((await fk.getAttribute('role')) === 'toolbar' && (await handle.isVisible()), 'the handle stays, so it can be restored');
  const small = await fk.boundingBox();
  expect(small.width < full.width / 2, `minimized should be far narrower: ${full.width} -> ${small.width}`);
  expect((await page.locator('#minibuffer').innerText()).includes('God-mode'), 'minimizing must not end god-mode');
  expect((await activeId()) === 'godModeKeyboardInput', 'or dismiss the device keyboard');

  await handle.click();
  expect((await fk.locator('button').count()) === 8, 'tapping the minimized handle restores every key');
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

check('god-mode: once a chord completes the minibuffer names the palette command that ran (just the chord when it has none), and the next keystroke clears it', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* One\n');
  const mini = async () => (await page.locator('#minibuffer').innerText()).replace(/\s+/g, ' ');
  await page.locator('body').click({ position: { x: 200, y: 800 } });
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  expect((await mini()).includes('Esc to exit'), `ready prompt before anything runs: ${await mini()}`);

  for (const k of ['c', 'x', 'o']) await page.keyboard.press(k); // C-c C-x C-o: Clock out
  expect((await mini()).includes('C-c C-x C-o') && (await mini()).includes('Clock out'), `a completed chord should name the palette command: ${await mini()}`);
  expect(!(await mini()).includes('God-mode: '), `and not look like a sequence still being built: ${await mini()}`);

  await page.keyboard.press('c'); // starting the next sequence replaces it
  expect((await mini()).includes('God-mode: C-c') && !(await mini()).includes('Clock out'), `the next keystroke should clear the name: ${await mini()}`);
  await page.keyboard.press('Escape'); // cancel that sequence

  await page.keyboard.press('f'); // C-f arms redo: a chord with no palette command shows just the chord
  expect((await mini()).includes('C-f') && !(await mini()).includes('\u2192'), `a chord with no palette command is shown bare: ${await mini()}`);
  await page.keyboard.press('z'); // C-z is bound to nothing: back to the ready prompt, not the previous command as if it had just run
  expect((await mini()).includes('Esc to exit') && !(await mini()).includes('C-f'), `a key that runs nothing must not leave the last command showing: ${await mini()}`);

  // the floating keyboard feeds the same dispatch, so it is named the same way
  await page.click('#godModeBtn'); // god-mode is already on from the Escape, so this just brings up the floating keyboard
  await page.locator('#floatingKeyboard').waitFor({ state: 'visible' });
  for (const k of ['c', 'x', 'x']) await page.keyboard.press(k); // typed on the device keyboard: C-c C-x C-x
  expect((await mini()).includes('Continue last clock'), `the device keyboard path names it too: ${await mini()}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('paragraph spacing: two values like font size -- one for paragraphs, one for Tables and the other secondary blocks; 10px by default (paragraphs were 4px apart), independent, 0 to 32px, immediate, remembered across a reload, list items untouched', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 412, height: 900 });
  const doc = ['* H', 'First paragraph.', '', 'Second paragraph.', '', '| a | b |', '|---+---|', '| 1 | 2 |', '', '#+BEGIN_SRC js', 'x = 1', '#+END_SRC', '', 'Last paragraph.', '', '- item one', '- item two', ''].join('\n');
  const expandAll = async () => {
    for (let round = 0; round < 4; round++) {
      const n = await page.evaluate(() => {
        const folds = [...document.querySelectorAll('#outline .row *')].filter((el) => el.children.length === 0 && el.textContent === '\u25b8');
        folds.forEach((el) => el.click());
        return folds.length;
      });
      if (!n) break;
      await page.waitForTimeout(250);
    }
  };
  // gaps, top to bottom, between consecutive body blocks: paragraph->paragraph, paragraph->table, table->block, block->paragraph
  const gaps = () => page.evaluate(() => {
    const isPara = (el) => !el.classList.contains('row') && [...el.children].some((c) => c.style && c.style.whiteSpace === 'pre-wrap' && c.style.cursor === 'text');
    const first = [...document.querySelectorAll('#outline div')].find((el) => isPara(el) && el.innerText.startsWith('First paragraph'));
    const out = [];
    let el = first;
    while (el && el.nextElementSibling && out.length < 4) {
      const next = el.nextElementSibling;
      if (next.classList.contains('row')) break;
      out.push(Math.round((next.getBoundingClientRect().top - el.getBoundingClientRect().bottom) * 10) / 10);
      el = next;
    }
    const one = [...document.querySelectorAll('#outline .row')].find((r) => r.innerText.includes('item one'));
    const two = [...document.querySelectorAll('#outline .row')].find((r) => r.innerText.includes('item two'));
    const rowGap = one && two ? Math.round((two.getBoundingClientRect().top - one.getBoundingClientRect().bottom) * 10) / 10 : null;
    return { out, rowGap };
  });
  const vars = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return [cs.getPropertyValue('--paragraph-gap').trim(), cs.getPropertyValue('--paragraph-gap-tables').trim()]; });
  const near = (actual, expected) => actual.length === expected.length && actual.every((v, n) => Math.abs(v - expected[n]) < 0.6);
  const showDoc = async () => { await viewMenu(page, 'Org'); await expandAll(); };
  const openSettings = async () => {
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Settings');
    await page.locator('#paragraph-spacing-value').waitFor({ state: 'visible' });
  };
  const label = (id) => page.locator('#' + id).innerText();
  const step = async (aria, id, expected) => {
    await page.getByRole('button', { name: aria }).click();
    await page.waitForFunction(([i, t]) => document.getElementById(i) && document.getElementById(i).innerText === t, [id, expected], { timeout: 4000 });
  };
  const pressPastLimit = async (aria, id, expected) => { // one more press at a limit changes nothing
    await page.getByRole('button', { name: aria }).click();
    await page.waitForTimeout(400);
    expect((await label(id)) === expected, `${aria} at the limit should stay ${expected}: ${await label(id)}`);
  };
  const seed = async (paragraphs, tables) => { // write the saved values straight into storage, then reload: tests that startup applies them
    await page.evaluate(([p, t]) => new Promise((resolve, reject) => {
      const req = indexedDB.open('org-pwa');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(JSON.stringify(p), 'settings:paragraphSpacing');
        tx.objectStore('kv').put(JSON.stringify(t), 'settings:tablesSpacing');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }), [paragraphs, tables]);
    await page.reload();
    await page.locator('#moreBtn').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
  };

  await newDocument(page, doc);
  await expandAll();
  let g = await gaps();
  expect(near(g.out, [10, 10, 10, 10]), `every gap is 10px by default (paragraphs used to be 4px apart): ${JSON.stringify(g)}`);
  const listGap = g.rowGap;
  expect(typeof listGap === 'number', `the two list items should be found, else the untouched check proves nothing: ${listGap}`);

  // -- stepping in Settings: laid out like Font Size, two independent values
  await openSettings();
  expect((await label('paragraph-spacing-value')) === '10px' && (await label('tables-spacing-value')) === '10px', 'both show the 10px default');
  expect((await page.locator('#tables-spacing-value').locator('xpath=preceding-sibling::span[contains(., "Tables:")]').count()) === 1, 'the second value is labelled Tables:, as in Font Size');
  await step('More paragraph spacing', 'paragraph-spacing-value', '11px');
  await step('More paragraph spacing', 'paragraph-spacing-value', '12px');
  expect(JSON.stringify(await vars()) === '["12px","10px"]', `paragraphs changed, Tables did not, at once: ${JSON.stringify(await vars())}`);
  await showDoc();
  g = await gaps();
  expect(near(g.out, [12, 12, 10, 12]), `paragraph-to-paragraph follows the paragraph value; where a paragraph meets a table or block the larger of the two wins: ${JSON.stringify(g)}`);
  await openSettings();
  for (let v = 11; v <= 20; v++) await step('More table spacing', 'tables-spacing-value', v + 'px');
  expect(JSON.stringify(await vars()) === '["12px","20px"]', `now Tables changed and paragraphs did not: ${JSON.stringify(await vars())}`);
  await showDoc();
  g = await gaps();
  expect(near(g.out, [12, 20, 20, 20]), `tables and blocks follow the Tables value: ${JSON.stringify(g)}`);

  // -- the limits, from the saved values (31/1 and 1/31), which also shows startup applies what was saved
  await seed(31, 1);
  expect(JSON.stringify(await vars()) === '["31px","1px"]', `saved values applied at startup: ${JSON.stringify(await vars())}`);
  await openSettings();
  expect((await label('paragraph-spacing-value')) === '31px' && (await label('tables-spacing-value')) === '1px', 'and shown in Settings');
  await step('More paragraph spacing', 'paragraph-spacing-value', '32px');
  await pressPastLimit('More paragraph spacing', 'paragraph-spacing-value', '32px');
  await step('Less table spacing', 'tables-spacing-value', '0px');
  await pressPastLimit('Less table spacing', 'tables-spacing-value', '0px');
  await newDocument(page, doc);
  await expandAll();
  g = await gaps();
  expect(near(g.out, [32, 32, 0, 32]), `paragraphs at 32 and Tables at 0, independently: ${JSON.stringify(g)}`);
  expect(g.rowGap === listGap, `list items are untouched by either value: ${listGap} -> ${g.rowGap}`);

  await seed(1, 31);
  await openSettings();
  await step('Less paragraph spacing', 'paragraph-spacing-value', '0px');
  await pressPastLimit('Less paragraph spacing', 'paragraph-spacing-value', '0px');
  await step('More table spacing', 'tables-spacing-value', '32px');
  await pressPastLimit('More table spacing', 'tables-spacing-value', '32px');
  await newDocument(page, doc);
  await expandAll();
  g = await gaps();
  expect(near(g.out, [0, 32, 32, 32]), `0 packs paragraphs together (for anyone who likes dense text) while Tables stays at 32: ${JSON.stringify(g)}`);

  // a quote block has both roles: the block itself is a secondary item (Tables), the prose inside it is paragraphs
  await seed(0, 25);
  await newDocument(page, ['* Q', 'Intro.', '', '#+BEGIN_QUOTE', 'Quote one.', '', 'Quote two.', '#+END_QUOTE', '', 'Outro.', ''].join('\n'));
  await expandAll();
  const q = await page.evaluate(() => {
    const isPara = (el) => !el.classList.contains('row') && [...el.children].some((c) => c.style && c.style.whiteSpace === 'pre-wrap' && c.style.cursor === 'text');
    const intro = [...document.querySelectorAll('#outline div')].find((el) => isPara(el) && el.innerText.startsWith('Intro.'));
    const block = intro && intro.nextElementSibling;
    const ps = block ? [...block.querySelectorAll('p')] : [];
    const outro = block && block.nextElementSibling;
    const r = (el) => el.getBoundingClientRect();
    return { paragraphsInside: ps.length, inner: ps.length > 1 ? Math.round((r(ps[1]).top - r(ps[0]).bottom) * 10) / 10 : null, before: block ? Math.round((r(block).top - r(intro).bottom) * 10) / 10 : null, after: outro ? Math.round((r(outro).top - r(block).bottom) * 10) / 10 : null };
  });
  expect(q.paragraphsInside === 2, `the quote should hold two paragraphs: ${JSON.stringify(q)}`);
  expect(Math.abs(q.inner - 0) < 0.6, `the paragraphs INSIDE the quote follow the paragraph value (0): ${JSON.stringify(q)}`);
  expect(Math.abs(q.before - 25) < 0.6 && Math.abs(q.after - 25) < 0.6, `the quote block itself follows the Tables value (25): ${JSON.stringify(q)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: a and e say what they did (and clear the last command\u2019s name); i opens the editor at the focused row, with the cursor where a or e chose', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Write report\n');
  await page.locator('.heading-title').first().click();
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) {
    await page.keyboard.press('Escape');
  }
  const mini = async () => (await page.locator('#minibuffer').innerText()).replace(/\s+/g, ' ');
  const cursor = () => page.evaluate(() => { const t = document.querySelector('#heading-title-edit-popup textarea'); return t ? [t.selectionStart, t.value.length] : null; });

  await page.keyboard.press('f'); // a completed chord leaves its name showing ...
  expect((await mini()).includes('C-f'), `C-f is showing: ${await mini()}`);
  await page.keyboard.press('a'); // ... which a must replace, not leave behind
  expect((await mini()).includes('C-a') && (await mini()).includes('start') && !(await mini()).includes('C-f'), `a should report itself and clear the previous name: ${await mini()}`);
  await page.keyboard.press('e');
  expect((await mini()).includes('C-e') && (await mini()).includes('end'), `e should report itself: ${await mini()}`);

  await page.keyboard.press('a');
  await page.keyboard.press('i');
  await page.waitForSelector('#heading-title-edit-popup', { timeout: 4000 });
  const atStart = await cursor();
  expect(atStart[0] === 0, `a then i puts the cursor at the start: ${JSON.stringify(atStart)}`);
  await page.keyboard.press('Escape'); // closes the editor
  await page.locator('#heading-title-edit-popup').waitFor({ state: 'detached' });

  // god-mode is still on after the editor closed, so do not press Escape (that would EXIT it)
  expect((await mini()).includes('God-mode'), `god-mode should still be on: ${await mini()}`);
  await page.keyboard.press('e');
  await page.keyboard.press('i');
  await page.waitForSelector('#heading-title-edit-popup', { timeout: 4000 });
  const atEnd = await cursor();
  expect(atEnd[0] === atEnd[1] && atEnd[1] > 0, `e then i puts the cursor at the end: ${JSON.stringify(atEnd)}`);
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
    // ready for a fresh chord = in god-mode and not mid-sequence ("God-mode: C-c"); it may be showing the last command's name
    const ready = await page.locator('#minibuffer').innerText().then((t) => t.includes('God-mode') && !t.includes('God-mode: '));
    if (!ready) {
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
  const attachText = await page.locator('body').innerText();
  expect(attachText.includes('Attach \u2014') && attachText.includes('Export copy') && attachText.includes('Delete all'), 'C-c C-a should open the attachment dispatcher');
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

check('capture from outside: a share URL runs the named template with the shared text and link, the URL is cleaned so a reload does not repeat it, a share with no key offers the templates, and an unknown key says so', async () => {
  dav.reset({ 'notes.org': SAMPLE, 'inbox.org': '* Inbox\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  const templates = [
    { key: 'n', description: 'Shared note', type: 'plain', file: 'inbox.org', olp: ['Inbox'], template: '* Note\n  %i\n  %a', emptyLines: 0 },
  ];
  await page.evaluate((json) => new Promise((resolve, reject) => {
    const open = indexedDB.open('org-pwa');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(json, 'settings:captureTemplates');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), JSON.stringify(templates));
  // Capture to another file needs a document open on the same backend; the app restores the tab that was open when a launch URL starts it.
  await openDav(page, 'notes.org');
  const waitForFile = async (needle) => {
    for (let n = 0; n < 40 && !dav.get('inbox.org').includes(needle); n++) await page.waitForTimeout(250);
    return dav.get('inbox.org');
  };

  // 1. the share target's URL: key, title, text and url
  const share = '?capture=n&title=Example%20page&text=First%20line%0A*%20starred&url=https%3A%2F%2Fexample.com%2Fa';
  await page.goto(`${main.base}/index.html${share}`, { waitUntil: 'load' });
  const file = await waitForFile('** Note');
  const logs = [];
  page.on('console', (m) => logs.push(m.text().slice(0, 140)));
  const said = async () => `tabs: ${JSON.stringify((await page.locator('#tabBar').innerText()).slice(0, 80))} | modeline: ${JSON.stringify((await page.locator('#modelineBar').innerText()).replace(/\\s+/g, ' ').slice(0, 160))} | url: ${page.url().slice(-60)} | console: ${JSON.stringify(logs.slice(-4))} | minibuffer: ${JSON.stringify((await page.locator('#minibuffer').innerText()).slice(0, 200))} | panel: ${JSON.stringify((await page.locator('#capturePanel').innerText().catch(() => '')).slice(0, 200))}`;
  expect(file.includes('** Note\n  First line\n  * starred\n  [[https://example.com/a][Example page]]'), `the template ran with %i and %a: ${JSON.stringify(file)} -- ${await said()}`);
  expect((await page.evaluate(() => window.location.search)) === '', 'the parameters were removed from the address');

  // 2. a reload does not capture a second time
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  expect((dav.get('inbox.org').match(/\*\* Note/g) || []).length === 1, `a reload must not repeat the capture: ${JSON.stringify(dav.get('inbox.org'))}`);

  // 3. a share with no key shows the template list, with the shared text kept for whichever is chosen
  await page.goto(`${main.base}/index.html?title=T&text=chosen%20later`, { waitUntil: 'load' });
  await page.waitForSelector('#capturePanel', { state: 'visible', timeout: 6000 });
  expect((await page.locator('#capturePanel').innerText()).includes('Shared note'), 'the template list is showing');
  await page.locator('#capturePanel button', { hasText: 'Shared note' }).first().click();
  const second = await waitForFile('chosen later');
  expect(second.includes('  chosen later'), `the shared text went into the template that was picked: ${JSON.stringify(second)}`);

  // 4. an unknown key says so and still offers the list
  await page.goto(`${main.base}/index.html?capture=zzz&text=x`, { waitUntil: 'load' });
  await page.waitForSelector('#capturePanel', { state: 'visible', timeout: 6000 });
  const panel = await page.locator('#capturePanel').innerText();
  expect(panel.includes('Shared note'), 'an unknown key falls back to the list');
  expect((await page.locator('#minibuffer').innerText()).includes('No capture template "zzz"'), 'and says why');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('capture from outside: %x takes the clipboard (read only for a template that uses it), and a refused clipboard leaves %x empty but still captures, saying why', async () => {
  const seed = (page, templates) => page.evaluate((json) => new Promise((resolve, reject) => {
    const open = indexedDB.open('org-pwa');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(json, 'settings:captureTemplates');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), JSON.stringify(templates));
  const templates = [
    { key: 'x', description: 'Clip', type: 'plain', olp: ['Inbox'], template: '* Clip\n  %x', emptyLines: 0 },
    { key: 'p', description: 'Plain', type: 'plain', olp: ['Inbox'], template: '* Plain', emptyLines: 0 },
  ];
  const at = (step) => (e) => { e.message = `[${step}] ${e.message}`; throw e; };
  const runTemplate = async (page, name) => {
    await openPalette(page).catch(at('openPalette'));
    await page.keyboard.type('capture: ' + name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    // the capture panel stays open after a capture (as it always has); close it so the next click is not covered
    if (await page.locator('#capturePanel').isVisible()) await page.locator('#capturePanel button', { hasText: 'Close' }).first().click();
  };
  const documentText = async (page) => {
    await viewMenu(page, 'Text').catch(at('viewMenu Text'));
    const text = await page.locator('#document-text-edit-input').inputValue();
    await viewMenu(page, 'Org').catch(at('viewMenu Org'));
    return text;
  };

  // 1. permission granted: %x is the clipboard, and a template without %x never reads it
  {
    const { context, page, errors } = await freshPage();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await newDocument(page, '* Inbox\n');
    await seed(page, templates);
    await page.evaluate(async () => {
      window.__clipboardReads = 0;
      const real = navigator.clipboard.readText.bind(navigator.clipboard);
      navigator.clipboard.readText = async () => { window.__clipboardReads += 1; return real(); };
      await navigator.clipboard.writeText('from the clipboard\n* not a heading');
    });
    await runTemplate(page, 'plain');
    expect((await page.evaluate(() => window.__clipboardReads)) === 0, 'a template without %x never reads the clipboard');
    await runTemplate(page, 'clip');
    expect((await page.evaluate(() => window.__clipboardReads)) === 1, 'a template with %x reads it once');
    const text = await documentText(page);
    expect(text.includes('** Clip\n  from the clipboard\n  * not a heading'), `%x was filled from the clipboard: ${JSON.stringify(text)}`);
    expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  // 2. permission refused: %x is empty, the capture still happens, and the person is told
  {
    const { context, page } = await freshPage();
    await newDocument(page, '* Inbox\n');
    await seed(page, templates);
    await page.evaluate(() => { navigator.clipboard.readText = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
    await runTemplate(page, 'clip');
    const text = await documentText(page);
    expect(text.includes('** Clip'), `the capture still went ahead: ${JSON.stringify(text)}`);
    expect(!text.includes('from the clipboard'), 'with %x empty');
    await context.close();
  }
});

check('capture from outside, offline: a launch URL with a query string (share sheet or icon shortcut) loads from the cache with the server gone', async () => {
  const dead = await startServer(createDav());
  const { context, page } = await freshPage(dead, { serviceWorkers: 'allow' });
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
  await page.reload({ waitUntil: 'load' }); // so the page is controlled by the worker
  await dead.stop();
  await page.goto(`${dead.base}/index.html?capture`, { waitUntil: 'load' });
  await page.waitForSelector('#capturePanel', { state: 'visible', timeout: 8000 });
  expect((await page.locator('#capturePanel').innerText()).includes('Capture'), 'the app started offline from a URL with a query string, and opened Capture');
  await context.close();
});

check('god-mode hints: while a sequence is in progress a card lists the keys that continue it and what each does; tapping one runs it; it goes away when the sequence ends or is cancelled', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* TODO Task\n');
  const hints = page.locator('#godModeHints');
  const visible = () => hints.isVisible();
  const entry = (key) => hints.locator(`[data-hint-key="${key}"]`).first();
  const header = async () => (await hints.innerText()).split('\n')[0].replace(/\s+/g, ' ');
  expect(!(await visible()), 'no card when god-mode is off');

  await page.locator('body').click({ position: { x: 200, y: 850 } });
  await page.keyboard.press('Escape');
  if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  expect(!(await visible()), 'and none in god-mode before a key is typed');

  await page.keyboard.press('c');
  await hints.waitFor({ state: 'visible', timeout: 3000 });
  expect((await header()).startsWith('C-c'), `the card says what has been typed: ${await header()}`);
  const t = (await entry('t').innerText()).replace(/\s+/g, ' ');
  expect(/TODO/i.test(t), `t is labelled with what it does: ${t}`);
  expect((await hints.locator('[data-hint-key]').count()) >= 8, 'and the other keys that continue C-c are listed');
  expect((await entry('x').innerText()).includes('\u2026'), 'x leads on to more, and is marked so');

  await entry('x').click(); // a prefix: tapping it continues the sequence
  expect((await header()).includes('C-c C-x'), `tapping a prefix key continues the sequence: ${await header()}`);
  expect((await entry('i').innerText()).includes('Clock in'), 'and shows the clock keys');

  await page.keyboard.press('Escape'); // cancels the sequence
  await page.waitForTimeout(300);
  expect(!(await visible()), 'Escape cancels the sequence and the card goes away');

  // tapping to finish a chord runs the command: c then t cycles the TODO state
  await page.keyboard.press('c');
  await hints.waitFor({ state: 'visible', timeout: 3000 });
  await entry('t').click();
  await page.waitForTimeout(400);
  expect((await page.locator('#outline').innerText()).includes('DONE'), 'tapping t ran C-c C-t: the TODO state moved on');
  expect(!(await visible()), 'and the card goes away once the chord is finished');

  // g (Meta) shows the Meta keys
  await page.keyboard.press('g');
  await hints.waitFor({ state: 'visible', timeout: 3000 });
  expect((await header()).includes('M-'), `after g the card is about Meta: ${await header()}`);
  expect(/palette/i.test(await entry('x').innerText()), 'g x is the command palette');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(!(await visible()), 'cancelled again');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('org-clock-goto with C-u (u c x j): lists recently clocked tasks, most recent first, from every tab, and jumps to the one chosen; it is in the palette as org-clock-select-task, dimmed when nothing has been clocked', async () => {
  const doc = ['* Old task', ':LOGBOOK:', 'CLOCK: [2026-09-01 Tue 09:00]--[2026-09-01 Tue 10:00] =>  1:00', ':END:',
    '* Newest task', ':LOGBOOK:', 'CLOCK: [2026-09-02 Wed 08:00]--[2026-09-02 Wed 08:30] =>  0:30', 'CLOCK: [2026-09-05 Sat 14:00]--[2026-09-05 Sat 15:00] =>  1:00', ':END:',
    '* Never clocked', '** Clocked in the middle', ':LOGBOOK:', 'CLOCK: [2026-09-03 Thu 10:00]--[2026-09-03 Thu 11:00] =>  1:00', ':END:', ''].join('\n');
  const enterGodMode = async (page) => {
    await page.locator('body').click({ position: { x: 200, y: 850 } });
    await page.keyboard.press('Escape');
    if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  };
  const choices = (page) => page.getByText('Go to which recently clocked task?').locator('xpath=following-sibling::div[contains(@class,"panel-row")]//button').allInnerTexts();

  // 1. nothing clocked: the palette row is there but dimmed, with the reason
  {
    const { context, page } = await freshPage();
    await newDocument(page, '* Nothing clocked here\n');
    await openPalette(page);
    await page.keyboard.type('recently clocked');
    const rows = await paletteRows(page);
    expect(rows.some((r) => r.includes('Go to a recently clocked task') && r.includes('nothing has been clocked yet')), `dimmed with the reason: ${JSON.stringify(rows)}`);
    await context.close();
  }

  const { context, page, errors } = await freshPage();
  await newDocument(page, doc);

  // 2. the palette row shows its real name and chord
  await openPalette(page);
  await page.keyboard.type('recently clocked');
  const rows = await paletteRows(page);
  expect(rows.some((r) => r.includes('Go to a recently clocked task') && r.includes('C-u C-c C-x C-j') && r.includes('org-clock-select-task') && !r.includes('unavailable')), `available, with its chord and real name: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Escape');

  // 3. the god-mode chord opens the list, newest first, and never lists a heading that was not clocked
  await enterGodMode(page);
  for (const k of ['u', 'c', 'x', 'j']) await page.keyboard.press(k);
  await page.getByText('Go to which recently clocked task?').waitFor({ state: 'visible', timeout: 4000 });
  const list = (await choices(page)).map((t) => t.split(' \u00b7 ')[0]);
  expect(JSON.stringify(list) === JSON.stringify(['Newest task', 'Clocked in the middle', 'Old task']), `most recently clocked first, and only clocked tasks: ${JSON.stringify(list)}`);

  // 4. choosing one jumps to it (and leaves the way back, like every jump)
  expect(!(await page.locator('#navBackBtn').isVisible()), 'nothing has been navigated yet');
  await page.getByRole('button', { name: /^Old task/ }).click();
  await page.waitForTimeout(500);
  expect(await page.locator('#navBackBtn').isVisible(), 'choosing a task jumps to it and leaves the floating back button');

  // 5. from another tab it lists the first tab\u2019s tasks and switches back to that tab
  await newDocument(page, '* A different document\n');
  expect((await page.locator('#outline').innerText()).includes('A different document'), 'the second tab is showing');
  await enterGodMode(page);
  for (const k of ['u', 'c', 'x', 'j']) await page.keyboard.press(k);
  await page.getByText('Go to which recently clocked task?').waitFor({ state: 'visible', timeout: 4000 });
  await page.getByRole('button', { name: /^Newest task/ }).click();
  await page.waitForTimeout(700);
  const shown = await page.locator('#outline').innerText();
  expect(shown.includes('Newest task') && !shown.includes('A different document'), `it switched to the tab holding that task: ${shown.slice(0, 120)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('local agenda files: a local: entry loads without any prompt when access is granted, says what to do when it is not, asks only on the refresh button, opens from this device when tapped, and is never written into', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 412, height: 900 });
  // A real file handle from the browser's private file system stands in for a file opened on this device earlier;
  // it is registered where the app keeps such handles, and the permission calls are ones this check controls and counts.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('agenda-local.org', { create: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `<${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}>`;
    const w = await fh.createWritable();
    await w.write(`* TODO Local task\nSCHEDULED: ${stamp}\n`);
    await w.close();
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('org-pwa');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(fh, 'filehandle:agenda-local.org');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    window.__perm = { query: 0, request: 0, state: 'prompt' };
    FileSystemHandle.prototype.queryPermission = async function () { window.__perm.query += 1; return window.__perm.state; };
    FileSystemHandle.prototype.requestPermission = async function () { window.__perm.request += 1; window.__perm.state = 'granted'; return 'granted'; };
  });
  const perm = () => page.evaluate(() => ({ ...window.__perm }));
  const pageText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  await newDocument(page, ['* Main document', '# Local Variables:', '# org-agenda-files: local:agenda-local.org', '# End:', ''].join('\n'));
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(1200);
  let t = await pageText();
  expect(t.includes('needs permission to be read') && t.includes('Tap \u21bb to allow it'), `without access the agenda says what to do: ${t.slice(0, 300)}`);
  expect(!t.includes('Local task'), 'and shows nothing from the file yet');
  let p = await perm();
  expect(p.query >= 1 && p.request === 0, `loading it must only LOOK at the permission, never ask: ${JSON.stringify(p)}`);

  // the refresh button is a tap, so it is allowed to ask
  await page.locator('button', { hasText: '\u21bb' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Local task'), null, { timeout: 8000 });
  p = await perm();
  expect(p.request >= 1, `the refresh button asks for access: ${JSON.stringify(p)}`);
  expect(!(await pageText()).includes('needs permission to be read'), 'and the message is gone once it is read');

  // read-only: every view may use it, but nothing that writes back may
  const ids = await page.evaluate(async () => {
    const { aggregateAgendaDocs } = await import('/src-browser/agenda-files.js');
    return { all: aggregateAgendaDocs().map((d) => d.documentId), writable: aggregateAgendaDocs({ writable: true }).map((d) => d.documentId) };
  });
  expect(ids.all.includes('agenda-local.org'), `the agenda and search can use it: ${JSON.stringify(ids)}`);
  expect(!ids.writable.includes('agenda-local.org'), `but Refile and Replace never see it as somewhere to write: ${JSON.stringify(ids)}`);

  // tapping the item opens the file from this device
  await page.getByText('Local task').first().click();
  // the modeline bar also holds the status message, so look for the buffer name with its (Local) suffix, which only an opened local file has
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('agenda-local.org (Local)'), null, { timeout: 8000 });
  expect((await page.locator('#modelineBar').innerText()).includes('agenda-local.org (Local)'), 'the file opened, as a local file');
  expect((await page.locator('#tabBar > div').count()) === 2, 'in its own tab');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('agenda files: the same file name under two schemes is reported, not silently dropped', async () => {
  const { context, page } = await freshPage();
  await newDocument(page, ['* Main document', '# Local Variables:', '# org-agenda-files: webdav:dup.org;local:dup.org', '# End:', ''].join('\n'));
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(1200);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(text.includes('"local:dup.org" has the same file name as "webdav:dup.org"') && text.includes('so only "webdav:dup.org" is used'), `the second entry says why it is not used: ${text.slice(0, 400)}`);
  await context.close();
});

check('Search\u2019s Narrow persists across a reload, and Widen forgets it', async () => {
  dav.reset({ 'notes.org': ['* Alpha apple', '* Beta banana', '* Gamma apple', '* Delta', ''].join('\n') });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const titles = async () => (await page.locator('.heading-title').allInnerTexts()).map((t) => t.trim());
  await page.locator('body').click({ position: { x: 200, y: 850 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.locator('#search-query-input').fill('apple');
  await page.waitForTimeout(700);
  await page.locator('button', { hasText: /^Narrow$/ }).first().click();
  await page.waitForTimeout(500);
  expect(JSON.stringify(await titles()) === JSON.stringify(['Alpha apple', 'Gamma apple']), `Narrow should show only the two matches: ${JSON.stringify(await titles())}`);
  expect((await page.getByText('Narrowed to search: 2 headings').count()) === 1, 'and a banner says so');

  const reload = async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    if (!(await page.locator('.heading-title').count())) await openDav(page, 'notes.org');
    await page.waitForTimeout(700);
  };
  await reload();
  expect(JSON.stringify(await titles()) === JSON.stringify(['Alpha apple', 'Gamma apple']), `after a reload it is still narrowed to the same two: ${JSON.stringify(await titles())}`);
  expect((await page.getByText('Narrowed to search: 2 headings').count()) === 1, 'with its banner');

  await page.getByRole('button', { name: 'Widen', exact: true }).first().click();
  await page.waitForTimeout(500);
  expect((await titles()).length === 4, `Widen shows everything again: ${JSON.stringify(await titles())}`);
  await reload();
  expect((await titles()).length === 4 && (await page.getByText('Narrowed to search').count()) === 0, `and a widened document stays widened after a reload: ${JSON.stringify(await titles())}`);
  await context.close();
});

check('Search\u2019s Narrow restores every one of several headings that share a title, under the same or different parents', async () => {
  dav.reset({ 'notes.org': ['* Group', '** Dup apple', '** Other', '* Group', '** Dup apple', '* Dup apple', '* Dup apple', '* Tail', ''].join('\n') });
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const titles = async () => (await page.locator('.heading-title').allInnerTexts()).map((t) => t.trim());
  await page.locator('body').click({ position: { x: 200, y: 850 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.locator('#search-query-input').fill('apple');
  await page.waitForTimeout(700);
  await page.locator('button', { hasText: /^Narrow$/ }).first().click();
  await page.waitForTimeout(500);
  const before = await titles();
  expect(before.filter((t) => t === 'Dup apple').length === 4 && !before.includes('Other') && !before.includes('Tail'), `Narrow shows all four matches and no others: ${JSON.stringify(before)}`);
  expect((await page.getByText('Narrowed to search: 4 headings').count()) === 1, 'the banner counts all four');

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  if (!(await page.locator('.heading-title').count())) await openDav(page, 'notes.org');
  await page.waitForTimeout(700);
  const after = await titles();
  expect(JSON.stringify(after) === JSON.stringify(before), `after a reload the same headings are showing, not just the first of each title: ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
  expect((await page.getByText('Narrowed to search: 4 headings').count()) === 1, 'and the banner still counts four');
  await context.close();
});

check('line endings: a Windows-style (CRLF) file on the server is edited and saved with every line still CRLF, and a Unix-style one stays Unix-style', async () => {
  dav.reset({ 'crlf.org': '* One\r\n* Two\r\nbody text\r\n', 'unix.org': '* One\n* Two\nbody text\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  const at = (step) => (e) => { e.message = `[${step}] ${e.message}`; throw e; };

  await openDav(page, 'crlf.org').catch(at('open crlf'));
  await setDocumentText(page, '* One\n* Two changed\nbody text\n').catch(at('edit 1'));
  await fileMenu(page, 'Save').catch(at('save 1'));
  await waitForStatus(page, 'Saved').catch(at('status 1'));
  expect(dav.get('crlf.org') === '* One\r\n* Two changed\r\nbody text\r\n', `every line is still CRLF and only the edited one changed: ${JSON.stringify(dav.get('crlf.org'))}`);

  // saving did not leave the app thinking the file changed underneath it (a hash the app compares must agree with what it wrote)
  await page.waitForTimeout(800);
  expect(!(await page.locator('#externalChangeBanner').isVisible().catch(at('banner'))), 'no "changed elsewhere" banner after our own save');

  // a second edit and save, to be sure the remembered style holds for the whole session
  await setDocumentText(page, '* One\n* Two changed\nbody text\n* Three\n').catch(at('edit 2'));
  await fileMenu(page, 'Save').catch(at('save 2'));
  await waitForStatus(page, 'Saved').catch(at('status 2'));
  expect(dav.get('crlf.org') === '* One\r\n* Two changed\r\nbody text\r\n* Three\r\n', `still CRLF after a second save: ${JSON.stringify(dav.get('crlf.org'))}`);

  // a Unix-style file is not turned into a Windows-style one
  await openDav(page, 'unix.org').catch(at('open unix'));
  await setDocumentText(page, '* One\n* Two edited\nbody text\n').catch(at('edit 3'));
  await fileMenu(page, 'Save').catch(at('save 3'));
  await waitForStatus(page, 'Saved').catch(at('status 3'));
  expect(dav.get('unix.org') === '* One\n* Two edited\nbody text\n', `a Unix-style file stays Unix-style: ${JSON.stringify(dav.get('unix.org'))}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

const calDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}`;
};

check('calendar mirror: the agenda reaches a CalDAV calendar through the palette, edits follow a save, an event the app did not make is never touched, switching files removes nothing, and Rebuild cleans only the app\u2019s own', async () => {
  const notes = ['* TODO Pay rent', `DEADLINE: <${calDay(3)} -2d>`, '* DONE Call dentist', `SCHEDULED: <${calDay(-1)}>`, '* Standup', `SCHEDULED: <${calDay(1)} 09:30 +1d>`, '* Just a note', ''].join('\n');
  const other = ['* Other file task', `SCHEDULED: <${calDay(5)}>`, ''].join('\n');
  dav.reset({ 'notes.org': notes, 'other.org': other });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const ours = () => [...dav.files.entries()].filter(([n]) => n.startsWith('cal/orgpwa-'));
  const summaries = () => ours().map(([, t]) => (t.match(/^SUMMARY:(.*)$/m) || [])[1]).sort();
  const until = async (pred, what) => {
    for (let n = 0; n < 70; n++) {
      if (pred()) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`timed out waiting for: ${what} -- on the server: ${JSON.stringify(summaries())}`);
  };
  const runCommand = async (words) => {
    await openPalette(page);
    await page.keyboard.type(words);
    await page.keyboard.press('Enter');
  };

  // with no calendar set, the commands are there but dimmed, and say why
  await openPalette(page);
  await page.keyboard.type('sync agenda to calendar');
  const dimmed = await paletteRows(page);
  expect(dimmed.some((r) => r.includes('Sync agenda to calendar') && r.includes('no calendar address is set')), `dimmed with the reason: ${JSON.stringify(dimmed)}`);
  await page.keyboard.press('Escape');

  // set the calendar the way Settings would, then run the command
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url, username: '', password: '' };
  }, `${main.base}/dav/cal/`);
  dav.requests.length = 0;
  await runCommand('sync agenda to calendar');
  await until(() => ours().length === 2, 'two events on the server');
  expect(JSON.stringify(summaries()) === JSON.stringify(['Pay rent', 'Standup']), `the agenda items arrived, and the completed one (not on the agenda) did not: ${JSON.stringify(summaries())}`);
  const all = ours().map(([, t]) => t).join('\n');
  expect(!all.includes('Call dentist'), 'a completed item is not in the calendar, as it is not on the agenda');
  expect(all.includes('RRULE:FREQ=DAILY'), 'a repeating item is one event with a recurrence rule');
  expect(all.includes('BEGIN:VALARM') && all.includes('TRIGGER:-P2D'), 'a deadline\u2019s warning delay became an alarm');
  expect((await page.locator('#minibuffer').innerText()).includes('Calendar synced: 2 sent'), 'and the status line says what happened');

  // an event somebody else put in this calendar
  dav.set('cal/personal.ics', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:mine\r\nDTSTART;VALUE=DATE:20300101\r\nSUMMARY:My own event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');

  // an edit and a save: the calendar follows by itself
  await setDocumentText(page, notes.replace('* Standup', '* Brand new item').replace(`SCHEDULED: <${calDay(1)} 09:30 +1d>`, `SCHEDULED: <${calDay(2)}>`));
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'Saved');
  await until(() => JSON.stringify(summaries()) === JSON.stringify(['Brand new item', 'Pay rent']), 'the calendar to follow the save');
  expect(dav.files.has('cal/personal.ics'), 'the event the app did not create is untouched');

  // a second sync with nothing changed sends nothing
  dav.requests.length = 0;
  await runCommand('sync agenda to calendar');
  await page.waitForTimeout(1200);
  expect(!dav.requests.some((r) => r.startsWith('PUT') || r.startsWith('DELETE')), `an unchanged agenda sends nothing: ${JSON.stringify(dav.requests)}`);

  // opening another file must not remove this one's events
  await openDav(page, 'other.org');
  await runCommand('sync agenda to calendar');
  await until(() => summaries().includes('Other file task'), 'the other file\u2019s event');
  expect(JSON.stringify(summaries()) === JSON.stringify(['Brand new item', 'Other file task', 'Pay rent']), `both files\u2019 events are there: ${JSON.stringify(summaries())}`);

  // Rebuild: leftovers of the app's own go, anything else stays
  dav.set('cal/orgpwa-stale-left-over-00000000.ics', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stale\r\nDTSTART;VALUE=DATE:20300101\r\nSUMMARY:Stale\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  await runCommand('rebuild calendar');
  await until(() => !dav.files.has('cal/orgpwa-stale-left-over-00000000.ics') && summaries().includes('Other file task'), 'the rebuild');
  expect(dav.files.has('cal/personal.ics'), 'a rebuild leaves events that are not the app\u2019s');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('calendar mirror: a calendar that does not exist is reported clearly, automatic runs then stop asking until the settings change, and a manual sync tries again', async () => {
  dav.reset({ 'notes.org': ['* Task', `SCHEDULED: <${calDay(1)}>`, ''].join('\n') });
  dav.setCollections(['cal/']); // only cal/ exists
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url, username: '', password: '' };
  }, `${main.base}/dav/nope/`);
  dav.requests.length = 0;
  await openPalette(page);
  await page.keyboard.type('sync agenda to calendar');
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'Calendar not found');
  // only requests to a calendar folder count: the app also checks its own open file for outside changes on resume
  const calendarRequests = () => dav.requests.filter((r) => /^\S+ (nope|cal)\//.test(r));
  const first = calendarRequests().length;
  expect(first >= 1 && calendarRequests().every((r) => r.startsWith('PROPFIND')), `only the one check request was made, no writes: ${JSON.stringify(calendarRequests())}`);

  // coming back to the app asks for an automatic sync; it must not even try
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3600);
  expect(calendarRequests().length === first, `no further calendar requests after the failure: ${JSON.stringify(calendarRequests())}`);

  // pointing it at a real calendar and syncing by hand works again
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url, username: '', password: '' };
  }, `${main.base}/dav/cal/`);
  await openPalette(page);
  await page.keyboard.type('sync agenda to calendar');
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'Calendar synced');
  expect([...dav.files.keys()].some((n) => n.startsWith('cal/orgpwa-')), 'the event arrived once the address was right');
  await context.close();
});

const contactsVars = (files) => ['# Local Variables:', `# org-contacts-files: ${files}`, '# End:'];
const peopleFile = (extra = []) => ['* Jane Doe', ':PROPERTIES:', ':ID: jane-1', ':EMAIL: jane@example.com', ':PHONE: 555-0100', ':END:', '* Not a contact', 'some prose', '* Tree Tom', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** tom@example.com', ':PROPERTIES:', ':FIELDTYPE: email', ':END:', ...extra, ...contactsVars('webdav:people.org'), ''].join('\n');

check('contacts mirror: org-contacts-files reach a CardDAV address book through the palette, the open file is not sent unless it is one of them, edits follow a save, a contact the app did not make is never touched, and Rebuild cleans only the app\u2019s own', async () => {
  const notes = ['* Notes', '* Dave Notes', ':PROPERTIES:', ':EMAIL: dave@example.com', ':END:', ...contactsVars('webdav:people.org'), ''].join('\n');
  dav.reset({ 'notes.org': notes, 'people.org': peopleFile() });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const ours = () => [...dav.files.entries()].filter(([n]) => n.startsWith('card/orgpwa-'));
  const names = () => ours().map(([, t]) => (t.match(/^FN:(.*)$/m) || [])[1]).sort();
  const until = async (pred, what) => {
    for (let n = 0; n < 70; n++) {
      if (pred()) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`timed out waiting for: ${what} -- on the server: ${JSON.stringify(names())}`);
  };
  const runCommand = async (words) => {
    await openPalette(page);
    await page.keyboard.type(words);
    await page.keyboard.press('Enter');
  };

  // with no contacts address set, the commands are there but dimmed, and say why
  await openPalette(page);
  await page.keyboard.type('sync contacts to the address book');
  const dimmed = await paletteRows(page);
  expect(dimmed.some((r) => r.includes('Sync contacts to the address book') && r.includes('no contacts address is set')), `dimmed with the reason: ${JSON.stringify(dimmed)}`);
  await page.keyboard.press('Escape');

  // set the address the way Settings would (the contacts address only: no calendar), then run the command
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url: '', contactsUrl: url, username: 'me', password: 'secret' };
  }, `${main.base}/dav/card/`);
  dav.auths.length = 0;
  await runCommand('sync contacts to the address book');
  await until(() => ours().length === 2, 'two contacts on the server');
  const login = 'Basic ' + Buffer.from('me:secret').toString('base64');
  const cardAuths = dav.auths.filter((a) => /^\S+ card\//.test(a.request));
  expect(cardAuths.length >= 3 && cardAuths.every((a) => a.authorization === login), `every request to the address book carried the one username and password: ${JSON.stringify(cardAuths.map((a) => [a.request, a.authorization === login]))}`);
  // with the username and password left blank, the WebDAV ones are used, as for the calendar
  const fallback = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { effectiveContactsConfig } = await import('/src-browser/contacts-sync.js');
    const saved = S.caldavConfig;
    S.webdavConfig = { ...S.webdavConfig, username: 'dav-user', password: 'dav-pass' };
    S.caldavConfig = { url: '', contactsUrl: 'https://h/book/', username: '', password: '' };
    const blank = effectiveContactsConfig();
    S.caldavConfig = { url: 'https://h/cal/', contactsUrl: '', username: 'me', password: 'secret' };
    const none = effectiveContactsConfig();
    S.caldavConfig = saved;
    return { blank, none };
  });
  expect(fallback.blank && fallback.blank.username === 'dav-user' && fallback.blank.password === 'dav-pass' && fallback.blank.url === 'https://h/book/', `blank credentials fall back to the WebDAV ones: ${JSON.stringify(fallback.blank)}`);
  expect(fallback.none === null, 'and with no contacts address there is nothing to sync, even with a calendar set');
  expect(JSON.stringify(names()) === JSON.stringify(['Jane Doe', 'Tree Tom']), `the contacts files\u2019 contacts arrived, Flat and Tree: ${JSON.stringify(names())}`);
  const all = ours().map(([, t]) => t).join('\n');
  expect(all.includes('UID:jane-1@org-pwa') && all.includes('EMAIL:jane@example.com') && all.includes('EMAIL:tom@example.com'), 'each is a vCard with a UID and its fields');
  expect(!all.includes('Dave Notes') && !all.includes('Not a contact'), 'the open file is not sent (it is not one of org-contacts-files), and plain headings are not contacts');
  expect(ours().every(([n]) => n.endsWith('.vcf')), 'stored as .vcf files');
  expect((await page.locator('#minibuffer').innerText()).includes('Contacts synced: 2 sent'), `the status line says what happened: ${await page.locator('#minibuffer').innerText()}`);

  // a contact somebody else put in this address book
  dav.set('card/personal.vcf', 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:mine\r\nFN:My Own Contact\r\nEND:VCARD\r\n');

  // a second sync with nothing changed sends nothing
  dav.requests.length = 0;
  await runCommand('sync contacts to the address book');
  await page.waitForTimeout(1200);
  expect(!dav.requests.some((r) => r.startsWith('PUT card') || r.startsWith('DELETE card')), `unchanged contacts send nothing: ${JSON.stringify(dav.requests)}`);

  // an edit and a save in the contacts file itself: the address book follows by itself, a removed contact goes
  await openDav(page, 'people.org');
  await setDocumentText(page, peopleFile().replace('jane@example.com', 'jane.new@example.com').replace(/\* Tree Tom[\s\S]*?:FIELDTYPE: email\n:END:\n/, ''));
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'Saved');
  await until(() => JSON.stringify(names()) === JSON.stringify(['Jane Doe']), 'the address book to follow the save');
  expect(ours()[0][1].includes('jane.new@example.com'), 'the edited contact was sent again');
  expect(dav.files.has('card/personal.vcf'), 'the contact the app did not create is untouched');

  // Rebuild: leftovers of the app's own go, anything else stays
  dav.set('card/orgpwa-stale-left-over-00000000.vcf', 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:stale\r\nFN:Stale\r\nEND:VCARD\r\n');
  await runCommand('rebuild contacts');
  await until(() => !dav.files.has('card/orgpwa-stale-left-over-00000000.vcf') && JSON.stringify(names()) === JSON.stringify(['Jane Doe']), 'the rebuild');
  expect(dav.files.has('card/personal.vcf'), 'a rebuild leaves contacts that are not the app\u2019s');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('contacts mirror: an address book that does not exist is reported clearly, automatic runs then stop asking until the settings change, and a manual sync tries again', async () => {
  dav.reset({ 'people.org': peopleFile() });
  dav.setCollections(['card/']); // only card/ exists
  const { context, page } = await freshPage(main, { withDav: true });
  await openDav(page, 'people.org');
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url: '', contactsUrl: url, username: '', password: '' };
  }, `${main.base}/dav/nope/`);
  dav.requests.length = 0;
  await openPalette(page);
  await page.keyboard.type('sync contacts to the address book');
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'Address book not found');
  const bookRequests = () => dav.requests.filter((r) => /^\S+ (nope|card)\//.test(r));
  const first = bookRequests().length;
  expect(first >= 1 && bookRequests().every((r) => r.startsWith('PROPFIND')), `only the one check request was made, no writes: ${JSON.stringify(bookRequests())}`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // coming back to the app asks for an automatic sync
  await page.waitForTimeout(3600);
  expect(bookRequests().length === first, `no further address book requests after the failure: ${JSON.stringify(bookRequests())}`);
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url: '', contactsUrl: url, username: '', password: '' };
  }, `${main.base}/dav/card/`);
  await openPalette(page);
  await page.keyboard.type('sync contacts to the address book');
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'Contacts synced');
  expect([...dav.files.keys()].some((n) => n.startsWith('card/orgpwa-')), 'the contacts arrived once the address was right');
  await context.close();
});

check('contacts mirror: with an address set but no org-contacts-files, a manual sync says so and makes no request, and an automatic one stays silent', async () => {
  dav.reset({ 'plain.org': '* Just a note\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'plain.org');
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url: '', contactsUrl: url, username: '', password: '' };
  }, `${main.base}/dav/card/`);
  dav.requests.length = 0;
  await openPalette(page);
  await page.keyboard.type('sync contacts to the address book');
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'no contacts files are set');
  expect((await page.locator('#minibuffer').innerText()).includes('org-contacts-files'), 'it names the setting to fill in');
  expect(!dav.requests.some((r) => /^\S+ card\//.test(r)), `nothing was asked of the server: ${JSON.stringify(dav.requests)}`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3600);
  expect(!dav.requests.some((r) => /^\S+ card\//.test(r)), 'an automatic run makes no request either');
  expect(!(await page.locator('#minibuffer').innerText()).includes('Contacts sync:'), 'and says nothing');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('Settings > Sync syncs the calendar and the contacts and says how each went in one line, an error in one is not hidden by the other, and the three buttons wrap on a narrow phone instead of overflowing', async () => {
  const notes = ['* TODO Pay rent', `DEADLINE: <${calDay(3)}>`, ...contactsVars('webdav:people.org'), ''].join('\n');
  dav.reset({ 'notes.org': notes, 'people.org': peopleFile() });
  dav.setCollections(['cal/', 'card/']);
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await page.setViewportSize({ width: 340, height: 800 });
  await openDav(page, 'notes.org');
  const configure = (calendar, contacts) => page.evaluate(async ({ calendar, contacts }) => {
    const { S } = await import('/src-browser/app-state.js');
    const { setCaldavConfig } = await import('/src-browser/settings.js');
    const { kv } = await import('/src-browser/singletons.js');
    S.caldavConfig = await setCaldavConfig(kv, { url: calendar, contactsUrl: contacts, username: '', password: '' });
    S.calendarSyncPaused = false;
    S.contactsSyncPaused = false;
  }, { calendar, contacts });
  await configure(`${main.base}/dav/cal/`, `${main.base}/dav/card/`);
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  // the page builds its sections one after another: wait for the one measured below, not just for some section
  await page.waitForFunction(() => [...document.querySelectorAll('.settings-section .panel-section-title')].some((t) => t.textContent === 'Calendar (CalDAV) / Contacts (CardDAV)'));

  // narrow screen: every button stays inside its section and the page does not scroll sideways
  const fit = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Calendar (CalDAV) / Contacts (CardDAV)');
    const box = sec.getBoundingClientRect();
    const buttons = [...sec.querySelectorAll('button')].map((b) => ({ label: b.textContent, right: b.getBoundingClientRect().right, left: b.getBoundingClientRect().left }));
    return { sectionRight: box.right, buttons, scrolls: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  expect(fit.buttons.length === 3 && fit.buttons.every((b) => b.right <= fit.sectionRight + 1 && b.left >= 0) && !fit.scrolls, `the three buttons fit a 340px screen: ${JSON.stringify(fit)}`);

  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await waitForStatus(page, 'Contacts synced');
  let said = await page.locator('#minibuffer').innerText();
  expect(said.includes('Calendar synced: 1 sent') && said.includes('Contacts synced: 2 sent'), `one line says how both went: ${said}`);
  expect([...dav.files.keys()].some((n) => n.startsWith('cal/orgpwa-')) && [...dav.files.keys()].some((n) => n.startsWith('card/orgpwa-')), 'both servers have their data');

  // a calendar that is not there: its error is in the line, next to the contacts' success
  await configure(`${main.base}/dav/nowhere/`, `${main.base}/dav/card/`);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await waitForStatus(page, 'Contacts synced');
  said = await page.locator('#minibuffer').innerText();
  expect(said.includes('Calendar sync: Calendar not found') && said.includes('Contacts synced'), `the calendar\u2019s failure is not hidden by the contacts\u2019 success: ${said}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('contacts in the agenda and the calendar: a birthday line and an "ANNIVERSARY" line, in two files, show both from org-contacts-files (which need not be agenda files), with Emacs\u2019s titles, and the calendar gets the same entries', async () => {
  const md = (n) => calDay(n).slice(5, 10); // MM-DD of a day soon
  const notes = ['* Birthdays', '%%(org-contacts-anniversaries)', '* Not a contacts file person', ':PROPERTIES:', `:BIRTHDAY: 1980-${md(1)}`, ':END:', '# Local Variables:', '# org-contacts-files: webdav:contacts.org', '# org-agenda-files: webdav:anniv.org', '# End:', ''].join('\n');
  const anniv = ['* Anniversaries', '%%(org-contacts-anniversaries "ANNIVERSARY")', ''].join('\n');
  const contacts = ['* Jane Doe', ':PROPERTIES:', `:BIRTHDAY: 1990-${md(1)}`, `:ANNIVERSARY: 1998-${md(2)}`, ':SPOUSE: John Doe', ':END:', ''].join('\n');
  dav.reset({ 'notes.org': notes, 'anniv.org': anniv, 'contacts.org': contacts });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await page.setViewportSize({ width: 412, height: 900 });
  await openDav(page, 'notes.org');
  const year = new Date().getFullYear();
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
  const birthday = `Birthday: Jane Doe (${ordinal(year - 1990)})`;
  const anniversary = `Anniversary: Jane Doe & John Doe (${ordinal(year - 1998)})`;
  await viewMenu(page, 'Agenda');
  await page.waitForFunction((want) => want.every((t) => document.body.innerText.includes(t)), [birthday, anniversary], { timeout: 15000 });
  const text = await page.locator('body').innerText();
  expect(!text.includes('Not a contacts file person'), 'a heading with a birthday in a file that is not one of org-contacts-files is not a contact');

  // the calendar gets the same entries (the sync loads the contacts files itself)
  await page.evaluate(async (url) => {
    const { S } = await import('/src-browser/app-state.js');
    S.caldavConfig = { url, contactsUrl: '', username: '', password: '' };
  }, `${main.base}/dav/cal/`);
  await openPalette(page);
  await page.keyboard.type('sync agenda to calendar');
  await page.keyboard.press('Enter');
  const onServer = () => [...dav.files.entries()].filter(([n]) => n.startsWith('cal/orgpwa-')).map(([, t]) => (t.match(/^SUMMARY:(.*)$/m) || [])[1]).sort();
  for (let n = 0; n < 70 && onServer().length < 2; n++) await page.waitForTimeout(250);
  expect(JSON.stringify(onServer()) === JSON.stringify([anniversary, birthday].sort()), `the calendar holds what the agenda shows: ${JSON.stringify(onServer())}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('Export > Calendar (.ics) > Agenda (as displayed) writes the agenda\u2019s events for the sync window, beside the file and heading scopes, which write every dated item', async () => {
  const notes = ['* TODO Pay rent', `DEADLINE: <${calDay(3)}>`, '* Far away', 'SCHEDULED: <2031-05-01 Thu>', '* DONE Finished', `SCHEDULED: <${calDay(1)}>`, ''].join('\n');
  dav.reset({ 'notes.org': notes });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    window.__saved = [];
    installPlatform({ saveFile: async (name, content) => { window.__saved.push({ name, content: String(content) }); return { where: 'test' }; } });
  });
  await openDav(page, 'notes.org');
  const panelText = async () => (await page.locator('#morePanel').innerText()).replace(/\s+/g, ' ');
  const openScopes = async () => {
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Export');
    await pick(page, '#morePanel', 'Calendar (.ics)');
  };
  const savedIcs = async () => (await page.evaluate(() => window.__saved.slice())).find((x) => x.name.endsWith('.ics'));
  await openScopes();
  const rows = await panelText();
  expect(rows.includes('This file') && rows.includes('Choose a heading') && rows.includes('Agenda (as displayed)'), `the scopes: ${rows}`);
  expect(rows.indexOf('Agenda (as displayed)') > rows.indexOf('This file'), 'the new row comes after the existing ones, so nothing moved');
  await pick(page, '#morePanel', 'Agenda (as displayed)');
  for (let n = 0; n < 40 && !(await savedIcs()); n++) await page.waitForTimeout(250);
  const agendaIcs = await savedIcs();
  expect(agendaIcs && agendaIcs.content.includes('SUMMARY:Pay rent') && !agendaIcs.content.includes('Far away') && !agendaIcs.content.includes('Finished'), `the agenda scope: the window, and no completed item: ${agendaIcs && agendaIcs.content.slice(0, 300)}`);

  await page.evaluate(() => { window.__saved = []; });
  await openScopes(); // the export closed the menu
  await pick(page, '#morePanel', 'This file');
  for (let n = 0; n < 40 && !(await savedIcs()); n++) await page.waitForTimeout(250);
  const fileIcs = await savedIcs();
  expect(fileIcs && fileIcs.content.includes('SUMMARY:Far away') && fileIcs.content.includes('SUMMARY:Pay rent'), 'the file scope still writes every dated item, whatever the window');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('Search extra files: text search also looks in org-agenda-text-search-extra-files and names a file it cannot load, the agenda does not use them, a result opens its file, a file in both lists is searched once, and the Quick Settings row sits right after Contacts files', async () => {
  const extra = ['* TODO Extra heading', `SCHEDULED: <${calDay(1)}>`, 'a unicornword lives only here', ''].join('\n');
  const notes = (vars) => ['* Notes', 'plain text', '# Local Variables:', ...vars, '# End:', ''].join('\n');
  dav.reset({ 'notes.org': notes(['# org-agenda-text-search-extra-files: webdav:extra.org;webdav:missing.org']), 'extra.org': extra });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await page.setViewportSize({ width: 412, height: 900 });
  await openDav(page, 'notes.org');
  const search = async (query) => {
    await page.evaluate(() => document.getElementById('searchBtn').click());
    await page.fill('#search-query-input', query);
  };
  await search('unicornword');
  await page.waitForFunction(() => document.getElementById('search-results').innerText.includes('extra.org'), null, { timeout: 12000 });
  let found = await page.locator('#search-results').innerText();
  expect(found.includes('Extra heading') && found.includes('extra.org'), `a match in an extra file: ${found.slice(0, 200)}`);
  expect(found.includes('missing.org'), `and the file that cannot be loaded is named above the results: ${found.slice(0, 200)}`);

  // search only: the agenda's documents do not include the extra file, the search's do
  const ids = await page.evaluate(async () => {
    const m = await import('/src-browser/agenda-files.js');
    return { agenda: m.aggregateAgendaDocs().map((d) => d.documentId), search: m.aggregateSearchDocs().map((d) => d.documentId) };
  });
  expect(!ids.agenda.includes('extra.org') && ids.search.includes('extra.org') && ids.search.includes('notes.org'), `search only: ${JSON.stringify(ids)}`);
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(500);
  expect(!(await page.locator('body').innerText()).includes('Extra heading'), 'the agenda does not show the extra file\u2019s scheduled item');
  await viewMenu(page, 'Org');
  await page.waitForTimeout(300);

  // tapping a result opens that file
  await search('unicornword');
  await page.waitForFunction(() => document.getElementById('search-results').innerText.includes('extra.org'), null, { timeout: 12000 });
  await page.locator('#search-results').getByText('Extra heading', { exact: false }).first().click();
  let openId = null;
  for (let n = 0; n < 48 && openId !== 'extra.org'; n++) {
    await page.waitForTimeout(250);
    openId = await page.evaluate(async () => (await import('/src-browser/app-state.js')).S.state.documentId);
  }
  expect(openId === 'extra.org', `the result really opened extra.org (the open document is ${openId}; the status line says: ${await page.locator('#minibuffer').innerText()})`);

  // the Quick Settings row: right after Contacts files, labelled Search extra files
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.waitForFunction(() => document.body.textContent.includes('Search extra files'), null, { timeout: 8000 });
  const order = await page.evaluate(() => {
    const wanted = ['Agenda files', 'Contacts files', 'Search extra files', 'Extras menu (\u2630)'];
    const leaves = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && wanted.includes(e.textContent.trim()));
    return leaves.map((e) => e.textContent.trim());
  });
  expect(JSON.stringify(order) === JSON.stringify(['Agenda files', 'Contacts files', 'Search extra files', 'Extras menu (\u2630)']), `the row order in Quick Settings: ${JSON.stringify(order)}`);
  await context.close();

  // a file listed as an agenda file AND as an extra file is searched once
  dav.reset({ 'notes.org': notes(['# org-agenda-files: webdav:extra.org', '# org-agenda-text-search-extra-files: webdav:extra.org']), 'extra.org': extra });
  const second = await freshPage(main, { withDav: true });
  await openDav(second.page, 'notes.org');
  await second.page.evaluate(() => document.getElementById('searchBtn').click());
  await second.page.fill('#search-query-input', 'unicornword');
  await second.page.waitForFunction(() => document.getElementById('search-results').innerText.includes('extra.org'), null, { timeout: 12000 });
  await second.page.waitForTimeout(800);
  const both = await second.page.locator('#search-results').innerText();
  expect(both.split('extra.org').length - 1 === 1, `searched once, listed twice: ${both.slice(0, 200)}`);
  expect(errors.length === 0 && second.errors.length === 0, `page errors: ${errors.concat(second.errors).join(' | ')}`);
  await second.context.close();
});

check('settings page order: Calendar (CalDAV) / Contacts (CardDAV) comes right after WebDAV so Backup is last, and Paragraph Spacing comes right after Font Size; its buttons follow which addresses are set', async () => {
  const { context, page } = await freshPage();
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.waitForFunction(() => [...document.querySelectorAll('.settings-section .panel-section-title')].some((t) => t.textContent === 'Updates'), null, { timeout: 8000 }); // the sections are built one after another
  const sections = await page.evaluate(() => [...document.querySelectorAll('.settings-section')].map((sec) => (sec.querySelector('.panel-section-title') || {}).textContent || ''));
  expect(sections[sections.length - 1] === 'Backup', `Backup is the last section: ${JSON.stringify(sections)}`);
  const w = sections.indexOf('WebDAV');
  expect(w >= 0 && sections[w + 1] === 'Calendar (CalDAV) / Contacts (CardDAV)' && sections[w + 2] === 'Backup', `Calendar (CalDAV) / Contacts (CardDAV) directly follows WebDAV: ${JSON.stringify(sections)}`);
  expect(sections.includes('GitHub') && sections.includes('Updates') && sections.includes('Capture Templates'), 'and the sections that were there are still there');
  const appearance = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Appearance');
    return [...sec.querySelectorAll('.panel-section-title')].map((t) => t.textContent);
  });
  expect(JSON.stringify(appearance) === JSON.stringify(['Appearance', 'Font', 'Font Size', 'Paragraph Spacing', 'Reading Width', 'Menu Size']), `Paragraph Spacing follows Font Size: ${JSON.stringify(appearance)}`);
  const disabled = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Calendar (CalDAV) / Contacts (CardDAV)');
    return [...sec.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]);
  });
  expect(JSON.stringify(disabled) === JSON.stringify([['Sync', true], ['Rebuild calendar', true], ['Rebuild contacts', true]]), `all three buttons start disabled: ${JSON.stringify(disabled)}`);

  // the fields: Contacts address sits directly under Calendar address, and the login fields follow
  const fieldOrder = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Calendar (CalDAV) / Contacts (CardDAV)');
    const text = sec.innerText;
    return ['Calendar address', 'Contacts address (same username and password)', 'Username', 'Password'].map((label) => text.indexOf(label));
  });
  expect(fieldOrder.every((n, i) => n >= 0 && (i === 0 || n > fieldOrder[i - 1])), `Calendar address, Contacts address, then Username and Password: ${JSON.stringify(fieldOrder)}`);

  // which buttons are on follows which addresses are set
  const buttonsWith = async (config) => {
    await page.evaluate(async (config) => {
      const { setCaldavConfig } = await import('/src-browser/settings.js');
      const { kv } = await import('/src-browser/singletons.js');
      await setCaldavConfig(kv, config);
      await (await import('/src-browser/settings-view.js')).renderSettingsView();
    }, config);
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const sec = [...document.querySelectorAll('.settings-section')].find((x) => (x.querySelector('.panel-section-title') || {}).textContent === 'Calendar (CalDAV) / Contacts (CardDAV)');
      return [...sec.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]);
    });
  };
  const only = (rows) => JSON.stringify(rows);
  expect(only(await buttonsWith({ url: 'https://h/cal/' })) === only([['Sync', false], ['Rebuild calendar', false], ['Rebuild contacts', true]]), 'with only a calendar: Rebuild contacts is off');
  expect(only(await buttonsWith({ contactsUrl: 'https://h/contacts/' })) === only([['Sync', false], ['Rebuild calendar', true], ['Rebuild contacts', false]]), 'with only contacts: Rebuild calendar is off, and Sync is on');
  expect(only(await buttonsWith({ url: 'https://h/cal/', contactsUrl: 'https://h/contacts/' })) === only([['Sync', false], ['Rebuild calendar', false], ['Rebuild contacts', false]]), 'with both: all on');
  await context.close();
});

check('platform seam: a platform injected before startup (as a native shell would) is used for saving a file out, for the clipboard and for viewing, and the service worker is skipped', async () => {
  // the platform is there from the very first load, so nothing has registered a service worker yet
  const { context, page, errors } = await freshPage(main, { serviceWorkers: 'allow', initScript: () => { window.orgPwaPlatform = { name: 'fake-native', usesServiceWorker: false }; } });
  let browserDownloads = 0;
  page.on('download', () => { browserDownloads++; });
  await page.locator('#moreBtn').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);

  expect((await page.evaluate(async () => (await import('/src-browser/platform.js')).platform.name)) === 'fake-native', 'the injected platform is the one in use from the start');
  expect((await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0, 'a platform that bundles the app does not register the service worker');

  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    window.__saved = [];
    window.__viewed = [];
    installPlatform({
      saveFile: (name, content, mime) => window.__saved.push({ name, mime, text: typeof content === 'string' ? content : '(bytes)' }),
      viewFile: (blob, name) => window.__viewed.push(name),
      clipboard: { readText: async () => 'FROM-THE-FAKE-CLIPBOARD', writeText: async () => {} },
    });
  });

  // a file handed out goes to the platform, not to the browser's download
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.getByRole('button', { name: 'Export Settings' }).click();
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.__saved[0]);
  expect(saved.name === 'org-pwa-settings.json' && saved.text.includes('"format": "org-pwa-settings"'), `Export Settings went to platform.saveFile: ${JSON.stringify(saved).slice(0, 120)}`);
  expect(browserDownloads === 0, 'and the browser downloaded nothing itself');

  // the clipboard token reads the platform's clipboard (the real one would be refused in this browser)
  await newDocument(page, '* Inbox\n');
  await page.evaluate((json) => new Promise((resolve, reject) => {
    const open = indexedDB.open('org-pwa');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(json, 'settings:captureTemplates');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), JSON.stringify([{ key: 'x', description: 'Clip', type: 'plain', olp: ['Inbox'], template: '* Clip\n  %x', emptyLines: 0 }]));
  await openPalette(page);
  await page.keyboard.type('capture: clip');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  if (await page.locator('#capturePanel').isVisible()) await page.locator('#capturePanel button', { hasText: 'Close' }).first().click();
  await viewMenu(page, 'Text');
  const text = await page.locator('#document-text-edit-input').inputValue();
  expect(text.includes('FROM-THE-FAKE-CLIPBOARD'), `%x came from platform.clipboard: ${JSON.stringify(text)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  // the default platform, for contrast: it does register the service worker
  const base = await freshPage(main, { serviceWorkers: 'allow' });
  await base.page.waitForTimeout(2500);
  expect((await base.page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 1, 'the default web platform registers it');
  expect((await base.page.evaluate(async () => (await import('/src-browser/platform.js')).platform.name)) === 'web', 'and calls itself web');
  await base.context.close();
});

check('platform seam: opening, editing and saving a local file goes through platform.localFiles, and a CRLF file keeps its line endings through it', async () => {
  const { context, page, errors } = await freshPage();
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    const store = new Map([['phone.org', '* From the phone\r\nbody text\r\n']]);
    window.__writes = [];
    window.__picked = 0;
    installPlatform({
      localFiles: {
        supported: () => true,
        pickOpen: async () => { window.__picked++; return 'phone.org'; },
        pickNew: async (kv, name) => { store.set(name, ''); return name; },
        adapter: {
          async read(id) { if (!store.has(id)) return null; const content = store.get(id); return { content, hash: 'h' + content.length }; },
          async write(id, content) { store.set(id, content); window.__writes.push({ id, content }); return { hash: 'h' + content.length }; },
          async exists(id) { return store.has(id); },
          async access() { return 'granted'; },
        },
      },
    });
  });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  expect((await page.evaluate(() => window.__picked)) === 1, 'the open went through platform.localFiles.pickOpen');
  expect((await page.locator('#outline').innerText()).includes('From the phone'), 'the file was read through the platform\u2019s adapter');

  await setDocumentText(page, '* From the phone\n* Added here\nbody text\n');
  await fileMenu(page, 'Save');
  await waitForStatus(page, 'Saved');
  const writes = await page.evaluate(() => window.__writes);
  expect(writes.length === 1 && writes[0].id === 'phone.org', `the save went through platform.localFiles.adapter.write: ${JSON.stringify(writes)}`);
  expect(writes[0].content === '* From the phone\r\n* Added here\r\nbody text\r\n', `and the file kept its Windows line endings: ${JSON.stringify(writes[0].content)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('platform seam: a native shell can hand the app a share directly (runLaunch), with no URL involved, and it captures like the share URL does', async () => {
  dav.reset({ 'notes.org': SAMPLE, 'inbox.org': '* Inbox\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  const templates = [{ key: 'n', description: 'Shared note', type: 'plain', file: 'inbox.org', olp: ['Inbox'], template: '* Note\n  %i\n  %a', emptyLines: 0 }];
  await page.evaluate((json) => new Promise((resolve, reject) => {
    const open = indexedDB.open('org-pwa');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(json, 'settings:captureTemplates');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), JSON.stringify(templates));
  await openDav(page, 'notes.org');
  const urlBefore = page.url();

  await page.evaluate(async () => {
    const { runLaunch } = await import('/src-browser/launch-params.js');
    await runLaunch({ capture: 'n', shared: { title: 'Native page', text: 'handed over by a share extension', url: 'https://example.com/native' } });
  });
  for (let n = 0; n < 40 && !dav.get('inbox.org').includes('handed over'); n++) await page.waitForTimeout(250);
  const file = dav.get('inbox.org');
  expect(file.includes('** Note\n  handed over by a share extension\n  [[https://example.com/native][Native page]]'), `the template ran with the shared content: ${JSON.stringify(file)}`);
  expect(page.url() === urlBefore, 'and no URL was involved: the address is untouched');

  // with no key, the template list opens and keeps what was shared for the one that is picked
  await page.evaluate(async () => {
    const { runLaunch } = await import('/src-browser/launch-params.js');
    await runLaunch({ capture: '', shared: { title: '', text: 'second share', url: '' } });
  });
  await page.waitForSelector('#capturePanel', { state: 'visible', timeout: 5000 });
  await page.locator('#capturePanel button', { hasText: 'Shared note' }).first().click();
  for (let n = 0; n < 40 && !dav.get('inbox.org').includes('second share'); n++) await page.waitForTimeout(250);
  expect(dav.get('inbox.org').includes('  second share'), 'a share with no key shows the list and the picked template gets the text');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('status bar: the app bar starts below the status bar with the tab bar directly beneath it (not hidden behind it), also when the bar is scrolled, and nothing changes with no inset', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 411, height: 924 });
  await newDocument(page, '* One\n'); // a document, so the tab bar exists: without one the bug below cannot show
  const measure = () => page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10 }; };
    const header = document.querySelector('#topBar header');
    return { padding: getComputedStyle(document.getElementById('topBar')).paddingTop, header: r(header), tabBar: r(document.getElementById('tabBar')), button: Math.round(header.querySelector('button').getBoundingClientRect().top * 10) / 10, tabsShown: document.getElementById('tabBar').style.display !== 'none', contentTop: Math.round(document.getElementById('contentArea').getBoundingClientRect().top), barBottom: r(document.getElementById('topBar')).bottom };
  });
  const before = await measure();
  expect(before.tabsShown && before.padding === '0px' && before.header.top === 0 && before.tabBar.top === before.header.bottom, `with no inset nothing changes: ${JSON.stringify(before)}`);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 58, bottom: 0, left: 0, right: 0 } });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(400);
  const after = await measure();
  expect(after.padding === '58px', `the top bar pads by the status-bar height: ${JSON.stringify(after)}`);
  expect(after.header.top === 58, `the app bar starts exactly below the status bar, not lower: ${JSON.stringify(after)}`);
  expect(after.tabBar.top === after.header.bottom, `and the tab bar is directly beneath it, not hidden behind it: ${JSON.stringify(after)}`);
  expect(after.button === 66, `so the first button is 8px into the bar (66px): ${JSON.stringify(after)}`);
  expect(after.contentTop >= after.barBottom - 1, `and the document still starts below the bar: ${JSON.stringify(after)}`);

  // when something tall makes the bar scroll, the app bar sticks just below the status bar, not under it
  await page.evaluate(() => {
    const bar = document.getElementById('topBar');
    bar.style.maxHeight = '120px';
    bar.scrollTop = 40;
  });
  await page.waitForTimeout(200);
  const scrolled = await measure();
  expect(scrolled.header.top === 58, `a scrolled bar keeps the app bar just below the status bar: ${JSON.stringify(scrolled)}`);

  // a tap where the first button is really reaches it
  await page.evaluate(() => { const bar = document.getElementById('topBar'); bar.style.maxHeight = ''; bar.scrollTop = 0; });
  const box = await page.locator('#topBar header button').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('#fileMenuPanel').waitFor({ state: 'visible', timeout: 3000 });
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('status bar: no menu, dialog, overlay or the dragged floating keyboard reaches under the status bar (only the top bar itself starts there, padded)', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 411, height: 924 });
  await newDocument(page, '* One\n');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 58, bottom: 0, left: 0, right: 0 } });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(400);
  // every visible element fixed to the screen, other than the top bar, whose top edge is inside the status bar
  const intruders = () => page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || el.id === 'topBar') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.top < 57.5) found.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} top=${Math.round(r.top)}`);
    }
    return found;
  });
  const closeAll = async () => {
    await page.keyboard.press('Escape');
    await page.evaluate(() => { for (const el of document.querySelectorAll('body > div')) { if (el.id !== 'safeAreaProbe' && getComputedStyle(el).position === 'fixed' && el.style.zIndex === '10000' && !el.id.endsWith('Panel')) el.remove(); } });
    await page.evaluate(() => { for (const id of ['capturePanel', 'doneNotePanel', 'refilePanel']) document.getElementById(id).style.display = 'none'; });
    await page.waitForTimeout(150);
  };
  const states = {
    'the command palette (More > Commands)': async () => { await page.click('#moreBtn'); await pick(page, '#morePanel', 'Commands'); },
    'the More menu': async () => { await page.click('#moreBtn'); },
    'the File menu': async () => { await page.click('#fileMenuBtn'); },
    'the View menu': async () => { await page.click('#viewMenuBtn'); },
    'the capture template list': async () => { await page.evaluate(async () => (await import('/src-browser/launch-params.js')).runLaunch({ capture: '', shared: null })); },
    'a capture template form': async () => { await page.evaluate(async () => (await import('/src-browser/launch-params.js')).runLaunch({ capture: 'm', shared: null })); },
    'a text popup': async () => { await page.evaluate(async () => { (await import('/src-browser/dialogs.js')).openTextFieldPopup({ label: 'Edit', value: 'x', onSave() {} }); }); },
    'a confirm dialog': async () => { await page.evaluate(async () => { (await import('/src-browser/dialogs.js')).confirmDialog('Delete this?'); }); }, // not returned: its promise waits for an answer, and evaluate would wait too
    'the date picker popup': async () => { await page.evaluate(async () => { (await import('/src-browser/dialogs.js')).openTimestampPickerPopup({ active: true, hasTime: false }); }); },
    'a TALL dialog (forty choices: it fills the screen)': async () => { await page.evaluate(async () => { (await import('/src-browser/dialogs.js')).openButtonChoiceModal({ label: 'Pick one', buttons: Array.from({ length: 40 }, (_, n) => ({ text: 'Choice ' + n, onClick() {} })) }); }); },
    'the god-mode hint card': async () => { await page.click('#godModeBtn'); await page.keyboard.press('g'); },
  };
  for (const [name, open] of Object.entries(states)) {
    await open();
    await page.waitForTimeout(450);
    const bad = await intruders();
    expect(bad.length === 0, `${name}: nothing starts inside the status bar${bad.length ? ': ' + bad.join(', ') : ''}`);
    await closeAll();
  }

  // the floating keyboard can be dragged anywhere, but not under the status bar
  const fk = page.locator('#floatingKeyboard');
  if (!(await fk.isVisible())) await page.click('#godModeBtn'); // the last state may have left god-mode on: a click would turn it off
  await fk.waitFor({ state: 'visible', timeout: 5000 });
  const handle = await fk.locator('[data-fk-handle]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 5, -400, { steps: 10 }); // as far up as the pointer goes
  await page.mouse.up();
  const top = (await fk.boundingBox()).y;
  expect(top >= 57.5, `dragged as high as it goes, the floating keyboard stops below the status bar (top ${Math.round(top)}, needs 58)`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('floating keyboard: its key lowers a keyboard that shrinks the whole WINDOW (an Android WebView) as well as one that shrinks only the visual viewport', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 360, height: 740 });
  await newDocument(page, '* One\n');
  const fk = page.locator('#floatingKeyboard');
  const key = fk.locator('[data-fk-keyboard]');
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.click('#godModeBtn');
  await fk.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);

  // the keyboard comes up by shrinking the window itself: the visual viewport shrinks WITH it, so the old inset test sees nothing
  await page.setViewportSize({ width: 360, height: 440 });
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => ({ lift: parseFloat(document.getElementById('modelineBar').style.bottom) || 0, same: window.visualViewport.height === window.innerHeight }));
  expect(seen.lift === 0 && seen.same, `precondition: the visual viewport tracks the window, so the mode-line lift is 0: ${JSON.stringify(seen)}`);
  expect((await key.getAttribute('aria-pressed')) === 'true', 'the key is lit while the window is shrunk by the keyboard');
  expect((await activeId()) === 'godModeKeyboardInput', 'and the field has focus');

  await key.click();
  expect((await activeId()) !== 'godModeKeyboardInput', 'tapping it lowers the keyboard (the field lets go of focus) instead of raising it again');
  await page.setViewportSize({ width: 360, height: 740 }); // the OS lowers it
  await page.waitForTimeout(500);
  expect((await key.getAttribute('aria-pressed')) === 'false', 'and the key goes dark');

  await key.click();
  expect((await activeId()) === 'godModeKeyboardInput', 'tapping it again raises the keyboard');

  // rotating the phone changes the window too, but it is not a keyboard
  await page.evaluate(() => document.getElementById('godModeKeyboardInput').focus());
  await page.setViewportSize({ width: 740, height: 360 });
  await page.waitForTimeout(500);
  expect((await key.getAttribute('aria-pressed')) === 'false', 'a rotation (a new width) is not read as a keyboard');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('god-mode: h SPC a (C-h a, apropos-command) opens the command palette, as g x (M-x) does, and the hint card names it', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* One\n');
  const enterGodMode = async () => {
    await page.locator('body').click({ position: { x: 200, y: 850 } });
    await page.keyboard.press('Escape');
    if (!(await page.locator('#minibuffer').innerText()).includes('God-mode')) await page.keyboard.press('Escape');
  };
  await enterGodMode();
  await page.keyboard.press('h');
  await page.locator('#godModeHints').waitFor({ state: 'visible', timeout: 3000 });
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  const hinted = await page.locator('#godModeHints [data-hint-key="a"]').first().innerText();
  expect(/palette/i.test(hinted), `after h SPC the card offers a for the command palette: ${hinted}`);
  await page.keyboard.press('a');
  await page.locator('#command-palette').waitFor({ state: 'visible', timeout: 3000 });
  expect(true, 'the palette is open');
  await page.keyboard.press('Escape');
  await page.locator('#command-palette').waitFor({ state: 'hidden', timeout: 3000 });

  await enterGodMode();
  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await page.locator('#command-palette').waitFor({ state: 'visible', timeout: 3000 });
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('native shell: a share queued before the app was ready, and one that arrives later, both reach Capture with what was shared', async () => {
  const { context, page, errors } = await freshPage(main, {
    initScript: () => {
      // what native-platform.js does before the app starts: queue, and offer the function the shell calls
      window.orgPwaLaunchQueue = [{ title: 'Early', text: 'shared before the app was ready' }];
      window.orgPwaLaunch = (payload) => window.orgPwaLaunchQueue.push(payload);
    },
  });
  await page.locator('#capturePanel').waitFor({ state: 'visible', timeout: 6000 });
  const shared = () => page.evaluate(async () => { const { S } = await import('/src-browser/app-state.js'); return S.captureShared; });
  const first = await shared();
  expect(first && first.text === 'shared before the app was ready' && first.title === 'Early', `the queued share opened Capture with it: ${JSON.stringify(first)}`);
  expect((await page.evaluate(() => window.orgPwaLaunchQueue.length)) === 0, 'and the queue was emptied');

  await page.evaluate(() => { document.getElementById('capturePanel').querySelector('button').scrollIntoView(); });
  await page.locator('#capturePanel button', { hasText: 'Close' }).first().click();
  await page.locator('#capturePanel').waitFor({ state: 'hidden', timeout: 3000 });
  await page.evaluate(() => window.orgPwaLaunch({ text: 'a second share', url: 'https://example.com/later' }));
  await page.locator('#capturePanel').waitFor({ state: 'visible', timeout: 4000 });
  const second = await shared();
  expect(second && second.text === 'a second share' && second.url === 'https://example.com/later', `a later share is run at once: ${JSON.stringify(second)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('capture shortcuts: a launcher platform gets one shortcut per capture template at startup and again when the templates change, and "Add a capture icon" pins the one chosen', async () => {
  const { context, page, errors } = await freshPage(main, {
    initScript: () => {
      window.__sets = [];
      window.__pins = [];
      window.orgPwaPlatform = {
        name: 'fake-android',
        captureShortcuts: {
          supported: () => true,
          set: async (list) => { window.__sets.push(JSON.parse(JSON.stringify(list))); },
          canPin: async () => true,
          pin: async (choice) => { window.__pins.push(JSON.parse(JSON.stringify(choice))); return true; },
        },
      };
    },
  });
  await page.waitForFunction(() => window.__sets.length >= 1, null, { timeout: 6000 });
  const first = await page.evaluate(() => window.__sets[0]);
  expect(Array.isArray(first) && first.length > 0 && first.every((x) => typeof x.key === 'string' && x.key && typeof x.label === 'string' && x.label), `at startup: one {key, label} per template: ${JSON.stringify(first).slice(0, 160)}`);

  // edit the templates in Settings: the launcher's list follows
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  const section = page.locator('.settings-section', { has: page.locator('.panel-section-title', { hasText: 'Capture Templates' }) });
  const current = await section.locator('textarea').first().inputValue();
  const two = JSON.parse(current).slice(0, 2).map((t, n) => ({ ...t, key: ['x', 'y'][n], description: ['Alpha', 'Beta'][n] }));
  await section.locator('textarea').first().focus();
  const popup = page.locator('textarea').last();
  await popup.fill(JSON.stringify(two));
  await popup.locator("xpath=ancestor::div[@class='panel'][1]").getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction(() => window.__sets.length >= 2, null, { timeout: 5000 });
  const after = await page.evaluate(() => window.__sets[window.__sets.length - 1]);
  expect(JSON.stringify(after) === JSON.stringify([{ key: 'x', label: 'Alpha' }, { key: 'y', label: 'Beta' }]), `after the edit: ${JSON.stringify(after)}`);

  // put an icon for one on the home screen
  await page.keyboard.press('Escape');
  await openPalette(page);
  await page.keyboard.type('add a capture icon');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Beta', exact: true }).waitFor({ state: 'visible', timeout: 4000 });
  const offered = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).filter((t) => /Capture \(the template list\)|Alpha|Beta/.test(t)));
  expect(JSON.stringify(offered) === JSON.stringify(['Capture (the template list)', 'Alpha', 'Beta']), `the template list and each template are offered: ${JSON.stringify(offered)}`);
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await page.waitForFunction(() => window.__pins.length === 1, null, { timeout: 3000 });
  expect(JSON.stringify(await page.evaluate(() => window.__pins[0])) === JSON.stringify({ key: 'y', label: 'Beta' }), 'the launcher is asked to pin that template');
  expect((await page.locator('#minibuffer').innerText()).includes('Asked the launcher'), 'and the status says so');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('capture shortcuts: a launcher that refuses them is reported in the status line (not hidden), and the app carries on', async () => {
  const { context, page, errors } = await freshPage(main, {
    initScript: () => {
      window.orgPwaPlatform = {
        name: 'fake-android',
        captureShortcuts: { supported: () => true, set: async () => { throw new Error('the launcher said no'); }, canPin: async () => false, pin: async () => false, info: async () => ({ max: 4 }) },
      };
    },
  });
  await page.waitForFunction(() => document.getElementById('status').innerText.includes('Launcher shortcuts could not be published: the launcher said no'), null, { timeout: 6000 });
  expect(!!(await page.locator('#moreBtn').isVisible()), 'and the app still works');
  const recorded = await page.evaluate(async () => (await import('/src-browser/app-state.js')).S.captureShortcutsResult);
  expect(recorded && recorded.ok === false && recorded.error === 'the launcher said no', `the outcome is recorded for the report: ${JSON.stringify(recorded)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attachments: opening one hands it to the platform, and the status says honestly when the platform has nothing to show it with', async () => {
  dav.reset({ 'notes.org': '* Report\n:PROPERTIES:\n:ID: att-test-1\n:END:\n[[attachment:doc.pdf]]\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const stored = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { resolveAttachmentTarget } = await import('/src/link-resolve.js');
    return resolveAttachmentTarget(S.state.doc, S.state.doc.children[0], 'attachment:doc.pdf', S.state.documentId);
  });
  dav.set(stored, '%PDF-1.4 fake attachment'); // where the app will look for it
  const open = () => page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachmentLink } = await import('/src-browser/attachments-flow.js');
    await openAttachmentLink('attachment:doc.pdf', S.state.doc.children[0]);
  });
  const status = () => page.locator('#minibuffer').innerText();

  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    window.__viewed = [];
    installPlatform({ viewFile: async (blob, name) => { window.__viewed.push({ name, type: blob.type, size: blob.size }); } });
  });
  await open();
  const viewed = await page.evaluate(() => window.__viewed);
  expect(viewed.length === 1 && viewed[0].name === 'doc.pdf' && viewed[0].type === 'application/pdf' && viewed[0].size === 24, `the platform was handed the file: ${JSON.stringify(viewed)}`);
  expect((await status()).includes('Opened "doc.pdf"'), `and the status says it opened: ${await status()}`);

  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    installPlatform({ viewFile: async () => { throw new Error('No app on this phone can open doc.pdf'); } });
  });
  await open();
  const failed = await status();
  expect(failed.includes('Couldn\'t open "doc.pdf": No app on this phone can open doc.pdf') && !failed.includes('Opened "doc.pdf"'), `a platform with nothing to show it with is reported, not claimed as opened: ${failed}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('settings: on a platform with no service worker, Updates shows the platform\u2019s own version, offers nothing to check, and says how the app is updated', async () => {
  const { context, page, errors } = await freshPage(main, {
    initScript: () => { window.orgPwaPlatform = { name: 'fake-android', usesServiceWorker: false, versionInfo: async () => 'v999 (app 9.9.9)' }; },
  });
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  const section = page.locator('.settings-section', { has: page.locator('.panel-section-title', { hasText: 'Updates' }) });
  await section.getByText('Version: v999 (app 9.9.9)').waitFor({ state: 'visible', timeout: 5000 });
  expect(await section.getByRole('button', { name: 'Check for updates' }).isDisabled(), 'the Check for updates button is there, but disabled (there is nothing for it to check)');
  expect((await section.innerText()).includes('This app is updated by installing a newer version of it.'), 'and the section says how the app is updated');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('settings: with a service worker the Updates section is unchanged (the version from the worker, the button enabled)', async () => {
  const { context, page, errors } = await freshPage(main, { serviceWorkers: 'allow' });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'load' }); // the worker controls the page from its second load
  await page.waitForTimeout(1500);
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  const section = page.locator('.settings-section', { has: page.locator('.panel-section-title', { hasText: 'Updates' }) });
  await section.getByText(/^Version: org-pwa-shell-v\d+/).waitFor({ state: 'visible', timeout: 6000 });
  expect(!(await section.getByRole('button', { name: 'Check for updates' }).isDisabled()), 'the button is enabled');
  expect(!(await section.innerText()).includes('installing a newer version'), 'and there is no APK message');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attachments on a LOCAL document: refused with a pointer before a folder is chosen, the folder is asked for once, backing out is silent, and attach, open and delete then go through that folder', async () => {
  const { context, page, errors } = await freshPage();
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    const files = new Map([['phone.org', '* Report\nbody\n']]);
    const tree = { name: null, files: new Map() };
    window.__log = [];
    window.__viewed = [];
    window.__backOut = false;
    installPlatform({
      localFiles: {
        supported: () => true,
        pickOpen: async () => 'phone.org',
        pickNew: async (kv, name) => name,
        adapter: { async read(id) { return files.has(id) ? { content: files.get(id), hash: 'h' } : null; }, async write(id, content) { files.set(id, content); return { hash: 'h' }; }, async exists(id) { return files.has(id); }, async access() { return 'granted'; } },
      },
      attachments: {
        supported: () => true,
        folder: async () => (tree.name ? { name: tree.name } : null),
        pickFolder: async () => { window.__log.push('pickFolder'); if (window.__backOut) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } tree.name = 'Notes'; return { name: 'Notes' }; },
        adapter: {
          readBinary: async (path) => { window.__log.push('read ' + path); return tree.files.has(path) ? { base64: tree.files.get(path) } : null; },
          writeBinary: async (path, base64) => { window.__log.push('write ' + path); tree.files.set(path, base64); },
          delete: async (path) => { window.__log.push('delete ' + path); tree.files.delete(path); },
          list: async (folder) => [...tree.files.keys()].filter((p) => p.startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/')).map((p) => ({ name: p.slice(folder.length + 1), path: p, type: 'file' })),
        },
      },
      viewFile: async (blob, name) => { window.__viewed.push({ name, type: blob.type }); },
    });
  });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  const status = () => page.locator('#minibuffer').innerText();
  const heading = `(await import('/src-browser/app-state.js')).S.state.doc.children[0]`;

  // 1. no folder yet: reading is refused, with the way forward
  await page.evaluate(`(async () => { const { openAttachmentLink } = await import('/src-browser/attachments-flow.js'); await openAttachmentLink('attachment:doc.pdf', ${heading}); })()`);
  expect((await status()).includes('Choose the org-pwa folder first'), `before a folder: ${await status()}`);

  // 2. backing out of the folder picker when attaching is silent: no folder, no error message
  await page.evaluate(() => { window.__backOut = true; });
  await page.evaluate(`(async () => { const { attachFileToHeading } = await import('/src-browser/attachments-flow.js'); await attachFileToHeading(${heading}); })()`);
  expect(!(await status()).includes('Attachments need automatic file-write access'), 'backing out does not show the old "needs GitHub or WebDAV" message');
  expect((await page.evaluate(() => window.__log)).filter((l) => l === 'pickFolder').length === 1, 'the picker was offered');
  await page.evaluate(() => { window.__backOut = false; });

  // 3. attaching: the folder is asked for (once), then the file is written under data/<id prefix>/<rest>/ in it
  const result = await page.evaluate(`(async () => {
    const { ensureAttachmentsStorage } = await import('/src-browser/attachments-store.js');
    const { uploadAttachmentToHeading } = await import('/src-browser/attachments-flow.js');
    const { S } = await import('/src-browser/app-state.js');
    const first = await ensureAttachmentsStorage();
    const second = await ensureAttachmentsStorage();
    const h = S.state.doc.children[0];
    await uploadAttachmentToHeading(h, { name: 'doc.pdf', type: 'application/pdf', base64: 'JVBERi0xLjQ=' });
    return { first, second, folder: S.attachmentsFolder, body: h.bodyLines.join('|'), tags: h.tags.join(','), id: h.properties && h.properties.ID };
  })()`);
  const log = await page.evaluate(() => window.__log);
  expect(result.first === 'ok' && result.second === 'ok' && result.folder === 'Notes', `the folder is chosen once: ${JSON.stringify(result)}`);
  expect(log.filter((l) => l === 'pickFolder').length === 2, 'the picker ran once more for the attach, and not again for the second use (two in all: the backed-out one and the real one)');
  const written = log.find((l) => l.startsWith('write '));
  expect(/^write data\/[^/]{2}\/[^/]+\/doc\.pdf$/.test(written || ''), `written under data/xx/rest/ in the folder: ${written}`);
  expect(result.tags.includes('ATTACH'), `the heading is tagged ATTACH: ${result.tags}`);
  expect(!result.body.includes('attachment:doc.pdf'), `a pdf gets no body link by default (media only): ${result.body}`);

  // 4. opening it reads from the same place and hands the bytes to the platform
  await page.evaluate(`(async () => { const { openAttachmentLink } = await import('/src-browser/attachments-flow.js'); const { S } = await import('/src-browser/app-state.js'); await openAttachmentLink('attachment:doc.pdf', S.state.doc.children[0]); })()`);
  const viewed = await page.evaluate(() => window.__viewed);
  expect(viewed.length === 1 && viewed[0].name === 'doc.pdf' && viewed[0].type === 'application/pdf', `opened through the platform: ${JSON.stringify(viewed)}`);
  expect((await page.evaluate(() => window.__log)).some((l) => l === 'read ' + written.slice(6)), 'after reading the same path from the folder');

  // 5. deleting removes the file from the folder and the link from the heading
  const after = await page.evaluate(`(async () => { const { deleteAttachment } = await import('/src-browser/attachments-flow.js'); const { S } = await import('/src-browser/app-state.js'); const h = S.state.doc.children[0]; await deleteAttachment(h, 'doc.pdf'); return h.bodyLines.join('|'); })()`);
  expect((await page.evaluate(() => window.__log)).includes('delete ' + written.slice(6)), 'the file was deleted from the folder');
  expect(!after.includes('attachment:doc.pdf'), `and the link removed: ${after}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach dispatcher: the list comes from the folder (not from links), the ATTACH tag follows the files, a two-column grid opens with org keys, Open shows text in the app, and Delete all clears files, links and tag', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const made = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { uploadAttachmentToHeading, attachmentFiles } = await import('/src-browser/attachments-flow.js');
    const h = S.state.doc.children[0];
    await uploadAttachmentToHeading(h, { name: 'a.pdf', type: 'application/pdf', base64: 'aGk=' });
    await uploadAttachmentToHeading(h, { name: 'b.png', type: 'image/png', base64: 'aGk=' });
    await uploadAttachmentToHeading(h, { name: 'n.txt', type: 'text/plain', base64: 'aGk=' });
    const tagged = h.tags.join(',');
    const body = h.bodyLines.join('|');
    h.bodyLines = []; // the links are gone, the files are not
    return { tagged, body, names: await attachmentFiles(h) };
  });
  expect(made.tagged.includes('ATTACH'), `tagged ATTACH: ${made.tagged}`);
  expect(made.body.includes('attachment:b.png') && !made.body.includes('attachment:a.pdf') && !made.body.includes('attachment:n.txt'), `default links only the picture: ${made.body}`);
  expect(JSON.stringify(made.names) === JSON.stringify(['a.pdf', 'b.png', 'n.txt']), `listed from the folder, not the body: ${JSON.stringify(made.names)}`);

  // the dispatcher: a two-column grid, org's keys on the buttons when opened from the keyboard
  await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachChoicePrompt } = await import('/src-browser/attachments-flow.js');
    openAttachChoicePrompt(S.state.doc.children[0], { viaKeys: true });
  });
  const grid = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.style.gridTemplateColumns);
    return { columns: el ? getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length : 0, text: document.body.innerText };
  });
  expect(grid.columns === 2, `two columns: ${grid.columns}`);
  for (const label of ['Attach', 'Open', 'Export copy', 'Delete one', 'Delete all', 'Attach open document', 'New text file', 'Folder', 'Sync', 'Set DIR', 'Unset DIR']) expect(grid.text.includes(label), `button "${label}" is there`);

  // Open shows text inside the app (no new tab)
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachmentLink } = await import('/src-browser/attachments-flow.js');
    await openAttachmentLink('attachment:n.txt', S.state.doc.children[0]);
  });
  expect(await page.evaluate(() => [...document.querySelectorAll('pre')].some((p) => p.textContent === 'hi')), 'the text file is shown in the app');
  await page.keyboard.press('Escape');

  // Delete all, by its key, after confirming
  await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachChoicePrompt } = await import('/src-browser/attachments-flow.js');
    openAttachChoicePrompt(S.state.doc.children[0], { viaKeys: true });
  });
  await page.keyboard.press('D');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('Deleted 3 attachments'), null, { timeout: 8000 });
  const left = [...dav.files.keys()].filter((n) => n.startsWith('data/'));
  expect(left.length === 0, `the files are gone from the server: ${left.join(',')}`);
  const tags = await page.evaluate(async () => (await import('/src-browser/app-state.js')).S.state.doc.children[0].tags.join(','));
  expect(!tags.includes('ATTACH'), `and the tag: ${tags}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach phase 2: DIR names the folder, Sync follows the files, the folder panel lists them, a new text file and an open document are attached, and Unset DIR moves the files to the ID folder', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const h = `(await import('/src-browser/app-state.js')).S.state.doc.children[0]`;

  // Set DIR through the dialog: attachments then go to that folder, not to an ID folder
  await page.evaluate(`(async () => { const { setAttachmentDirectory } = await import('/src-browser/attachments-flow.js'); setAttachmentDirectory(${h}); })()`);
  await page.locator('input[type=text]').last().fill('files/report');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForTimeout(500);
  await page.evaluate(`(async () => { const { uploadAttachmentToHeading } = await import('/src-browser/attachments-flow.js'); await uploadAttachmentToHeading(${h}, { name: 'a.pdf', type: 'application/pdf', base64: 'aGk=' }); })()`);
  expect(dav.files.has('files/report/a.pdf'), `written under the DIR folder: ${[...dav.files.keys()].join(',')}`);
  expect(![...dav.files.keys()].some((n) => n.startsWith('data/')), 'and no ID folder was made');

  // a file added by other means is found, and Sync sets the tag
  dav.set('files/report/b.txt', 'by hand');
  const synced = await page.evaluate(`(async () => { const { syncAttachments, attachmentFiles } = await import('/src-browser/attachments-flow.js'); const h = ${h}; h.tags = []; await syncAttachments(h); return { tags: h.tags.join(','), names: await attachmentFiles(h) }; })()`);
  expect(synced.tags === 'ATTACH' && synced.names.join(',') === 'a.pdf,b.txt', `sync: ${JSON.stringify(synced)}`);

  // the folder panel lists both with their buttons
  await page.evaluate(`(async () => { const { revealAttachmentFolder } = await import('/src-browser/attachments-flow.js'); await revealAttachmentFolder(${h}); })()`);
  await page.waitForFunction(() => document.body.innerText.includes('b.txt'), null, { timeout: 5000 });
  const panelText = await page.evaluate(() => document.body.innerText);
  expect(panelText.includes('Folder \u2014 files/report') && panelText.includes('a.pdf') && panelText.includes('Open') && panelText.includes('Delete'), 'the folder panel lists the files with their actions');
  await page.keyboard.press('Escape');

  // a new text file, made from a name and its contents
  await page.evaluate(`(async () => { const { attachNewTextFile } = await import('/src-browser/attachments-flow.js'); attachNewTextFile(${h}); })()`);
  await page.locator('input[type=text]').last().fill('todo.txt');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.locator('textarea').last().fill('buy milk');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('todo.txt'), null, { timeout: 5000 });
  expect(dav.get('files/report/todo.txt') === 'buy milk', `the new file has its text: ${dav.get('files/report/todo.txt')}`);

  // an open document is attached as text (with one tab open, at once)
  await page.evaluate(`(async () => { const { attachOpenDocument } = await import('/src-browser/attachments-flow.js'); await attachOpenDocument(${h}); })()`);
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('notes.org'), null, { timeout: 5000 });
  expect((dav.get('files/report/notes.org') || '').includes('* Report'), 'the open document is in the folder as text');

  // Unset DIR with files: choose to move them to the ID folder
  await page.evaluate(`(async () => { const { unsetAttachmentDirectory } = await import('/src-browser/attachments-flow.js'); await unsetAttachmentDirectory(${h}); })()`);
  await page.getByText('Move them to the ID folder', { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('Moved'), null, { timeout: 8000 });
  const keys = [...dav.files.keys()];
  const moved = keys.filter((n) => /^data\/[^/]{2}\/[^/]+\//.test(n)).map((n) => n.split('/').pop()).sort().join(',');
  expect(moved === 'a.pdf,b.txt,notes.org,todo.txt', `all four moved to the ID folder: ${keys.join(',')}`);
  expect(!keys.some((n) => n.startsWith('files/report/')), 'and none left in the old folder');
  const after = await page.evaluate(`(async () => { const h = ${h}; return { dir: h.properties.DIR === undefined, tags: h.tags.join(',') }; })()`);
  expect(after.dir && after.tags.includes('ATTACH'), `DIR is gone and the heading is still tagged: ${JSON.stringify(after)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach on a desktop or Chromebook: Attach offers a file, a photo or a video; the in-app camera takes a photo and records a video, and each is attached under a dated name', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const h = `(await import('/src-browser/app-state.js')).S.state.doc.children[0]`;
  const open = () => page.evaluate(`(async () => { const { attachFileToHeading } = await import('/src-browser/attachments-flow.js'); attachFileToHeading(${h}); })()`);
  await open();
  await page.waitForFunction(() => document.body.innerText.includes('Take a photo'), null, { timeout: 5000 });
  const menu = await page.evaluate(() => document.body.innerText);
  expect(menu.includes('Choose a file') && menu.includes('Take a photo') && menu.includes('Record a video'), 'Attach offers file, photo and video here');

  // photo
  await page.getByText('Take a photo', { exact: false }).first().click();
  await page.getByRole('button', { name: /Take photo/ }).click();
  await page.getByRole('button', { name: /Attach/ }).click();
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('Attached "photo-'), null, { timeout: 8000 });
  // video
  await open();
  await page.waitForFunction(() => document.body.innerText.includes('Record a video'), null, { timeout: 5000 });
  await page.getByText('Record a video', { exact: false }).first().click();
  await page.getByRole('button', { name: /Record/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.getByRole('button', { name: /Attach/ }).click();
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('Attached "video-'), null, { timeout: 8000 });
  const names = [...dav.files.keys()].filter((n) => n.startsWith('data/')).map((n) => n.split('/').pop()).sort();
  expect(names.length === 2 && /^photo-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/.test(names[0]) && /^video-\d{4}-\d{2}-\d{2}-\d{6}\.webm$/.test(names[1]), `stored under dated names: ${names.join(',')}`);
  expect(dav.get([...dav.files.keys()].find((n) => n.endsWith('.jpg'))).length > 100, 'and the photo has content');
  expect(await page.evaluate(() => !document.querySelector('video')), 'the camera panel is gone and the camera released');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach menu opened by tapping shows the same key badges as from god-mode, without raising a phone keyboard', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  const r = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachChoicePrompt } = await import('/src-browser/attachments-flow.js');
    openAttachChoicePrompt(S.state.doc.children[0]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const keys = [...document.querySelectorAll('span')].filter((el) => el.style.fontFamily === 'monospace').map((el) => el.textContent).join('');
    return { keys, typing: !!document.querySelector('input[aria-label="Press a key"]') };
  });
  expect(r.keys === 'arbnofdDsSez'.split('').sort().join('') || [...'arbnofdDsSez'].every((k) => r.keys.includes(k)), `badges: ${r.keys}`);
  expect(!r.typing, 'no hidden typing field when tapped');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach size guard: a large video asks before it is attached, and declining attaches nothing', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  // a file over 95MB on GitHub is refused outright; here (WebDAV) only the confirmation applies, and declining attaches nothing
  const declined = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { uploadAttachmentToHeading } = await import('/src-browser/attachments-flow.js');
    const h = S.state.doc.children[0];
    const pending = uploadAttachmentToHeading(h, { name: 'big.mp4', type: 'video/mp4', base64: 'A'.repeat(40 * 1024 * 1024) });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const asked = document.body.innerText.includes('Attach it?');
    return { asked, pending: !!pending };
  });
  expect(declined.asked, 'a 30MB video asks before it is attached');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(400);
  expect(![...dav.files.keys()].some((n) => n.endsWith('big.mp4')), 'declining attaches nothing');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach dispatcher: opened from the keyboard it reads typed text the way an Android keyboard delivers it (an input event, no keydown letter)', async () => {
  dav.reset({ 'notes.org': '* Report\n' });
  const { context, page, errors } = await freshPage(main, { withDav: true });
  await openDav(page, 'notes.org');
  await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { openAttachChoicePrompt } = await import('/src-browser/attachments-flow.js');
    openAttachChoicePrompt(S.state.doc.children[0], { viaKeys: true });
  });
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Press a key'), 'the hidden field has the focus, so the phone keyboard types into it');
  await page.keyboard.insertText('o'); // what Gboard does: beforeinput/input insertText, no keydown with the letter
  await page.waitForFunction(() => document.getElementById('minibuffer').innerText.includes('No attachments on this heading yet'), null, { timeout: 5000 });
  expect(!(await page.evaluate(() => document.body.innerText.includes('Attach open document'))), 'and the dispatcher closed after the key ran its button');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attach: a platform that supplies its own picker (the camera beside the files) is used instead of the browser\u2019s file input; without one the browser\u2019s input is used', async () => {
  const { context, page, errors } = await freshPage();
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    const tree = new Map();
    window.__tree = tree;
    installPlatform({
      localFiles: { supported: () => true, pickOpen: async () => 'phone.org', pickNew: async (kv, n) => n, adapter: { async read() { return { content: '* Report\n', hash: 'h' }; }, async write() { return { hash: 'h' }; }, async exists() { return true; }, async access() { return 'granted'; } } },
      attachments: { supported: () => true, folder: async () => ({ name: 'org-pwa' }), pickFolder: async () => ({ name: 'org-pwa' }), adapter: { readBinary: async () => null, writeBinary: async (path, base64) => { tree.set(path, base64); }, delete: async () => {}, exists: async () => false, list: async () => [] } },
      pickFile: async () => ({ name: 'shot.png', type: 'image/png', base64: 'iVBORw0KGgo=' }),
    });
    (await import('/src-browser/app-state.js')).S.attachmentsFolder = 'org-pwa';
  });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  const outcome = await page.evaluate(async () => {
    const { S } = await import('/src-browser/app-state.js');
    const { attachFileToHeading } = await import('/src-browser/attachments-flow.js');
    const heading = S.state.doc.children[0];
    const pending = attachFileToHeading(heading); // never awaited: without the hook it would wait on a file input for ever
    await new Promise((resolve) => setTimeout(resolve, 700));
    const written = [...window.__tree.entries()];
    return { inputs: document.querySelectorAll('input[type=file]').length, written, body: heading.bodyLines.join('|'), pending: !!pending };
  });
  expect(outcome.inputs === 0, `no browser file input was opened: ${outcome.inputs}`);
  expect(outcome.written.length === 1 && /^data\/[^/]{2}\/[^/]+\/shot\.png$/.test(outcome.written[0][0]) && outcome.written[0][1] === 'iVBORw0KGgo=', `the platform's file was attached: ${JSON.stringify(outcome.written)}`);
  expect(outcome.body.includes('attachment:shot.png'), `and linked: ${outcome.body}`);

  // with no picker of its own the browser's input is what opens
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    installPlatform({ pickFile: null });
    // a phone's own chooser has the camera, so only a desktop browser gets the in-app camera menu; look like a phone here
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', configurable: true });
    const { S } = await import('/src-browser/app-state.js');
    const { attachFileToHeading } = await import('/src-browser/attachments-flow.js');
    attachFileToHeading(S.state.doc.children[0]);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  expect((await page.evaluate(() => document.querySelectorAll('input[type=file]').length)) === 1, 'without pickFile the browser\u2019s own file input opens, as it always did');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('attachments on a local document where the platform has no folder support (a browser): unavailable, with the explanation it always had', async () => {
  const { context, page, errors } = await freshPage();
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    installPlatform({ localFiles: { supported: () => true, pickOpen: async () => 'phone.org', pickNew: async (kv, n) => n, adapter: { async read(id) { return { content: '* Report\n', hash: 'h' }; }, async write() { return { hash: 'h' }; }, async exists() { return true; }, async access() { return 'granted'; } } } });
  });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  const outcome = await page.evaluate(async () => {
    const { ensureAttachmentsStorage } = await import('/src-browser/attachments-store.js');
    const { attachFileToHeading } = await import('/src-browser/attachments-flow.js');
    const { S } = await import('/src-browser/app-state.js');
    const storage = await ensureAttachmentsStorage();
    await attachFileToHeading(S.state.doc.children[0]);
    return storage;
  });
  expect(outcome === 'unavailable', `nothing can hold attachments here: ${outcome}`);
  expect((await page.locator('#minibuffer').innerText()).includes('Attachments need automatic file-write access'), 'and the usual explanation is shown');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('saving a file out: the status says where it went when the platform reports it, says why when it fails, stays quiet if the person backs out, and a browser (which reports nothing) stays quiet too', async () => {
  const { context, page, errors } = await freshPage();
  const exportSettings = async () => {
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Settings');
    await page.getByRole('button', { name: 'Export Settings' }).click();
    await page.waitForTimeout(500);
  };
  const status = () => page.locator('#minibuffer').innerText();
  const useSaveFile = (body) => page.evaluate(async (src) => {
    const { installPlatform } = await import('/src-browser/platform.js');
    installPlatform({ saveFile: new Function('return (' + src + ')')() });
  }, body);

  await useSaveFile('async () => ({ where: "Downloads" })');
  await exportSettings();
  expect((await status()).includes('Saved \u201corg-pwa-settings.json\u201d to Downloads.'), `it says where: ${await status()}`);

  await page.evaluate(async () => { const { setStatus } = await import('/src-browser/editing.js'); setStatus('untouched'); });
  await useSaveFile('async () => { throw new Error("disk full"); }');
  await exportSettings();
  expect((await status()).includes('Couldn\'t save \u201corg-pwa-settings.json\u201d: disk full'), `it says why it failed: ${await status()}`);

  await page.evaluate(async () => { const { setStatus } = await import('/src-browser/editing.js'); setStatus('untouched'); });
  await useSaveFile('async () => null');
  await exportSettings();
  expect(!(await status()).includes('Saved') && !(await status()).includes('Couldn'), `backing out says nothing about saving: ${await status()}`);

  await page.evaluate(async () => { const { setStatus } = await import('/src-browser/editing.js'); setStatus('untouched'); });
  await useSaveFile('() => {}'); // what a browser's download does: nothing to report
  await exportSettings();
  expect(!(await status()).includes('Saved') && !(await status()).includes('Couldn'), `a platform that reports nothing adds nothing: ${await status()}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('local: resolves in the org-pwa folder wherever a scheme is accepted: org-agenda-files, org-contacts-files, org-refile-targets, a capture template\u2019s file, a link and #+INCLUDE, with the right message when there is no folder or the file is not in it', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 412, height: 900 });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `<${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}>`;
  const phone = ['* Main', '# Local Variables:', '# org-agenda-files: local:agenda.org', '# org-contacts-files: local:contacts.org', '# org-refile-targets: local:inbox.org level=1', '# End:', ''].join('\n');
  await page.evaluate(async ({ phone, stamp }) => {
    const { installPlatform } = await import('/src-browser/platform.js');
    const picked = new Map([['phone.org', phone]]); // the one file opened through the picker
    const tree = new Map([
      ['agenda.org', `* TODO Folder task\nSCHEDULED: ${stamp}\n`],
      ['contacts.org', '* Alex Example\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:END:\n'],
      ['inbox.org', '* Inbox\n'],
      ['included.org', 'Text from the folder\n'],
    ]);
    const enc = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
    const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    window.__tree = tree;
    window.__folder = null;
    installPlatform({
      localFiles: {
        supported: () => true,
        pickOpen: async () => 'phone.org',
        pickNew: async (kv, name) => name,
        adapter: {
          async read(id) { return picked.has(id) ? { content: picked.get(id), hash: 'h' } : null; },
          async write(id, content) { picked.set(id, content); return { hash: 'h' }; },
          async exists(id) { return picked.has(id); },
          async access(id) { return picked.has(id) ? 'granted' : 'none'; },
        },
      },
      attachments: {
        supported: () => true,
        folder: async () => (window.__folder ? { name: window.__folder } : null),
        pickFolder: async () => { window.__folder = 'org-pwa'; return { name: 'org-pwa' }; },
        adapter: {
          readBinary: async (path) => (tree.has(path) ? { base64: enc(tree.get(path)) } : null),
          writeBinary: async (path, base64) => { tree.set(path, dec(base64)); },
          delete: async (path) => { tree.delete(path); },
          exists: async (path) => tree.has(path),
          list: async (folder) => [...tree.keys()].filter((p) => p.startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/')).map((p) => ({ name: p.slice(folder.length + 1), path: p, type: 'file' })),
        },
      },
    });
  }, { phone, stamp });
  await fileMenu(page, 'Open', 'Local file');
  await page.waitForFunction(() => document.getElementById('modelineBar').innerText.includes('phone.org'), null, { timeout: 8000 });
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // 1. no folder chosen yet: the agenda says so, and names the way forward
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(1200);
  let t = await bodyText();
  expect(t.includes('no org-pwa folder is chosen') && t.includes('Choose the org-pwa folder'), `with no folder: ${t.slice(0, 260)}`);

  // 2. a folder is chosen, but the file is not in it: the message names the folder
  await page.evaluate(async () => {
    window.__tree.delete('agenda.org');
    const { chooseAttachmentsFolder } = await import('/src-browser/attachments-store.js');
    await chooseAttachmentsFolder();
    const { ensureAgendaFilesLoaded } = await import('/src-browser/agenda-files.js');
    const { agendaFilesCache } = await import('/src-browser/singletons.js');
    agendaFilesCache.clear();
    ensureAgendaFilesLoaded();
  });
  await page.waitForTimeout(800);
  t = await bodyText();
  expect(t.includes('isn\'t in the org-pwa folder "org-pwa"'), `with a folder but no file: ${t.slice(0, 260)}`);

  // 3. org-agenda-files: the file is there now, and the agenda shows it
  await page.evaluate(async ({ stamp }) => {
    window.__tree.set('agenda.org', `* TODO Folder task\nSCHEDULED: ${stamp}\n`);
    const { ensureAgendaFilesLoaded } = await import('/src-browser/agenda-files.js');
    const { agendaFilesCache } = await import('/src-browser/singletons.js');
    agendaFilesCache.clear();
    ensureAgendaFilesLoaded();
  }, { stamp });
  await page.waitForFunction(() => document.body.innerText.includes('Folder task'), null, { timeout: 8000 });
  expect(true, 'org-agenda-files: local:agenda.org is read from the folder');

  // 4. org-contacts-files
  const contacts = await page.evaluate(async () => {
    const { syncContactsFilesConfig, ensureContactsFilesLoadedAndWait } = await import('/src-browser/agenda-files.js');
    const { contactsFilesCache } = await import('/src-browser/singletons.js');
    syncContactsFilesConfig();
    await ensureContactsFilesLoadedAndWait();
    return [...contactsFilesCache.entries()].map(([k, e]) => ({ key: k, hasDoc: !!e.doc, error: e.error || null, title: e.doc && e.doc.children[0] && e.doc.children[0].title }));
  });
  expect(contacts.length === 1 && contacts[0].hasDoc && contacts[0].title === 'Alex Example', `org-contacts-files: local:contacts.org is read from the folder: ${JSON.stringify(contacts)}`);

  // 5. org-refile-targets
  const refile = await page.evaluate(async () => {
    const { parseRefileTargetsWithErrors } = await import('/src/refile.js');
    const { loadRefileTargetDocs } = await import('/src-browser/refile-flow.js');
    const { entries, errors } = parseRefileTargetsWithErrors('local:inbox.org level=1');
    const docs = await loadRefileTargetDocs(entries);
    return { errors: errors.length, ids: Object.keys(docs) };
  });
  expect(refile.errors === 0 && refile.ids.includes('inbox.org'), `org-refile-targets: local:inbox.org is loaded as a target: ${JSON.stringify(refile)}`);

  // 6. a capture template's file: into a file in the folder, and into one that does not exist yet (created there)
  const captured = await page.evaluate(async () => {
    const { runCaptureWithAnswers } = await import('/src-browser/capture-ui.js');
    await runCaptureWithAnswers({ key: 'z', description: 'Z', type: 'item', olp: ['Inbox'], template: 'Captured into the folder', file: 'local:inbox.org', emptyLines: 0 }, []);
    await runCaptureWithAnswers({ key: 'y', description: 'Y', type: 'item', olp: ['Fresh'], template: 'Into a new file', file: 'local:fresh.org', emptyLines: 0 }, []);
    return { inbox: window.__tree.get('inbox.org') || null, fresh: window.__tree.get('fresh.org') || null };
  });
  expect(captured.inbox && captured.inbox.includes('Captured into the folder'), `a capture template with file: local:inbox.org writes into the folder: ${JSON.stringify(captured.inbox)}`);
  expect(captured.fresh && captured.fresh.includes('Into a new file'), `and a missing file is created there: ${JSON.stringify(captured.fresh)}`);
  const mismatch = await page.evaluate(async () => {
    const { runCaptureWithAnswers } = await import('/src-browser/capture-ui.js');
    await runCaptureWithAnswers({ key: 'g', description: 'G', type: 'item', olp: ['Inbox'], template: 'x', file: 'github:other.org', emptyLines: 0 }, []);
    return document.getElementById('minibuffer').innerText;
  });
  expect(mismatch.includes('targets github, but the currently open document is on a local file'), `another scheme is still refused, now naming the local file: ${mismatch}`);

  // 7. links: the explicit scheme works from a document on another backend (here, one that says it is on WebDAV), and a plain
  //    file: link inside a local document finds the file in the folder too
  const kindAfter = async (link) => page.evaluate(async (link) => {
    const { S } = await import('/src-browser/app-state.js');
    const { openFileLink } = await import('/src-browser/documents-io.js');
    await openFileLink(link);
    return { kind: S.state.storageKind, id: S.state.documentId };
  }, link);
  await page.evaluate(async () => { (await import('/src-browser/app-state.js')).S.state.storageKind = 'webdav'; });
  const viaScheme = await kindAfter({ type: 'file', scheme: 'local', path: 'inbox.org', inFileTarget: null });
  expect(viaScheme.kind === 'filesystem' && viaScheme.id === 'inbox.org', `[[local:inbox.org]] opens the file from the folder even from a WebDAV document: ${JSON.stringify(viaScheme)}`);
  const viaPlain = await kindAfter({ type: 'file', scheme: 'file', path: 'fresh.org', inFileTarget: null });
  expect(viaPlain.kind === 'filesystem' && viaPlain.id === 'fresh.org', `and a plain [[file:fresh.org]] link in a local document finds it in the folder: ${JSON.stringify(viaPlain)}`);
  const included = await page.evaluate(async () => (await (await import('/src-browser/export-import.js')).resolveIncludePath('local:included.org')) || null);
  expect(included && included.content === 'Text from the folder\n', `#+INCLUDE: local:included.org reads it: ${JSON.stringify(included)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('local: without an org-pwa folder (a browser) behaves as it did: only files opened through the picker, and the message says so', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 412, height: 900 });
  await newDocument(page, ['* Main', '# Local Variables:', '# org-agenda-files: local:nothere.org', '# End:', ''].join('\n'));
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(1200);
  const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(t.includes('hasn\'t been opened on this device yet. Open it once with File') && !t.includes('org-pwa folder'), `the browser message is unchanged: ${t.slice(0, 260)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('More > Import lists Contacts (.vcf) and iCalendar (.ics); each opens its own panel, only Contacts has Flat/Tree and Clean data, and Back climbs one level at a time', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Existing\n');
  const panel = async () => (await page.locator('#morePanel').innerText()).replace(/\s+/g, ' ');
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Import');
  let t = await panel();
  expect(t.includes('Contacts (.vcf)') && t.includes('iCalendar (.ics)') && !t.includes('Choose vCard file') && !t.includes('Flat'), `the list: ${t}`);

  await pick(page, '#morePanel', 'Contacts (.vcf)');
  t = await panel();
  expect(t.includes('Import Contacts (.vcf) from:') && t.includes('Flat') && t.includes('Tree') && t.includes('Clean data (Google, Apple)') && t.includes('Choose vCard file') && t.includes('To: *new buffer*') && t.includes('This file'), `the Contacts panel: ${t}`);
  await pick(page, '#morePanel', '\u2039 Back');
  t = await panel();
  expect(t.includes('iCalendar (.ics)') && !t.includes('Choose vCard file'), `Back from Contacts returns to the list: ${t}`);

  await pick(page, '#morePanel', 'iCalendar (.ics)');
  t = await panel();
  expect(t.includes('Import iCalendar (.ics) from:') && t.includes('Choose iCalendar file') && t.includes('To: *new buffer*') && t.includes('Choose a heading') && t.includes('This file'), `the iCalendar panel: ${t}`);
  expect(!t.includes('Flat') && !t.includes('Tree') && !t.includes('Clean data'), `and none of the Contacts-only options: ${t}`);
  expect((await page.locator('#morePanel input[type=file]').getAttribute('accept')) === '.ics,text/calendar', 'it offers calendar files');
  await pick(page, '#morePanel', '\u2039 Back');
  await pick(page, '#morePanel', '\u2039 Back');
  t = await panel();
  expect(t.startsWith('Commands') && t.includes('Import') && t.includes('Export'), `a second Back is the More menu: ${t}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('More > Import > iCalendar (.ics): a file adds its events and tasks to the open document, says what it could not carry over, can go to a new buffer, and reads calendar text from the document itself', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Existing\n* Plain heading\n* Cal\nBEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:From text\nDTSTART;VALUE=DATE:20261012\nEND:VEVENT\nEND:VCALENDAR\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:e1', 'SUMMARY:Dentist', 'DTSTART:20261005T090000', 'DTEND:20261005T100000', 'LOCATION:Main St', 'ATTENDEE:mailto:a@b.c', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Weekly review', 'DTSTART;VALUE=DATE:20261009', 'RRULE:FREQ=WEEKLY;COUNT=4', 'END:VEVENT', 'BEGIN:VTODO', 'SUMMARY:Pay rent', 'DUE;VALUE=DATE:20261031', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
  const docText = () => page.evaluate(async () => (await import('/src/org-parser.js')).serializeOrg((await import('/src-browser/app-state.js')).S.state.doc));
  const status = () => page.locator('#minibuffer').innerText();
  const openPanel = async () => {
    await page.click('#moreBtn');
    await pick(page, '#morePanel', 'Import');
    await pick(page, '#morePanel', 'iCalendar (.ics)');
  };
  const chooseFile = async (name, content) => {
    await page.locator('#morePanel input[type=file]').setInputFiles({ name, mimeType: 'text/calendar', buffer: Buffer.from(content) });
    await page.waitForTimeout(700);
  };

  await openPanel();
  await chooseFile('junk.ics', 'this is not a calendar');
  expect((await status()).includes('No events or tasks found in that file'), `a file with nothing to import says so: ${await status()}`);
  expect(await page.locator('#morePanel').isVisible(), 'and the panel stays open, to try another file');

  await chooseFile('cal.ics', ics);
  let t = await docText();
  expect(t.startsWith('* Existing\n'), `what was there is untouched and first: ${t.slice(0, 60)}`);
  expect(t.includes('* Dentist <2026-10-05 Mon 09:00-10:00>\n:PROPERTIES:\n:UID: e1\n:LOCATION: Main St\n:END:'), `an event, its time in the title and its properties: ${t}`);
  expect(t.includes('* Weekly review <2026-10-09 Fri>\n:PROPERTIES:\n:RRULE: FREQ=WEEKLY;COUNT=4\n:END:'), `a recurrence a repeater cannot say keeps its rule: ${t}`);
  expect(t.includes('* TODO Pay rent\nDEADLINE: <2026-10-31 Sat>'), `a task: ${t}`);
  const said = await status();
  expect(said.includes('Imported 2 events and 1 task from iCalendar.') && said.includes('1 unrecognized property was skipped: ATTENDEE.') && said.includes('1 recurring event could not become a repeater'), `the status says what came and what did not: ${said}`);
  expect(!(await page.locator('#morePanel').isVisible()), 'the menu closes after an import');

  // the imported events are on the agenda, where the timestamp in the title puts them
  await viewMenu(page, 'Agenda');
  await page.waitForTimeout(500);
  expect((await page.locator('body').innerText()).includes('Dentist'), 'and the agenda shows an imported event');
  await viewMenu(page, 'Org');
  await page.waitForTimeout(300);

  // "To: *new buffer*" has its own setting, apart from Contacts'
  await openPanel();
  await page.locator('#morePanel').getByText('To: *new buffer*', { exact: true }).click();
  await chooseFile('cal.ics', ics);
  t = await docText();
  expect(!t.includes('Existing') && t.includes('* Dentist <2026-10-05 Mon 09:00-10:00>'), `to a new buffer: only the imported headings: ${t.slice(0, 120)}`);
  const flags = await page.evaluate(async () => { const { S } = await import('/src-browser/app-state.js'); return [S.importIcalendarToNewBuffer, S.importVcardToNewBuffer]; });
  expect(flags[0] === true && flags[1] === false, `the two new-buffer settings are independent: ${JSON.stringify(flags)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();

  // calendar text kept in the document itself: "This file" and "Choose a heading"
  const second = await freshPage();
  await newDocument(second.page, '* Plain heading\n* Cal\nBEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:From text\nDTSTART;VALUE=DATE:20261012\nEND:VEVENT\nEND:VCALENDAR\n');
  const p2 = second.page;
  const openPanel2 = async () => { await p2.click('#moreBtn'); await pick(p2, '#morePanel', 'Import'); await pick(p2, '#morePanel', 'iCalendar (.ics)'); };
  const doc2 = () => p2.evaluate(async () => (await import('/src/org-parser.js')).serializeOrg((await import('/src-browser/app-state.js')).S.state.doc));
  await openPanel2();
  await pick(p2, '#morePanel', 'Choose a heading\u2026');
  await p2.locator('#morePanel').getByText('Plain heading', { exact: true }).click();
  await p2.waitForTimeout(400);
  expect((await p2.locator('#minibuffer').innerText()).includes('No iCalendar data found in Plain heading'), `a heading with none says so: ${await p2.locator('#minibuffer').innerText()}`);
  await pick(p2, '#morePanel', '\u2039 Back'); // out of the heading list, into the panel
  await pick(p2, '#morePanel', 'This file');
  await p2.waitForTimeout(500);
  expect((await doc2()).includes('* From text <2026-10-12 Mon>'), `"This file" reads the calendar text in the document: ${(await doc2()).slice(-120)}`);
  expect(second.errors.length === 0, `page errors: ${second.errors.join(' | ')}`);
  await second.context.close();
});

check('palette: org-vcard-import and icalendar-import-file open More > Import on the Contacts and iCalendar panels', async () => {
  const { context, page, errors } = await freshPage();
  await newDocument(page, '* Existing\n');
  await openPalette(page);
  await page.keyboard.type('icalendar-import-file');
  let rows = await paletteRows(page);
  expect(rows.length === 1 && rows[0].includes('Import iCalendar (.ics)') && rows[0].includes('Import'), `rows: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  let t = (await page.locator('#morePanel').innerText()).replace(/\s+/g, ' ');
  expect(t.includes('Import iCalendar (.ics) from:') && !t.includes('Flat'), `icalendar-import-file opens the iCalendar panel: ${t}`);
  await page.click('#moreBtn'); // close
  await openPalette(page);
  await page.keyboard.type('org-vcard-import');
  rows = await paletteRows(page);
  expect(rows.length === 1 && rows[0].includes('Import Contacts (.vcf)'), `rows: ${JSON.stringify(rows)}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  t = (await page.locator('#morePanel').innerText()).replace(/\s+/g, ' ');
  expect(t.includes('Import Contacts (.vcf) from:') && t.includes('Flat'), `org-vcard-import opens the Contacts panel: ${t}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('capture shortcuts: in a browser the capture-icon command is dimmed with its reason, and nothing is published', async () => {
  const { context, page, errors } = await freshPage();
  await openPalette(page);
  await page.keyboard.type('add a capture icon');
  const rows = await paletteRows(page);
  expect(rows.some((r) => r.includes('Add a capture icon to the home screen') && r.includes('only in the Android app')), `dimmed with the reason: ${JSON.stringify(rows)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('display measurements: the command reports what the screen and web view give the page, including the status-bar inset and where the bar\u2019s buttons land, and OK copies it', async () => {
  const { context, page, errors } = await freshPage();
  await page.setViewportSize({ width: 360, height: 740 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 32, bottom: 0, left: 0, right: 0 } });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.__copied = null;
  });
  await page.evaluate(async () => {
    const { installPlatform } = await import('/src-browser/platform.js');
    installPlatform({ clipboard: { writeText: async (t) => { window.__copied = t; }, readText: async () => '' } });
  });
  await page.waitForTimeout(300);
  await openPalette(page);
  await page.keyboard.type('display measurements');
  await page.keyboard.press('Enter');
  const box = page.locator('textarea').last();
  await box.waitFor({ state: 'visible', timeout: 4000 });
  const text = await box.inputValue();
  for (const want of ['platform: web', 'devicePixelRatio:', 'window (innerWidth x innerHeight): 360 x 740', 'env(safe-area-inset) top/right/bottom/left: 32px / 0px / 0px / 0px', '--safe-area-inset (injected by Capacitor) top/right/bottom/left: (not set)', 'top bar: padding-top, height: 32px', 'first button: top, height: 40px', 'tab bar: top, height: not shown', 'launcher shortcuts: not available here']) {
    expect(text.includes(want), `the report has "${want}": ${JSON.stringify(text.split('\n').filter((l) => l.split(':')[0] === want.split(':')[0]))}`);
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction(() => window.__copied !== null, null, { timeout: 3000 });
  expect((await page.evaluate(() => window.__copied)) === text, 'OK copies exactly what is shown');
  expect((await page.locator('#minibuffer').innerText()).includes('Display measurements copied'), 'and says so');
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

check('agenda notifications: an appointment inside its warning time gets a system notification and a banner, the mode line counts down, echo uses the status line only, and turning it off clears all of it', async () => {
  const stub = () => {
    window.__shown = [];
    window.Notification = class {
      constructor(title, options) { window.__shown.push({ title, ...options }); }
      static permission = 'granted';
      static requestPermission() { return Promise.resolve('granted'); }
    };
  };
  const { context, page, errors } = await freshPage(main, { initScript: stub });
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const soon = new Date(Date.now() + 8 * 60000);
  const stamp = `<${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())} ${days[soon.getDay()]} ${pad(soon.getHours())}:${pad(soon.getMinutes())}>`;
  await newDocument(page, `* Dentist ${stamp}\nbring the insurance card\n* No time of day <${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())} ${days[soon.getDay()]}>\n`);
  await page.click('#moreBtn');
  await pick(page, '#morePanel', 'Settings');
  await page.waitForFunction(() => document.body.innerText.includes('Show reminders as'), null, { timeout: 8000 });
  const settingsText = await page.evaluate(() => document.body.innerText);
  expect(settingsText.toLowerCase().split('agenda notifications').length >= 3 && settingsText.includes('Warn this many minutes before') && settingsText.includes('Scan agenda files every') && settingsText.includes('Countdown in the mode line') && settingsText.includes('Show reminders as'), `Settings has the Agenda notifications section with its five lines: ${JSON.stringify(settingsText.slice(0, 300))}`);
  await page.waitForFunction(() => document.body.innerText.includes('Notifications: allowed'), null, { timeout: 5000 });
  await page.evaluate(async () => {
    const flow = await import('/src-browser/appt-flow.js');
    await flow.saveApptSettings({ 'appt-activate': true, 'appt-message-warning-time': 10 });
  });
  await page.waitForFunction(() => document.getElementById('apptBanner') && getComputedStyle(document.getElementById('apptBanner')).display !== 'none', null, { timeout: 5000 });
  const bannerTitle = await page.locator('#apptBanner div').first().innerText();
  const bannerDetail = await page.locator('#apptBanner div').nth(1).innerText();
  expect(bannerTitle === 'Dentist', `the banner is titled by the appointment: ${bannerTitle}`);
  expect(/^in [78] min \u00b7 \d\d:\d\d$/.test(bannerDetail), `and says when: ${bannerDetail}`);
  expect(!(bannerTitle + bannerDetail).includes('<'), 'the timestamp is not in the text');
  expect((await page.locator('#apptBanner div').nth(2).innerText()) === 'bring the insurance card', 'the heading body is under the time in the banner');
  const box = await page.locator('#apptBanner').boundingBox();
  expect(box.width > 300 && (await page.locator('#apptBanner div').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 18, `the banner is large: ${Math.round(box.width)}px wide`);
  const shown = await page.evaluate(() => window.__shown);
  expect(shown.length === 1 && shown[0].title === 'Dentist' && shown[0].body === `${bannerDetail}\nbring the insurance card` && shown[0].requireInteraction === true, `one system notification, titled and worded the same, kept until answered: ${JSON.stringify(shown)}`);
  await page.evaluate(async () => { const flow = await import('/src-browser/appt-flow.js'); await flow.scanAppointments(); await flow.scanAppointments(); });
  expect((await page.evaluate(() => window.__shown.length)) === 1, 'a rescan does not announce it again');
  await page.waitForTimeout(2500);
  expect(await page.locator('#apptBanner').isVisible(), 'the banner is still there: it waits to be answered');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  expect(!(await page.locator('#apptBanner').isVisible()), 'Dismiss closes it');
  await page.evaluate(async () => { const { renderModeline } = await import('/src-browser/chrome.js'); renderModeline(); });
  expect(/Appt: [78]m/.test(await modeline(page)), `the mode line counts down: ${await modeline(page)}`);
  // a repeat: with the clock moved on to the next reminder time, it is announced again, replacing (not stacking on) the banner
  await page.evaluate(async () => {
    const flow = await import('/src-browser/appt-flow.js');
    const run = flow.apptRuntime();
    const appt = run.appointments[0];
    run.appointments = [{ ...appt, start: new Date(Date.now() + 6.5 * 60000) }]; // inside the 7 minute reminder, past the 10
    flow.apptTick(new Date());
  });
  await page.waitForFunction(() => window.__shown.length === 2, null, { timeout: 5000 });
  expect((await page.locator('#apptBanner').count()) === 1 && /^in 7 min/.test(await page.locator('#apptBanner div').nth(1).innerText()), 'the next reminder comes at the next interval, in the same banner');
  expect((await page.evaluate(() => window.__shown[1].tag === window.__shown[0].tag)), 'and replaces the system notification for that appointment (the same tag)');
  await page.getByRole('button', { name: 'Open day' }).click();
  await page.waitForTimeout(400);
  expect((await page.evaluate(async () => (await import('/src-browser/app-state.js')).S.currentView)) === 'agenda', 'Open day goes to that day in the agenda');
  await page.evaluate(async () => {
    const flow = await import('/src-browser/appt-flow.js');
    await flow.saveApptSettings({ 'appt-display-format': 'echo' });
    window.__shown.length = 0;
  });
  await page.waitForFunction(() => document.getElementById('status').innerText.includes('Dentist'), null, { timeout: 5000 });
  expect((await page.evaluate(() => window.__shown.length)) === 0, 'in echo mode there is no system notification');
  await page.evaluate(async () => { await (await import('/src-browser/appt-flow.js')).saveApptSettings({ 'appt-activate': false }); const { renderModeline } = await import('/src-browser/chrome.js'); renderModeline(); });
  expect(!(await modeline(page)).includes('Appt:'), 'turning it off clears the countdown');
  const stored = await page.evaluate(async () => { const { kv } = await import('/src-browser/singletons.js'); const r = await kv.get('settings:appt'); return JSON.parse(r && r.value ? r.value : r); });
  expect(stored['appt-activate'] === false && stored['appt-message-warning-time'] === 10 && stored['appt-display-format'] === 'echo', `the settings are stored under the Emacs names: ${JSON.stringify(stored)}`);
  expect(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await context.close();
});

// ---- runner -------------------------------------------------------------------

const filter = process.argv[2];
const matching = filter ? checks.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())) : checks;
// SMOKE_SLICE=0:20 runs only the first twenty of the selected checks (start inclusive, end exclusive), so a long
// suite can be run in parts where one command has a time limit.
const [sliceStart, sliceEnd] = (process.env.SMOKE_SLICE || '').split(':').map((n) => (n === '' || n === undefined ? undefined : Number(n)));
const selected = process.env.SMOKE_SLICE ? matching.slice(sliceStart || 0, sliceEnd) : matching;
if (selected.length === 0) {
  console.error(`no checks match "${filter}"`);
  process.exit(2);
}

const { chromium } = loadPlaywright();
const launchOptions = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
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
