// The preamble and postamble that real Emacs writes (fixtures from tools/gen-html-bars-oracle.mjs) against src/export-html.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/html-bars-oracle.json', import.meta.url), 'utf8'));
// the moment of export differs between runs
const STAMP = /\d{4}-\d\d-\d\d [A-Z][a-z]{2} \d\d:\d\d/g;
const grab = (html, id) => {
  const m = new RegExp(`<div id="${id}" class="status">\\n([\\s\\S]*?)\\n</div>`).exec(html);
  return m ? m[1].replace(STAMP, '<STAMP>') : null;
};

for (const c of cases) {
  const opt = c.src.split('\n').find((l) => l.startsWith('#+OPTIONS')).slice(10);
  test(`html bars: ${opt} (${c.src.split('\n')[0]})`, () => {
    const html = exportToHtml(parseOrg(c.src), null, {});
    assert.equal(grab(html, 'preamble'), c.preamble && c.preamble.replace(STAMP, '<STAMP>'), 'preamble');
    // without a postamble option the app keeps its own author and date lines
    if (opt.includes('html-postamble')) assert.equal(grab(html, 'postamble'), c.postamble && c.postamble.replace(STAMP, '<STAMP>'), 'postamble');
  });
}
