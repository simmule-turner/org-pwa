// Holds inline markup to Emacs: emphasis, code and verbatim, sub- and superscripts (org-use-sub-superscripts t, {} and nil), LaTeX
// fragments, links, targets and footnote references in one line of text. Fixture: tools/gen-oracle-markup.mjs (Emacs 29.3, Org 9.6).
// A case the app reads differently from Emacs and that is not fixed yet sits in KNOWN_DEVIATIONS with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseInline } from '../src/inline-markup.js';
import { merge, canon } from './support/markup-canon.js';
import { ENTITIES } from '../src/entities.js';
import { LATEX_ENTITIES } from '../src/entities-latex.js';
import { splitAffiliated, parseAttrOptions } from '../src/affiliated.js';
import { resolveLinkTarget } from '../src/link-resolve.js';
import { matchLatexFragmentAt } from '../src/inline-markup.js';
import { parseOrg } from '../src/org-parser.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-markup.json', import.meta.url), 'utf8'));

/** What ox.el does with org-use-sub-superscripts: nil turns every script back into text, {} the ones without braces. @param {any[]} toks @param {string} mode @returns {any[]} */
function applyScriptMode(toks, mode) {
  return toks.map((t) => {
    if ((t.t === 'sub' || t.t === 'sup') && (mode === 'nil' || (mode === '{}' && !/^[_^]\{/.test(t.v)))) return { t: 'text', v: t.v };
    return t.c ? { ...t, c: applyScriptMode(t.c, mode) } : t;
  });
}

/** A LaTeX command such as \foo{x} is a latex fragment in Emacs; the app keeps it as text (KaTeX cannot typeset an unknown command), so the
 * expected tokens are text. @param {any[]} toks @returns {any[]} */
function commandsAsText(toks) {
  return toks.map((t) => (t.t === 'latex' && /^\\[a-zA-Z]/.test(t.v) ? { t: 'text', v: t.v } : t.c ? { ...t, c: commandsAsText(t.c) } : t));
}

/** Cases not matched yet: "line|mode" -> why. Filled in by the first run; every entry is a difference to fix, not a feature. */
const KNOWN_DEVIATIONS = /** @type {Record<string, string>} */ ({});

test('a line of text has the markup Emacs finds in it', () => {
  const wrong = [];
  for (const c of fixture.inline) {
    for (const mode of /[_^]/.test(c.line) ? ['t', '{}', 'nil'] : ['t']) {
      const want = merge(applyScriptMode(commandsAsText(JSON.parse(JSON.stringify(c.emacs))), mode));
      const got = canon(parseInline(c.line, { subSuperscriptMode: mode }));
      if (JSON.stringify(got) !== JSON.stringify(want) && !KNOWN_DEVIATIONS[`${c.line}|${mode}`]) wrong.push({ line: c.line, mode, got, want });
    }
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ; first: ${JSON.stringify(wrong.slice(0, 5), null, 1)}`);
});

test('the entity tables are the ones Org has', () => {
  const seen = new Set();
  const wrong = [];
  for (const [name, latex, math, html, ascii, latin1, utf8] of fixture.entities) {
    if (seen.has(name)) continue; // org-entity-get takes the first of a name
    seen.add(name);
    if (/^_ +$/.test(name)) continue; // \\_ and spaces: the exporters write a run of spaces for it themselves
    const got = /** @type {any} */ (ENTITIES)[name];
    if (JSON.stringify(got) !== JSON.stringify([ascii, latin1, utf8, html])) wrong.push({ name, table: 'text', got, want: [ascii, latin1, utf8, html] });
    const gl = /** @type {any} */ (LATEX_ENTITIES)[name];
    if (JSON.stringify(gl) !== JSON.stringify([latex, math])) wrong.push({ name, table: 'latex', got: gl, want: [latex, math] });
  }
  const extra = Object.keys(ENTITIES).filter((n) => !seen.has(n));
  assert.deepEqual(extra, [], 'entities Org does not have');
  assert.equal(wrong.length, 0, JSON.stringify(wrong.slice(0, 5), null, 1));
});

test('the lines above a paragraph that are affiliated keywords are the ones Org takes', () => {
  const wrong = [];
  for (const c of fixture.affiliated) {
    // The app reads one paragraph at a time: the lines up to a blank line. Keywords with nothing under them in it are left to the block
    // or table that follows (Org: plain keywords when a blank line, a heading or the end comes next).
    const all = c.text.split('\n');
    const end = all.findIndex((l) => l.trim() === '' || /^\*+ /.test(l));
    const paragraph = end === -1 ? all : all.slice(0, end);
    const { affiliated, rest } = splitAffiliated(paragraph);
    if (rest.length === 0) continue;
    const got = affiliated.length;
    if (got !== c.emacs.lines) wrong.push({ text: c.text, got, want: c.emacs.lines, element: c.emacs.type });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ; first: ${JSON.stringify(wrong.slice(0, 6), null, 1)}`);
});

test('the options of an #+ATTR_*: line read as Org reads them', () => {
  const wrong = [];
  for (const c of fixture.attrs) {
    const got = Object.entries(parseAttrOptions(c.text)).map(([k, v]) => [k, v === '' ? null : v]);
    // Org's list holds a repeated option twice; reading it (plist-get) finds the first
    const want = c.emacs.map(([k, v]) => [k.toLowerCase(), v]).filter(([k], i, all) => all.findIndex(([k2]) => k2 === k) === i);
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ text: c.text, got, want });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ; first: ${JSON.stringify(wrong.slice(0, 6), null, 1)}`);
});

/** Link targets the app reads differently on purpose: text -> why. Each must still differ, so a fixed one has to leave the list. */
const KNOWN_LINK_DEVIATIONS = /** @type {Record<string, string>} */ ({
  'news:comp.emacs': 'chosen: cannot work in the app',
  'shell:ls': 'chosen: cannot work in the app',
  'elisp:(foo)': 'chosen: cannot work in the app',
  'help:org-mode': 'chosen: cannot work in the app (the app has no describe-function or describe-variable to open)',
  'shell:': 'chosen: cannot work in the app',
  'elisp:': 'chosen: cannot work in the app',
});

test('a link target is the kind of link, with the path and search option, that Org finds', () => {
  const doc = parseOrg('* H\n');
  const wrong = [];
  const stillDiffer = new Set();
  for (const c of fixture.links) {
    const e = c.emacs;
    const r = /** @type {any} */ (resolveLinkTarget(doc, c.text));
    const type = e.type.toLowerCase(); // link types do not care about case
    const want = type === 'file' ? ['file', e.path, e.search] : ['id', 'attachment'].includes(type) ? [type] : ['http', 'https', 'ftp', 'mailto', 'doi'].includes(type) ? ['external'] : ['fuzzy', 'custom-id', 'coderef'].includes(type) ? ['internal'] : [type];
    const kind = r.type === 'heading' || r.type === 'unresolved' ? 'internal' : r.type;
    const got = kind === 'file' ? ['file', r.path, r.inFileTarget] : [kind];
    if (JSON.stringify(got) === JSON.stringify(want)) continue;
    if (KNOWN_LINK_DEVIATIONS[c.text]) stillDiffer.add(c.text);
    else wrong.push({ text: c.text, got, want, emacsType: e.type });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ; first: ${JSON.stringify(wrong.slice(0, 12), null, 1)}`);
  assert.deepEqual(Object.keys(KNOWN_LINK_DEVIATIONS).filter((t) => !stillDiffer.has(t)), [], 'listed as different but no longer is');
});

