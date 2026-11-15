// Holds the Info reader to Emacs 29.3's info.el: for every node of several manuals (makeinfo fixtures, a split one, a gzipped split
// one, hand-made edge files, and, when they are on this machine, the real manuals in /usr/share/info) the text, pointers, menu
// entries, cross references, what is shown, the completion table, the index nodes, the table of contents, goto, index and search
// answers, and runs of commands. test/fixtures/info-oracle.json was made by tools/gen-info-oracle.mjs; the big manuals are asked of
// Emacs now, and skipped when there is no Emacs or the manual is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { InfoSession, breadcrumbs, tocNodeText } from '../src/info-nav.js';
import { crossReferences, displayNode, extractPointer, menuEntries } from '../src/info-parse.js';
import { apply, buildSpec, askEmacs, loadManual } from '../tools/info-oracle-lib.mjs';
import { INFO_KNOWN } from './support/info-known.js';

const FIXTURES = new URL('./fixtures/info/', import.meta.url).pathname;
const BIG_DIR = '/usr/share/info';
const BIG = ['coreutils', 'texinfo', 'automake-1.16', 'gnupg', 'm4', 'find', 'sed', 'wget'];
const quotes = (s) => (s == null ? s : s.replace(/[‘’`]/g, "'"));
const emacs = spawnSync('emacs', ['--version']).status === 0;

/** Compares what the app makes of a manual with what Emacs answered (`oracle`). */
async function compare(dir, file, spec, oracle) {
  const manual = await loadManual(dir, file);
  const split = !!manual.parts;
  const known = INFO_KNOWN[file] || {};
  assert.equal(oracle.error, undefined, oracle.error);
  const nodes = manual.allNodes();
  await test(`${file}: nodes`, () => {
    const byName = new Map(nodes.map((n) => [n.name, n]));
    assert.deepEqual(oracle.toc.map((t) => t.name), nodes.map((n) => n.name), 'node order');
    for (const o of oracle.nodes) {
      const n = byName.get(o.name);
      assert.ok(n, o.name);
      assert.equal(n.text, o.text, `${o.name}: text`);
      assert.equal(extractPointer(n.text, 'next'), o.next, `${o.name}: next`);
      assert.equal(extractPointer(n.text, 'prev[ious]*'), o.prev, `${o.name}: prev`);
      assert.equal(extractPointer(n.text, 'up'), o.up, `${o.name}: up`);
      assert.deepEqual(menuEntries(n.text).map((e) => [e.name, e.target, e.description, e.index]), o.menu.map((e) => [e.name, e.target, e.description, e.index]), `${o.name}: menu`);
      assert.deepEqual(crossReferences(n.text).map((r) => [r.target, r.index]), o.xrefs.map((r) => [r.target, r.index]), `${o.name}: xrefs`);
      const index = manual.isIndexNode(o.name);
      assert.equal(index, o.index, `${o.name}: index node`);
      const shown = displayNode(n.text, { index }).text;
      assert.equal(shown.slice(shown.indexOf('\n') + 1), o.display, `${o.name}: shown`);
      assert.equal(breadcrumbs(manual, file, o.name), o.breadcrumbs, `${o.name}: breadcrumbs`);
    }
  });
  await test(`${file}: completions, index nodes, contents`, () => {
    assert.deepEqual(manual.completions(), oracle.completions);
    assert.deepEqual(manual.indexNodes(), oracle.indexNodes);
    assert.deepEqual(manual.toc().map((t) => ({ name: t.name, up: t.up, section: t.section ?? null, items: t.items })), oracle.toc.map((t) => ({ name: t.name, up: t.up, section: t.section ?? null, items: t.items })));
    assert.equal(tocNodeText(manual, `${dir}/${manual.name}`), oracle.tocText.replace(/^File: [^,]*,/, `File: ${dir}/${manual.name},`).replace(/^File: [^,]*/, `File: ${dir}/${manual.name}`));
  });
  await test(`${file}: goto`, () => {
    const library = { resolve: (n) => (n === file || n === file.replace(/\.info.*$/, '') ? manual : null) };
    for (const g of oracle.gotos) {
      const s = new InfoSession(library);
      s.find(file, 'Top', { noGoingBack: true });
      let got;
      try {
        s.goto(g.query);
        got = { node: s.name, file: s.file.replace(/\.info(\.gz)?$/, ''), point: s.point };
      } catch (err) {
        got = { error: err.message };
      }
      const want = g.result.error ? { error: g.result.error } : { node: g.result.node, file: g.result.file.replace(/\.info(\.gz)?$/, ''), point: g.result.point };
      if (g.query === '*') delete want.point, delete got.point;
      if (want.error) assert.ok(got.error, `${JSON.stringify(g.query)}: expected an error ${want.error}`);
      else assert.deepEqual(got, want, JSON.stringify(g.query));
    }
  });
  await test(`${file}: index lookups`, () => {
    for (const q of oracle.indexQueries) {
      const matches = (() => { try { return manual.indexMatches(q.topic); } catch { return null; } })();
      if (q.result.error) assert.ok(!matches || matches.length === 0, `${q.topic}: ${q.result.error}`);
      else assert.deepEqual(matches.map((m) => [m.entry, m.node, m.indexNode, m.line]), q.result.matches.map((m) => [m.entry, m.node, m.indexNode, m.line]), q.topic);
    }
  });
  await test(`${file}: search`, () => {
    const library = { resolve: (/** @type {string} */ name) => (name === 'dir' ? null : manual) };
    for (const s of oracle.searches) {
      const session = new InfoSession(library);
      session.find(file, 'Top');
      const hits = [];
      for (let i = 0; i < 12; i++) {
        try {
          session.search(s.regexp, s.fold);
          hits.push({ node: session.name, point: session.point });
        } catch { break; }
      }
      const want = s.hits.filter((h) => !(known.searchSkip || []).includes(h.node));
      assert.deepEqual(hits.slice(0, want.length), want.map((h) => ({ node: h.node, point: h.point })), `${s.regexp}`);
    }
  });
  await test(`${file}: scrolling at the ends of nodes`, () => {
    const library = { resolve: (/** @type {string} */ name) => (name === 'dir' ? null : manual) };
    for (const w of oracle.walk) {
      for (const [key, run] of [['scrollUp', 'scrollForward'], ['scrollDown', 'scrollBackward']]) {
        const s = new InfoSession(library);
        s.find(file, w.node, { noGoingBack: true });
        const got = (() => { try { s[run](); return s.name; } catch { return null; } })();
        assert.equal(got, w[key], `${w.node} ${key}`);
      }
    }
  });
  await test(`${file}: runs of commands`, () => {
    const library = { resolve: (/** @type {string} */ name) => (name === 'dir' ? null : manual) };
    spec.scripts.forEach((ops, k) => {
      const s = new InfoSession(library);
      s.find(file, 'Top');
      s.history = []; s.forward = []; s.alternatives = [];
      oracle.scripts[k].forEach((step, i) => {
        let error = null;
        try { apply(s, ops[i]); } catch (err) { error = err.message; }
        const where = `script ${k} step ${i} ${JSON.stringify(ops[i])}`;
        assert.equal(!!error, !!step.error, `${where}: error ${error} vs ${step.error}`);
        // Emacs reports its own failed lookup of the Indirect list when a search ends with a stale subfile name; the failure is the same.
        if (error && !(ops[i][0] === 'search' && step.error.includes('Indirect:'))) assert.equal(quotes(error), quotes(step.error), `${where}: message`);
        assert.equal(s.name, step.node, `${where}: node`);
        assert.equal(s.history.length, step.history, `${where}: history`);
        assert.equal(s.forward.length, step.forward, `${where}: forward`);
        const skipPoint = split && ['back', 'forward', 'up'].includes(ops[i][0]);
        if (!skipPoint && !(known.pointSkip || []).includes(ops[i][0])) assert.equal(s.point, step.point, `${where}: point`);
      });
    });
  });
}

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/info-oracle.json', import.meta.url), 'utf8'));
for (const [file, entry] of Object.entries(fixture)) await compare(FIXTURES, file, entry.spec, entry.oracle);

if (emacs) {
  for (const name of BIG) {
    const present = fs.readdirSync(BIG_DIR).some((f) => f.startsWith(name + '.info'));
    if (!present) {
      test(`${name}: not on this machine`, { skip: true }, () => {});
      continue;
    }
    // A directory of its own, so that Emacs finds no dir file, as the session finds none.
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'info-oracle-'));
    for (const f of fs.readdirSync(BIG_DIR)) if (f.startsWith(name + '.info')) fs.symlinkSync(path.join(BIG_DIR, f), path.join(own, f));
    const manual = await loadManual(own, name);
    const spec = buildSpec(manual, 7);
    const answers = askEmacs(own, { [manual.name]: spec });
    await compare(own, manual.name, spec, answers[manual.name]);
    fs.rmSync(own, { recursive: true });
  }
} else test('big manuals: no Emacs on the PATH', { skip: true }, () => {});
