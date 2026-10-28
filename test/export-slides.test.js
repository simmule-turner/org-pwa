import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToSlides, parseSpec } from '../src/export-slides.js';

const slides = (text, scope = null) => exportToSlides(parseOrg(text), scope);
const pages = (html) => html.split('<section class="slide ').slice(1);
const frames = (html) => pages(html).filter((p) => p.startsWith('frame'));

test('overlay specifications name steps as Beamer reads them', () => {
  const at = (raw, n = 1) => parseSpec(raw, { n });
  assert.deepEqual(at('<2>'), [[2, 2]]);
  assert.deepEqual(at('<2->'), [[2, Infinity]]);
  assert.deepEqual(at('<-3>'), [[1, 3]]);
  assert.deepEqual(at('<2-4>'), [[2, 4]]);
  assert.deepEqual(at('<1,3->'), [[1, 1], [3, Infinity]]);
  assert.deepEqual(at('<+->', 3), [[3, Infinity]]);
  assert.deepEqual(at('<+-| alert@+>', 2), [[2, Infinity]]);
  assert.equal(at('2'), null);
  const counter = { n: 1 };
  parseSpec('<+->', counter);
  parseSpec('<+->', counter);
  assert.equal(counter.n, 3);
});

test('a frame is a page; a heading above the frame level is a section with no page', () => {
  const html = slides('#+OPTIONS: H:2\n* Part\n** One\ntext one\n** Two\ntext two\n');
  assert.equal(frames(html).length, 2);
  assert.match(frames(html)[0], /<h2>One<\/h2>[\s\S]*text one/);
  assert.match(frames(html)[1], /<span>Part<\/span>/);
});

test('H: sets the frame level, and a title and an outline come first', () => {
  const html = slides('#+TITLE: Talk\n#+AUTHOR: Me\n#+OPTIONS: toc:t H:2\n* A\n** B\n*** C\nx\n');
  assert.equal(pages(html)[0].startsWith('title-slide'), true);
  assert.equal(pages(html)[1].startsWith('toc-slide'), true);
  assert.equal(frames(html).length, 1); // A is a section, B the frame, C a block in it
  assert.equal(frames(slides('* A\n** B\n*** C\nx\n')).length, 1); // by default A is the frame
  const two = slides('#+OPTIONS: H:2\n* A\n** B\nx\n** C\ny\n');
  assert.equal(frames(two).length, 2);
});

test('a list with :overlay <+-> takes a page per item and keeps the hidden items in place', () => {
  const html = slides('* F\n#+ATTR_BEAMER: :overlay <+->\n- a\n- b\n- c\n');
  const f = frames(html);
  assert.equal(f.length, 3);
  assert.equal((f[0].match(/class="cover"/g) || []).length, 2);
  assert.equal((f[1].match(/class="cover"/g) || []).length, 1);
  assert.equal((f[2].match(/class="cover"/g) || []).length, 0);
});

test('an item with its own @@beamer:<2>@@ shows on that step', () => {
  const f = frames(slides('* F\n- a\n- @@beamer:<2>@@ b\n'));
  assert.equal(f.length, 2);
  assert.match(f[0], /<li class="cover">/);
  assert.doesNotMatch(f[1], /cover/);
});

test('BEAMER_ACT shows a block on its steps; a hidden block takes no place', () => {
  const html = slides('* F\n** Late\n:PROPERTIES:\n:BEAMER_env: block\n:BEAMER_act: <2->\n:END:\nlate text\n** Early\n:PROPERTIES:\n:BEAMER_env: block\n:BEAMER_act: <1>\n:END:\nearly text\n');
  const f = frames(html);
  assert.equal(f.length, 2);
  assert.doesNotMatch(f[0], /late text/);
  assert.match(f[0], /early text/);
  assert.match(f[1], /late text/);
  assert.doesNotMatch(f[1], /early text/);
});

test('columns sit side by side by BEAMER_col; notes are left out', () => {
  const html = slides('* F\n** L\n:PROPERTIES:\n:BEAMER_col: 0.3\n:END:\nleft\n** R\n:PROPERTIES:\n:BEAMER_col: 0.7\n:END:\nright\n** N\n:PROPERTIES:\n:BEAMER_env: note\n:END:\nsecret\n');
  assert.match(html, /<div class="columns"[^>]*>\s*<div class="column" style="width:30%">[\s\S]*left[\s\S]*<div class="column" style="width:70%">[\s\S]*right/);
  assert.doesNotMatch(html, /secret/);
});

test('againframe shows a frame again for the steps it names', () => {
  const html = slides('* F\n:PROPERTIES:\n:CUSTOM_ID: f\n:END:\n#+ATTR_BEAMER: :overlay <+->\n- a\n- b\n* Again\n:PROPERTIES:\n:BEAMER_env: againframe\n:BEAMER_ref: f\n:BEAMER_act: <2>\n:END:\n');
  assert.equal(frames(html).length, 3); // two steps, then step 2 again
});

test('a subtree is exported on its own, and fullframe has no title bar', () => {
  const doc = parseOrg('* Skip\nno\n* Keep\n** Inner\nyes\n');
  const html = exportToSlides(doc, doc.children[1]);
  assert.doesNotMatch(html, /Skip/);
  assert.match(html, /yes/);
  assert.doesNotMatch(slides('* F\n:PROPERTIES:\n:BEAMER_env: fullframe\n:END:\nbody\n'), /<h2>F<\/h2>/);
});

test('a Madrid-like theme gets the bar look, an unknown one the plain page; comments and exclusions are kept out', () => {
  assert.match(slides('#+BEAMER_THEME: Madrid\n* F\nx\n'), /<body class="bar">/);
  assert.match(slides('#+BEAMER_THEME: Whatever\n* F\nx\n'), /<body class="plain">/);
  assert.equal(frames(slides('* COMMENT hidden\nx\n* shown\ny\n')).length, 1);
});
