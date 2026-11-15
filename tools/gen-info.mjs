#!/usr/bin/env node
// Builds the app's own manual: README.org -> org-pwa.info (Org's ox-texinfo, then makeinfo), and src/help-nodes.js, which says
// which Info node each heading of README.org became (by CUSTOM_ID and by position), so Help, Settings hints and [[help:NAME]]
// links open the manual at the right place. README.org stays the only source; the Texinfo-only changes are made on a temporary copy.
//
//   node tools/gen-info.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.org'), 'utf8');

/**
 * README.org as Emacs's Texinfo exporter needs it. In Org a line inside a block that starts with `*` or `#+` is written with a leading
 * comma, an untagged source block has no language to export, and ` :: ` in a list item's first line starts a description list;
 * the app's own reader needs none of that, so it is done here and README.org stays as it is.
 * @param {string} text
 */
export function forTexinfo(text) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let block = null;
  for (let line of text.split('\n')) {
    if (line.startsWith('# -*-') || line.startsWith('#+STARTUP')) continue;
    const begin = /^(\s*)#\+BEGIN_(\w+)(.*)$/i.exec(line);
    if (block === null && begin) {
      block = begin[2].toUpperCase();
      if (block === 'SRC' && !begin[3].trim()) line = begin[1] + '#+BEGIN_SRC text';
      out.push(line);
      continue;
    }
    if (block !== null) {
      if (new RegExp('^\\s*#\\+END_' + block + '\\s*$', 'i').test(line)) block = null;
      else if (/^\*+ /.test(line) || line.startsWith('#+')) line = ',' + line;
    } else if (/^\s*(?:[-+]|\d+[.)])\s/.test(line)) {
      line = line.replace(/~[^~]*~/g, (verbatim) => verbatim.replace(/ :: /g, ' :: '));
    }
    out.push(line);
  }
  const header = [
    '#+TITLE: org-pwa',
    '#+TEXINFO_FILENAME: org-pwa.info',
    '#+TEXINFO_DIR_CATEGORY: Emacs',
    '#+TEXINFO_DIR_TITLE: org-pwa: (org-pwa)',
    '#+TEXINFO_DIR_DESC: Mobile-first Org mode in the browser',
    '#+OPTIONS: toc:nil num:nil ^:nil author:nil date:nil email:nil creator:nil',
    '',
  ];
  return header.join('\n') + out.join('\n');
}

/** The headings the app's own Help lookup counts (src/help-lookup.js): `*` lines outside blocks. @param {string} text */
export function headingCount(text) {
  let inBlock = false;
  let n = 0;
  for (const l of text.split('\n')) {
    if (/^\s*#\+begin_/i.test(l)) inBlock = true;
    else if (/^\s*#\+end_/i.test(l)) inBlock = false;
    else if (!inBlock && /^\*+ /.test(l)) n++;
  }
  return n;
}

/**
 * What makeinfo made of each node and anchor name (`Folding and @code{#+STARTUP}` is `Folding and #+STARTUP` in the Info file): the
 * `@node` and `@anchor` lines of the Texinfo, in file order, and the Node: and Ref: entries of the Info file's tag table, in file order.
 * @param {string} texi
 * @param {string} info
 * @returns {Map<string, string>} the Texinfo name to the Info name
 */
export function infoNames(texi, info) {
  const before = [...texi.matchAll(/^@node (.+)$|@anchor\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gm)].map((m) => (m[1] ?? m[2]).trim());
  const table = info.slice(info.indexOf('\nTag Table:\n'), info.indexOf('\nEnd Tag Table'));
  const after = [...table.matchAll(/^(?:Node|Ref): (.*)\x7f[0-9]+$/gm)].map((m) => m[1]);
  if (before.length !== after.length) throw new Error(`The Texinfo has ${before.length} nodes and anchors, the Info file ${after.length}`);
  return new Map(before.map((name, i) => [name, after[i]]));
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-info-'));
  try {
    const org = path.join(dir, 'org-pwa.org');
    const texi = path.join(dir, 'org-pwa.texi');
    const map = path.join(dir, 'map.json');
    fs.writeFileSync(org, forTexinfo(readme));
    execFileSync('emacs', ['-Q', '--batch', '-l', path.join(ROOT, 'tools/gen-info.el'), org, texi, map], { stdio: 'inherit' });
    const info = path.join(dir, 'org-pwa.info');
    execFileSync('makeinfo', ['--no-split', '-o', info, texi], { stdio: 'inherit' });
    const raw = JSON.parse(fs.readFileSync(map, 'utf8'));
    const names = infoNames(fs.readFileSync(texi, 'utf8'), fs.readFileSync(info, 'utf8'));
    /** @param {string} name */
    const infoName = (name) => {
      const expanded = names.get(name);
      if (expanded === undefined) throw new Error(`Texinfo node or anchor "${name}" is not in the Info file`);
      return expanded;
    };
    const nodes = raw.nodes.map(infoName);
    /** @type {Record<string, string>} */
    const ids = Object.fromEntries(Object.entries(raw.ids).map(([id, name]) => [id, infoName(/** @type {string} */ (name))]));
    const expected = headingCount(readme);
    if (nodes.length !== expected) throw new Error(`Emacs exported ${nodes.length} headings but Help counts ${expected}; the position map would be wrong`);
    fs.copyFileSync(info, path.join(ROOT, 'org-pwa.info'));
    const hash = crypto.createHash('sha256').update(readme).digest('hex');
    fs.writeFileSync(
      path.join(ROOT, 'src/help-nodes.js'),
      `// @ts-check
// Generated by tools/gen-info.mjs from README.org; do not edit. Which node of org-pwa.info each heading of README.org became.

/** The sha-256 of the README.org this was made from. */
export const README_SHA256 = ${JSON.stringify(hash)};

/** The node (or anchor) of the heading with this CUSTOM_ID. @type {Record<string, string>} */
export const HELP_NODE_BY_ID = ${JSON.stringify(ids, null, 1)};

/** The node (or anchor) of each heading, in document order, as src/help-lookup.js counts them. @type {string[]} */
export const HELP_NODE_BY_HEADING = ${JSON.stringify(nodes, null, 1)};
`,
    );
    console.log(`org-pwa.info: ${fs.statSync(path.join(ROOT, 'org-pwa.info')).size} bytes, ${nodes.length} headings, ${Object.keys(ids).length} with a CUSTOM_ID`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
