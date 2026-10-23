// Shared by test/ox-odt.test.js and tools/gen-odt-fixtures.mjs: the body of an exported content.xml with
// the generated names removed, one tag per line, so a diff shows what changed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseOrg } from '../../src/org-parser.js';
import { odtContentXml } from '../../src/ox-odt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '..', 'fixtures', 'odt');

/** Loads the vendored KaTeX as the browser would have it (window.katex). */
export function loadKatex() {
  if (globalThis.katex) return;
  const ctx = /** @type {any} */ ({});
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', '..', 'src', 'vendor', 'katex', 'katex.min.js'), 'utf8'), ctx);
  /** @type {any} */ (globalThis).katex = ctx.katex;
}

/** The normalized body for a fixture name such as "p1". @param {string} name */
export function normalizedFixture(name) {
  loadKatex();
  const src = fs.readFileSync(path.join(FIXTURES, name + '.org'), 'utf8');
  const png = fs.readFileSync(path.join(FIXTURES, 'img.png')).toString('base64');
  const images = new Map([['file:img.png', 'data:image/png;base64,' + png]]);
  const rich = name === 'hl' || name === 'mx';
  let s = odtContentXml(parseOrg(src), null, { images, highlight: rich });
  s = s.slice(s.indexOf('<office:text')).replace(/<office:text[^>]*>/, '').replace(/<\/office:text>[\s\S]*/, '').replace(/<text:sequence-decls>[\s\S]*?<\/text:sequence-decls>/, '');
  s = s.replace(/text:name="Section\d+"/g, '').replace(/draw:name="[^"]*"/g, '').replace(/org[0-9a-f]{7}/g, 'ORG');
  return s.replace(/>\s*</g, '>\n<').replace(/\n\s*\n/g, '\n').trim() + '\n';
}

export const FIXTURE_NAMES = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.org')).map((f) => f.slice(0, -4)).sort();
