// Shared by tools/gen-info-oracle.mjs and test/info-oracle.test.js: reading manuals from a directory the way the app does, the
// questions put to Emacs about each manual, and the run of Emacs 29.3 (tools/info-oracle.el) that answers them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFileName, Manual } from '../src/info-manual.js';
import { InfoSession } from '../src/info-nav.js';
import { namedParts, readInfoBytes } from '../src/info-store.js';

const EL = new URL('./info-oracle.el', import.meta.url).pathname;

/** The Manual named `name` among the files of `dir` (also .gz), with its parts. */
export async function loadManual(dir, name) {
  const listing = fs.readdirSync(dir);
  const mainName = findFileName(listing, name);
  if (mainName === null) throw new Error('no manual ' + name);
  const read = async (file) => readInfoBytes(new Uint8Array(fs.readFileSync(path.join(dir, file))));
  const main = await read(mainName);
  const files = new Map([[mainName, main.text]]);
  for (const part of namedParts(main.text) || []) {
    const stored = findFileName(listing, part);
    if (stored !== null) files.set(stored, (await read(stored)).text);
  }
  return new Manual(mainName, files, main.encoding);
}

/** A library of the manuals of `dir` for a session; `dirManual` answers for `dir`. */
export async function libraryOf(dir, names) {
  const cache = new Map();
  for (const n of names) cache.set(n, await loadManual(dir, n));
  return { resolve: (name) => cache.get(name) || cache.get(name.replace(/\.info(\.gz)?$/, '')) || null };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOPICS = ['sort', 'SORT', ':sort', 'file', 'option', 'format', 'org', 'a', 'zzzqq', 'formula', 'Concept', 'rows'];
export const SEARCHES = [['sort', true], ['Sort', false], ['file name', true], ['\\bnote\\b', true], ['[Ff]ormulas? ', true], ['^\\* ', true], ['::', true], ['foo  bar', true], ['(line', true], ['\\*Note', true], ['the', true], ['\\(see\\|also\\)', true]];

/** What to ask Emacs about a manual: goto strings, index topics, searches and command scripts. */
export function buildSpec(manual, seed = 1) {
  const rnd = rng(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const nodes = manual.allNodes();
  const names = nodes.map((n) => n.name);
  const file = manual.name;
  const chosen = names.length > 40 ? Array.from({ length: 40 }, () => pick(names)) : names;
  const gotos = [];
  for (const n of chosen) gotos.push(n, n.toLowerCase(), n.toUpperCase(), `(${file.replace(/\.info.*$/, '')})${n}`, `  ${n}  `, n + '.x');
  const anchors = manual.completions().filter((c) => !names.includes(c)).slice(0, 12);
  gotos.push(...anchors, '*', '(' + file.replace(/\.info.*$/, '') + ')', '()', '(nosuchmanual)Top', 'No such node', '', 'Top');
  const library = { resolve: (n) => (n === file || n === file.replace(/\.info.*$/, '') ? manual : null) };
  const scripts = [];
  for (let k = 0; k < 8; k++) {
    const session = new InfoSession(library);
    session.find(file, 'Top');
    const ops = [];
    for (let i = 0; i < 30; i++) {
      const menu = session.node ? [...session.text.matchAll(/\n\* +([^:\n]+):/g)].map((m) => m[1]) : [];
      const r = rnd();
      let op;
      if (r < 0.16) op = ['next'];
      else if (r < 0.24) op = ['prev'];
      else if (r < 0.32) op = ['up'];
      else if (r < 0.34) op = ['top'];
      else if (r < 0.5 && menu.length) op = ['menu', pick(menu)];
      else if (r < 0.56) op = ['goto', pick(names)];
      else if (r < 0.62) op = ['index', pick(TOPICS)];
      else if (r < 0.68) op = ['index-next'];
      else if (r < 0.76) op = ['back'];
      else if (r < 0.8) op = ['forward'];
      else if (r < 0.88) op = ['scroll-up'];
      else if (r < 0.94) op = ['scroll-down'];
      else {
        const [re, fold] = pick(SEARCHES);
        op = ['search', re, fold];
      }
      ops.push(op);
      try {
        apply(session, op);
      } catch {
        // an error is part of the run
      }
    }
    scripts.push(ops);
  }
  return { topics: TOPICS, gotos, searches: SEARCHES.map(([regexp, fold]) => ({ regexp, fold })), scripts };
}

/** Runs one command of a script on a session. */
export function apply(session, op) {
  switch (op[0]) {
    case 'next': return session.next();
    case 'prev': return session.prev();
    case 'up': return session.up();
    case 'top': return session.top();
    case 'menu': return session.menu(op[1]);
    case 'goto': return session.goto(op[1]);
    case 'index': return session.index(op[1]);
    case 'index-next': return session.indexNext(1);
    case 'back': return session.historyBack();
    case 'forward': return session.historyForward();
    case 'scroll-up': return session.scrollForward();
    case 'scroll-down': return session.scrollBackward();
    case 'search': return session.search(op[1], op[2] === true);
    default: throw new Error('unknown op ' + op[0]);
  }
}

/** Asks Emacs: `specs` maps a manual's file name to its questions; the answers come back by file name. */
export function askEmacs(dir, specs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'info-oracle-'));
  const q = path.join(tmp, 'q.json');
  const out = path.join(tmp, 'out.json');
  fs.writeFileSync(q, JSON.stringify(specs));
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', EL, '--eval', `(info-oracle-run ${JSON.stringify(dir)} ${JSON.stringify(q)} ${JSON.stringify(out)})`], { env: { ...process.env, LC_ALL: 'C.UTF-8' }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr || 'emacs failed');
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(tmp, { recursive: true });
  return result;
}
