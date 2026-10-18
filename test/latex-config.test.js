import test from 'node:test';
import assert from 'node:assert/strict';
import { readLisp, runInit } from '../src/lisp-read.js';
import { latexConfig, latexClassNames } from '../src/latex-config.js';
import { latexExportDefaults, LATEX_INIT_KEY } from '../src/export-defaults.js';

test('the Lisp reader handles strings, quotes, dotted pairs, comments and escapes', () => {
  const [form] = readLisp(`; a comment\n(a "b\\"c\\\\d\\ne" . 'f)`);
  assert.equal(form.k, 'list');
  assert.equal(form.items.length, 2);
  assert.equal(form.items[1].v, 'b"c\\d\ne');
  assert.equal(form.tail.items[0].v, 'quote');
});

test('an init text adds to a list at the front, or at the end with a third argument, and not twice', () => {
  const vars = runInit(`(setq x '(1 2))\n(add-to-list 'x 3)\n(add-to-list 'x 4 t)\n(add-to-list 'x 3)\n(push 0 x)`);
  assert.deepEqual(vars.get('x').items.map((i) => i.v), [0, 3, 1, 2, 4]);
});

test('forms that need Emacs to run are ignored', () => {
  const vars = runInit(`(setq a (concat "x" "y"))\n(setq b "ok")\n(defun f () 1)`);
  assert.equal(vars.has('a'), false);
  assert.equal(vars.get('b').v, 'ok');
});

test('the defaults are Org’s: three classes, verbatim source blocks, no extra packages', () => {
  const cfg = latexConfig(undefined);
  assert.deepEqual(cfg.classes.map((c) => c.name), ['article', 'report', 'book']);
  assert.equal(cfg.backend, 'verbatim');
  assert.deepEqual(cfg.packages, []);
  assert.equal(cfg.listingsLangs.get('python'), 'Python');
});

test('org-latex-listings is the old name of org-latex-src-block-backend', () => {
  assert.equal(latexConfig(`(setq org-latex-listings t)`).backend, 'listings');
  assert.equal(latexConfig(`(setq org-latex-listings 'minted)`).backend, 'minted');
  assert.equal(latexConfig(`(setq org-latex-listings t)\n(setq org-latex-listings nil)`).backend, 'verbatim');
});

test('a class the init text defines shows up in the class list and as the default class', () => {
  const init = `(add-to-list 'org-latex-classes '("memo" "\\\\documentclass{article}" ("\\\\section{%s}" . "\\\\section*{%s}")))`;
  assert.deepEqual(latexClassNames(init), ['memo', 'article', 'report', 'book']);
  const defaults = latexExportDefaults({ [LATEX_INIT_KEY]: JSON.stringify(init), 'org-latex-default-class': '"memo"' });
  assert.equal(defaults.cls, 'memo');
  assert.equal(defaults.init, init);
});
