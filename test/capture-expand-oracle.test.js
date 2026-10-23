// Holds capture-template expansion to Emacs: test/fixtures/capture-expand-oracle.json was made by
// tools/gen-capture-expand-oracle.mjs, which fills each template with org-capture-fill-template in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandTemplate, scanPrompts } from '../src/capture-template.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-expand-oracle.json', import.meta.url), 'utf8'));

// Cases that rely on Emacs facilities the app does not have: %? is a prompt here, and Emacs reads %^{..}p, %(..), %[..] itself.
const APP_DIFFERS = new Set(['%?', '* %?', '- %?\n  more', 'a %? b', '* %^{Title}\n:PROPERTIES:\n:AUTHOR: %n\n:END:\n%?']);

function context() {
  const c = oracle.ctx;
  return {
    now: new Date(oracle.now),
    killRing: c.killRing,
    initial: c.initial,
    annotation: c.annotation,
    userFullName: c.fullName,
    clock: { heading: c.clockHeading, file: c.clockFile },
    originalFile: c.originalFile,
    linkProps: c.linkProps,
  };
}

function answersFor(template, ctx) {
  const strings = [...oracle.answers.strings];
  return scanPrompts(template, ctx).map((p) =>
    p.kind === 'tags' ? oracle.answers.tags : p.kind === 'timestamp' ? oracle.answers.date : p.kind === 'clipboard' ? oracle.answers.clip : strings.shift());
}

test('a template expands to what Emacs inserts', () => {
  const saved = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const wrong = [];
    for (const c of oracle.cases) {
      if (APP_DIFFERS.has(c.template)) continue;
      const ctx = context();
      let got;
      try {
        got = expandTemplate(c.template, { ...ctx, promptAnswers: answersFor(c.template, ctx) }).text;
      } catch (e) {
        got = 'ERROR';
      }
      const want = c.emacs.startsWith('ERROR') ? 'ERROR' : c.emacs;
      if (got !== want) wrong.push({ template: c.template, got, want });
    }
    assert.equal(wrong.length, 0, JSON.stringify(wrong, null, 1));
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
