import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';
import { cacheBibliography } from '../src/cite.js';

// The .expected.html files are what Emacs 29.3's ox-html produced for each .org file
// ((org-export-as 'html), org-export-use-babel nil), reduced to document structure by `skeleton` below.
// `skeleton` drops what is not structure or differs on purpose: element ids and anchors, the postamble, syntax
// colouring spans, real checkboxes (Emacs prints [X] in <code>), the stray space Emacs leaves in timestamps, and
// the empty text containers Emacs puts under headings that only have sub-headings.
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/html/${name}`, import.meta.url), 'utf8');

function skeleton(h) {
  const i = h.indexOf('<div id="content"');
  h = h.slice(i, h.lastIndexOf('</body>'));
  h = h.replace(/<div id="postamble"[\s\S]*$/, '');
  h = h.replace(/<script>[\s\S]*?<\/script>\s*/g, '');
  h = h.replace(/ (id|for)="[^"]*"/g, '').replace(/ href="#[^"]*"/g, ' href="#"');
  h = h.replace(/<span class="org-[a-z-]+">([^<]*)<\/span>/g, '$1');
  h = h.replace(/<br \/>/g, '<br>').replace(/ \/>/g, '>');
  h = h.replace(/<input type="checkbox" disabled checked>/g, '<code>[X]</code>').replace(/<input type="checkbox" disabled>/g, '<code>[&#xa0;]</code>');
  h = h.replace(/(<span class="timestamp">[^<]*?)\s+<\/span>/g, '$1</span>');
  h = h.replace(/<div class="outline-text-\d">\s*<\/div>\s*/g, '');
  h = h.replace(/\s*\n\s*/g, '\n').replace(/>\n</g, '><').replace(/\n(?=<)/g, '').replace(/>\n/g, '>').replace(/\s+/g, ' ').replace(/> </g, '><');
  return h.replace(/></g, '>\n<').trim();
}

for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
  test(`HTML export of fixture p${n} has the structure ox-html gives it`, () => {
    // citations read the bibliography files named in the fixture, which sit beside it
    for (const m of fixture(`p${n}.org`).matchAll(/^#\+BIBLIOGRAPHY:\s*"?([^"\n]+?)"?\s*$/gim)) cacheBibliography(m[1], fixture(m[1]));
    const ours = skeleton(exportToHtml(parseOrg(fixture(`p${n}.org`))));
    assert.equal(ours, fixture(`p${n}.expected.html`).trim());
  });
}
