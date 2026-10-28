import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../src-browser/', import.meta.url);

test('every multi-line box in the settings screens is made by settingsTextBox, so they all look and drag alike', () => {
  const files = readdirSync(dir).filter((f) => /^settings-.*\.js$/.test(f) && f !== 'settings-fields.js');
  let boxes = 0;
  for (const f of files) {
    const source = readFileSync(new URL(f, dir), 'utf8');
    for (const m of source.matchAll(/const (\w+) = document\.createElement\('textarea'\);/g)) {
      boxes++;
      assert.match(source, new RegExp(`settingsTextBox\\(${m[1]}\\)`), `${f}: ${m[1]} is not styled by settingsTextBox`);
      assert.doesNotMatch(source, new RegExp(`${m[1]}\\.(rows|style\\.(resize|fontFamily|fontSize|padding|borderRadius))\\b`), `${f}: ${m[1]} sets its own size or look`);
    }
  }
  assert.ok(boxes >= 5);
});
