#!/usr/bin/env node
/**
 * One command for a release.
 *
 *   node tools/release.mjs 484            bump the cache name in sw.js, check, and write ../org-pwa-v484.zip
 *   node tools/release.mjs 484 --smoke    also run the browser smoke test (about ten minutes)
 *   node tools/release.mjs --check        only the checks
 *
 * The unit tests, the time-zone run and the scope check run only when something other than sw.js and the documents has
 * changed since the last green run (a hash kept in .green-hash), so a documentation-only release is just the bump and the zip.
 * The zip keeps file times, leaves out native/, .git and node_modules, and never replaces an earlier version's zip.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
const args = process.argv.slice(2);
const version = args.find((a) => /^\d+$/.test(a));
const checkOnly = args.includes('--check');
const smoke = args.includes('--smoke');
if (!version && !checkOnly) {
  console.error('usage: node tools/release.mjs <version> [--smoke] | --check');
  process.exit(2);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'native']);
const DOCS = new Set(['sw.js', 'src-browser/version.js', 'README.org', 'CHANGELOG.org', 'test/testing.org', '.green-hash']);
function files(dir = '.') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name).replace(/^\.\//, '');
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : files(rel);
    return [rel];
  });
}
function sourceHash() {
  const h = crypto.createHash('sha256');
  for (const f of files().filter((f) => !DOCS.has(f) && !f.startsWith('docs/') && !f.endsWith('.zip')).sort()) {
    h.update(f + '\0');
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex');
}
function run(cmd, cmdArgs) {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${cmdArgs.join(' ')}`);
    process.exit(1);
  }
}

const hash = sourceHash();
const last = fs.existsSync('.green-hash') ? fs.readFileSync('.green-hash', 'utf8').trim() : '';
if (hash === last && !smoke) {
  console.log('Source unchanged since the last green run: skipping the tests.');
} else {
  run('npm', ['test', '--silent']);
  run('node', ['tools/test-zones.mjs']);
  run('node', ['tools/check-scope.mjs']);
  // lint and type-check when they are installed (npm install --no-save eslint @eslint/js globals typescript)
  if (fs.existsSync('node_modules/.bin/eslint')) run('npx', ['eslint', '.']);
  if (fs.existsSync('node_modules/.bin/tsc')) run('npx', ['tsc', '-p', 'tsconfig.json']);
  if (smoke) run('node', ['tools/smoke.mjs']);
  fs.writeFileSync('.green-hash', hash + '\n');
}
if (checkOnly) process.exit(0);

const sw = fs.readFileSync('sw.js', 'utf8');
const bumped = sw.replace(/const CACHE_NAME = 'org-pwa-shell-v\d+';/, `const CACHE_NAME = 'org-pwa-shell-v${version}';`);
if (bumped === sw && !sw.includes(`org-pwa-shell-v${version}'`)) {
  console.error('sw.js has no CACHE_NAME line to bump');
  process.exit(1);
}
if (bumped !== sw) fs.writeFileSync('sw.js', bumped);
fs.writeFileSync('src-browser/version.js', fs.readFileSync('src-browser/version.js', 'utf8').replace(/org-pwa-shell-v\d+/, `org-pwa-shell-v${version}`));

const zip = path.resolve('..', `org-pwa-v${version}.zip`);
if (fs.existsSync(zip)) {
  console.error(`${zip} already exists; versions are never overwritten`);
  process.exit(1);
}
run('zip', ['-X', '-q', '-r', zip, '.', '-x', 'native/*', '.git/*', 'node_modules/*', '.green-hash', '*.zip']);
console.log(`Wrote ${zip}`);
