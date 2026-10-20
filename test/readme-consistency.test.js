import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QUICK_SETTINGS_FIELDS } from '../src-browser/settings-fields.js';

// README.org is the user's reference. These checks keep it from drifting away from the code: the Contents list and the headings agree,
// every link inside it lands somewhere, every variable it names exists, and every default it states is the default the app uses.

const root = new URL('..', import.meta.url).pathname;
const readme = fs.readFileSync(path.join(root, 'README.org'), 'utf8');
const lines = readme.split('\n');

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : /\.js$/.test(e.name) && !/vendor/.test(dir) ? [path.join(dir, e.name)] : []));
}
const sources = [...sourceFiles('src'), ...sourceFiles('src-browser'), 'app.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const customIds = new Set(lines.flatMap((l, i) => (/^:CUSTOM_ID: (\S+)/.test(l) ? [/^:CUSTOM_ID: (\S+)/.exec(l)[1]] : [])));

/** The second-level headings, each with its CUSTOM_ID. */
const topics = lines.flatMap((l, i) => {
  if (!/^\*\* /.test(l)) return [];
  const id = /^:CUSTOM_ID: (\S+)/.exec(lines[i + 2] || '');
  return [{ title: l.slice(3), id: id ? id[1] : null }];
});

test('every entry in the Contents list names a heading that exists', () => {
  const start = lines.findIndex((l) => l === '** Contents');
  const entries = [];
  for (let i = start + 1; i < lines.length && !/^\*\* /.test(lines[i]); i++) {
    const m = /^- \[\[#([^\]]+)\]\[(.+)\]\]$/.exec(lines[i]);
    if (m) entries.push(m[1]);
  }
  assert.ok(entries.length > 20, 'the Contents list was found');
  const missing = entries.filter((id) => !customIds.has(id));
  assert.deepEqual(missing, []);
});

test('every main section is in the Contents list', () => {
  const start = lines.findIndex((l) => l === '** Contents');
  const listed = new Set();
  for (let i = start + 1; i < lines.length && !/^\*\* /.test(lines[i]); i++) {
    const m = /^- \[\[#([^\]]+)\]/.exec(lines[i]);
    if (m) listed.add(m[1]);
  }
  const absent = topics.filter((t) => t.title !== 'Contents' && t.id && !listed.has(t.id)).map((t) => t.title);
  assert.deepEqual(absent, []);
});

test('every link inside the README lands on a heading', () => {
  // links shown as examples (inside ~code~ or a block) are not links
  const prose = readme.replace(/#\+BEGIN_(\w+)[\s\S]*?#\+END_\1/gi, '').replace(/~[^~\n]*~/g, '');
  const broken = [...prose.matchAll(/\[\[#([^\]]+)\]/g)].map((m) => m[1]).filter((id) => !customIds.has(id));
  assert.deepEqual([...new Set(broken)], []);
});

/** The rows of the table of recognized variables: name, default cell, and whether it is marked (own). */
function variableRows() {
  const head = lines.findIndex((l) => l === '| Variable | Default | What it does |');
  assert.ok(head > 0, 'the variables table was found');
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split(/ \| /).map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
    const name = /^~([^~]+)~$/.exec(cells[0]);
    if (name) rows.push({ name: name[1], defaultCell: cells[1] || '', text: lines[i] });
  }
  return rows;
}

test('every variable the README names is one the code knows', () => {
  const unknown = variableRows().filter((r) => !sources.includes(`'${r.name}'`) && !sources.includes(`"${r.name}"`) && !sources.includes(r.name)).map((r) => r.name);
  assert.deepEqual(unknown, []);
});

test('the variables table is alphabetical', () => {
  const names = variableRows().map((r) => r.name);
  assert.deepEqual(names, [...names].sort());
});

test('every setting in Quick Settings that is an org or Emacs variable is in the README table', () => {
  const documented = new Set(variableRows().map((r) => r.name));
  const missing = QUICK_SETTINGS_FIELDS.map((f) => f.key).filter((k) => /^(org|calendar|diary|appt|buffer|holiday)-/.test(k) && !documented.has(k));
  assert.deepEqual(missing, []);
});

test('the default the README states for a variable is the default the setting has', () => {
  const rows = new Map(variableRows().map((r) => [r.name, r]));
  const wrong = [];
  for (const f of QUICK_SETTINGS_FIELDS) {
    const row = rows.get(f.key);
    if (!row || f.default === undefined || f.type === 'hours24') continue; // a 24-hour switch, not the setting's own text
    const cell = /^~([^~]*)~/.exec(row.defaultCell);
    if (!cell) continue; // described in words
    const stated = cell[1].replace(/^'/, '');
    const expected = typeof f.default === 'boolean' ? (f.default ? 't' : 'nil') : String(f.default);
    if (typeof f.default === 'string' && f.default.length > 24) continue; // a long text default is described, not compared
    if (stated !== expected) wrong.push(`${f.key}: README says ${stated}, the setting defaults to ${expected}`);
  }
  assert.deepEqual(wrong, []);
});