test('a LaTeX environment is where Org finds it', () => {
  const wrong = [];
  for (const c of fixture.envs) {
    // an environment starts a line, after blanks only
    const got = [];
    for (let at = c.text.search(/\\begin\{/i); at !== -1; at = c.text.slice(at + 1).search(/\\begin\{/i) === -1 ? -1 : at + 1 + c.text.slice(at + 1).search(/\\begin\{/i)) {
      const m = /^[ \t]*$/.test(c.text.slice(c.text.lastIndexOf('\n', at - 1) + 1, at)) ? matchLatexFragmentAt(c.text, at) : null;
      if (m && m.displayMode && /^\\begin/i.test(c.text.slice(at, at + m.length))) {
        got.push(c.text.slice(at, at + m.length));
        at += m.length - 1;
      }
    }
    const want = c.emacs.map((t) => t.replace(/^\s+/, ''));
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ text: c.text, got, want });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ; first: ${JSON.stringify(wrong.slice(0, 6), null, 1)}`);
});

// Which file names ox-html shows as a picture (org-html-inline-image-rules, Emacs 29.3: a [[file:x.EXT]] link with no description).
const EMACS_INLINES = { png: true, PNG: true, jpg: true, jpeg: true, gif: true, svg: true, webp: true, bmp: false, tiff: false, heic: false, pdf: false, txt: false };
// The browser can draw these, so the app shows them although Org does not.
const KNOWN_IMAGE_DEVIATIONS = new Set(['bmp', 'heic']); // chosen: app behavior

test('a link to a picture is shown as one for the file types ox-html inlines', () => {
  const wrong = [];
  for (const [ext, want] of Object.entries(EMACS_INLINES)) {
    const got = parseInline(`[[file:a.${ext}]]`).some((n) => n.type === 'image');
    if (got !== want && !KNOWN_IMAGE_DEVIATIONS.has(ext)) wrong.push({ ext, got, want });
  }
  assert.deepEqual(wrong, []);
});
