#!/usr/bin/env node
/**
 * Finds names a browser module uses but never declares or imports.
 *
 *   node tools/check-scope.mjs
 *
 * app.js and src-browser/ are ES modules that can't be loaded in Node (they
 * need a DOM), and a missing import doesn't fail when the module loads -- only
 * when that code path finally runs, which for a rarely used flow can be long
 * after the change. This runs a real scope analysis over every one of them
 * and reports any identifier that resolves to nothing but a browser global.
 * Exits 1 if it finds any.
 *
 * test/module-structure.test.js catches the other half (importing a name a
 * module doesn't export, duplicate imports, a stray module-level `let`) with
 * no dependencies; this one needs a parser, so it is dev-only, like
 * tools/smoke.mjs -- nothing in package.json depends on it. Install once:
 *   npm install --prefix /tmp/acorn acorn eslint-scope
 * (found via ACORN_DIR, default /tmp/acorn, or a global install).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function load(name) {
  const bases = [process.env.ACORN_DIR || '/tmp/acorn', execSync('npm root -g', { encoding: 'utf8' }).trim()];
  const attempts = [() => require(name), ...bases.flatMap((b) => [() => require(path.join(b, 'node_modules', name)), () => require(path.join(b, name))])];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try the next place */
    }
  }
  console.error(`${name} not found. Install it once with:\n  npm install --prefix /tmp/acorn acorn eslint-scope`);
  process.exit(2);
}
const acorn = load('acorn');
const eslintScope = load('eslint-scope');

// what a browser (and the JS language) provides without an import
const GLOBALS = new Set(
  ('document window navigator console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame fetch ' +
    'localStorage sessionStorage indexedDB location history alert confirm prompt URL URLSearchParams Blob File FileReader FormData Headers ' +
    'Request Response AbortController Event CustomEvent KeyboardEvent MouseEvent PointerEvent Node Element HTMLElement HTMLInputElement ' +
    'HTMLTextAreaElement HTMLSelectElement HTMLAnchorElement Image Audio MediaRecorder MediaStream MessageChannel Notification DOMParser ' +
    'XMLSerializer TextEncoder TextDecoder crypto performance getComputedStyle matchMedia btoa atob structuredClone queueMicrotask ' +
    'ResizeObserver MutationObserver IntersectionObserver visualViewport screen Intl Promise Map Set WeakMap WeakSet Symbol Object Array ' +
    'String Number Boolean Math JSON Date RegExp Error TypeError RangeError SyntaxError Function parseInt parseFloat isNaN isFinite ' +
    'encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape undefined NaN Infinity globalThis Uint8Array Uint16Array ' +
    'Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer DataView BigInt Reflect Proxy WeakRef katex ' +
    'customElements CSS Worker self caches createImageBitmap DOMException Selection getSelection ClipboardItem DataTransfer FileList ' +
    'showOpenFilePicker showSaveFilePicker showDirectoryPicker').split(' ')
);

const files = ['app.js', ...fs.readdirSync(path.join(ROOT, 'src-browser')).filter((f) => f.endsWith('.js')).map((f) => `src-browser/${f}`)];
let problems = 0;
for (const file of files) {
  const ast = acorn.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', ranges: true, locations: true });
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const seen = new Map();
  for (const ref of scopes.globalScope.through) {
    if (GLOBALS.has(ref.identifier.name)) continue;
    if (!seen.has(ref.identifier.name)) seen.set(ref.identifier.name, ref.identifier.loc.start.line);
  }
  for (const [name, line] of seen) {
    problems++;
    console.log(`${file}:${line}: "${name}" is used but never declared or imported`);
  }
}
console.log(problems ? `\n${problems} undeclared name(s)` : `no undeclared names in ${files.length} files`);
process.exit(problems ? 1 : 0);
