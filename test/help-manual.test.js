// Holds the app's own manual to README.org: org-pwa.info and src/help-nodes.js are made from it by tools/gen-info.mjs (Org's ox-texinfo and
// makeinfo), so they must be made again whenever README.org changes, every node a Settings hint, the Capture help link or a heading
// position points to must be in the manual, and the manual must be a whole Info file the reader can list in its directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manual } from '../src/info-manual.js';
import { dirEntriesOf, groupFiles } from '../src/info-store.js';
import { HELP_NODE_BY_HEADING, HELP_NODE_BY_ID, README_SHA256 } from '../src/help-nodes.js';
import { headingCount } from '../tools/gen-info.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readme = read('README.org');
const info = read('org-pwa.info');
const manual = new Manual('org-pwa.info', new Map([['org-pwa.info', info]]), 'utf-8');

/** Every `#anchor` the app opens the manual at: Settings hints (helpAnchor) and openDocsAtHeading calls. */
function anchorsInApp() {
  const found = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'src-browser')).filter((n) => n.endsWith('.js'))) {
    const text = read('src-browser/' + f);
    for (const m of text.matchAll(/helpAnchor: *'#([^']+)'/g)) found.set(m[1], `${f} helpAnchor`);
    for (const m of text.matchAll(/openDocsAtHeading\('#([^']+)'\)/g)) found.set(m[1], `${f} openDocsAtHeading`);
  }
  return found;
}

test('org-pwa.info and src/help-nodes.js were made from this README.org (run: node tools/gen-info.mjs)', () => {
  assert.equal(crypto.createHash('sha256').update(readme).digest('hex'), README_SHA256);
});

test('README.org exports to Texinfo as it stands: a title and the Texinfo keywords, tagged source blocks, no heading line inside a block', () => {
  for (const key of ['TITLE', 'TEXINFO_FILENAME', 'TEXINFO_DIR_CATEGORY', 'TEXINFO_DIR_TITLE', 'TEXINFO_DIR_DESC']) assert.match(readme, new RegExp(`^#\\+${key}: .+`, 'm'), key);
  assert.doesNotMatch(readme, /^[ \t]*#\+begin_src[ \t]*$/im, 'a #+BEGIN_SRC without a language (Org\'s Texinfo export takes minutes over it)');
  let block = null;
  for (const [i, line] of readme.split('\n').entries()) {
    const begin = /^[ \t]*#\+begin_(\w+)/i.exec(line);
    if (block === null && begin) block = begin[1].toLowerCase();
    else if (block !== null && new RegExp(`^[ \\t]*#\\+end_${block}[ \\t]*$`, 'i').test(line)) block = null;
    else if (block !== null) assert.doesNotMatch(line, /^\*+ /, `line ${i + 1}: a heading line inside a #+BEGIN_${block.toUpperCase()} block needs a comma before it`);
  }
});

test('org-pwa.info is a whole Info file with its own directory entry', () => {
  const [group] = groupFiles([{ name: 'org-pwa.info', text: info, encoding: 'utf-8', size: info.length }]);
  assert.equal(group.status, 'ready', group.note);
  assert.equal(group.base, 'org-pwa');
  const entries = dirEntriesOf(info);
  assert.equal(entries.length, 1);
  assert.match(entries[0].text, /^\* org-pwa: \(org-pwa\)\./);
  assert.doesNotThrow(() => manual.findNode('Top'));
});

test('every Settings hint and help link of the app opens a node the manual has', () => {
  const anchors = anchorsInApp();
  assert.ok(anchors.size > 20, 'the app has help anchors');
  for (const [id, where] of anchors) {
    const node = HELP_NODE_BY_ID[id];
    assert.ok(node, `${where}: README.org has no heading with :CUSTOM_ID: ${id}`);
    assert.doesNotThrow(() => manual.findNode(node), `${where}: the manual has no node "${node}" for #${id}`);
  }
});

test('every heading of README.org has its node in the manual, in the order Help counts them', () => {
  assert.equal(HELP_NODE_BY_HEADING.length, headingCount(readme));
  for (const node of HELP_NODE_BY_HEADING) assert.doesNotThrow(() => manual.findNode(node), `no node "${node}"`);
  for (const [id, node] of Object.entries(HELP_NODE_BY_ID)) assert.doesNotThrow(() => manual.findNode(node), `#${id}: no node "${node}"`);
  const ids = [...readme.matchAll(/^:CUSTOM_ID: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(Object.keys(HELP_NODE_BY_ID).sort(), [...new Set(ids)].sort());
});
