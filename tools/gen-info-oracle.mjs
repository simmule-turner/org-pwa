#!/usr/bin/env node
/**
 * Writes test/fixtures/info-oracle.json: what Emacs 29.3's info.el makes of the small manuals in test/fixtures/info/ (see
 * tools/info-oracle.el). The fixtures are rebuilt first with makeinfo (needs makeinfo and emacs on the PATH):
 *   node tools/gen-info-oracle.mjs
 * test/info-oracle.test.js holds the Info reader to the answers.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { askEmacs, buildSpec, loadManual } from './info-oracle-lib.mjs';

const dir = new URL('../test/fixtures/info/', import.meta.url).pathname;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};
for (const f of fs.readdirSync(dir)) if (/^(sample|zsplit)\.info/.test(f) || /^sample-split\.info/.test(f)) fs.rmSync(path.join(dir, f));
run('makeinfo', ['--no-split', 'sample.texi', '-o', 'sample.info']);
run('makeinfo', ['--split-size=1500', 'sample.texi', '-o', 'sample-split.info']);
// the compressed split manual names itself in the directory, so that the directory entry reaches it
fs.writeFileSync(path.join(dir, 'zsplit.texi'), fs.readFileSync(path.join(dir, 'sample.texi'), 'utf8').replace('(sample)', '(zsplit)'));
run('makeinfo', ['--split-size=1500', 'zsplit.texi', '-o', 'zsplit.info']);
fs.rmSync(path.join(dir, 'zsplit.texi'));
for (const f of fs.readdirSync(dir)) if (/^zsplit\.info/.test(f)) run('gzip', ['-n', '-f', f]);

const files = ['sample.info', 'sample-split.info', 'zsplit.info', ...fs.readdirSync(dir).filter((f) => /^edge.*\.info$/.test(f))];
const out = {};
for (const f of files) {
  const manual = await loadManual(dir, f);
  const spec = buildSpec(manual, 3);
  const answers = askEmacs(dir, { [f]: spec });
  out[f] = { spec, oracle: answers[f] };
}
fs.writeFileSync(new URL('../test/fixtures/info-oracle.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(files.length + ' manuals');
