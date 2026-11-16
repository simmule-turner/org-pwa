import fs from 'node:fs';

/** sw.js as a script a test can run in a sandbox: its one `import` of the version becomes the constant it stands for. */
export function swSource() {
  const version = /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(new URL('../src-browser/version.js', import.meta.url), 'utf8'))[1];
  const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const out = source.replace(/^import \{ APP_VERSION as CACHE_NAME \} from '[^']+';$/m, `const CACHE_NAME = '${version}';`);
  if (out === source) throw new Error('sw.js does not import its version');
  return out;
}
