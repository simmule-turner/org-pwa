// Bundles the PWA into ./www for the native shell. There is no build step for the PWA itself: this copies the files its
// own service worker precaches (so the list can never drift from what the app needs), adds native-platform.js, and puts a
// <script> for it in front of the app's own script. Run from anywhere; ORG_PWA_ROOT overrides where the PWA lives.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, '..');
const root = path.resolve(process.env.ORG_PWA_ROOT || path.join(nativeDir, '..'));
const www = path.join(nativeDir, 'www');

const swText = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listStart = swText.indexOf('[', swText.indexOf('SHELL_FILES'));
const listEnd = swText.indexOf('];', listStart);
if (listStart < 0 || listEnd < 0) throw new Error("couldn't find SHELL_FILES in sw.js");
const files = [...swText.slice(listStart, listEnd).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]); // './' itself has no file name, so it is skipped
const required = ['index.html', 'app.js', 'README.org'];
for (const name of required) if (!files.includes(name)) throw new Error(`${name} is not in sw.js's SHELL_FILES`);

fs.rmSync(www, { recursive: true, force: true });
let bytes = 0;
for (const name of files) {
  const from = path.join(root, name);
  if (!fs.existsSync(from)) throw new Error(`sw.js lists ${name} but it is not in ${root}`);
  const to = path.join(www, name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(from).size;
}

fs.copyFileSync(path.join(nativeDir, 'native-platform.js'), path.join(www, 'native-platform.js'));
const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const appScript = /<script\b[^>]*\bsrc=["']app\.js["'][^>]*>/;
if (!appScript.test(html)) throw new Error("index.html has no <script src=\"app.js\"> to put native-platform.js in front of");
html = html.replace(appScript, (tag) => `<script src="native-platform.js"></script>\n    ${tag}`);
if ((html.match(/native-platform\.js/g) || []).length !== 1) throw new Error('native-platform.js was not added exactly once');
fs.writeFileSync(indexPath, html);

const version = (/CACHE_NAME\s*=\s*'([^']+)'/.exec(swText) || [])[1] || 'unknown';
const shell = JSON.parse(fs.readFileSync(path.join(nativeDir, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(www, 'native-shell.json'), JSON.stringify({ shell, web: version }, null, 2) + '\n');
console.log(`bundled ${files.length} files (${(bytes / 1024).toFixed(0)} KB) from ${root} into ${www}\nweb ${version}, shell ${shell}`);
