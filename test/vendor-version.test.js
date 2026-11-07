import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const script = fs.readFileSync(new URL('tools/build-mathjs-vendor.sh', root), 'utf8');
const bundle = fs.readFileSync(new URL('src/vendor/mathjs/mathjs-custom.min.js', root), 'utf8');

test('the vendored mathjs says which version it is, and it is the version the build script pins', () => {
  const pinned = /^MATHJS_VERSION="(\d+\.\d+\.\d+)"$/m.exec(script);
  assert.ok(pinned, 'the build script pins MATHJS_VERSION');
  const first = bundle.slice(0, bundle.indexOf('\n'));
  const written = /^\/\* mathjs (\d+\.\d+\.\d+), custom build/.exec(first);
  assert.ok(written, `the first line of the bundle names its version: ${first.slice(0, 80)}`);
  assert.equal(written[1], pinned[1]);
});

test('the build script installs exactly the pinned mathjs', () => {
  assert.match(script, /npm install --silent "mathjs@\$MATHJS_VERSION" esbuild/);
});
