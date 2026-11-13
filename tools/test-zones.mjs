// Runs the unit tests under three time zones (west of UTC, a half-hour offset, and far east), because
// a test that quietly assumes the machine's zone only fails for users somewhere else. The three runs go at the same time, each
// with the frozen clock the plain `npm test` uses, so this is also the whole unit-test run (America/New_York is `npm test`'s own zone).
// Usage: node tools/test-zones.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ZONES = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'];
const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

function runZone(TZ) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', './test/support/fixed-clock.mjs', '--test', ...files], { env: { ...process.env, TZ }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ TZ, status, out }));
  });
}

console.log(`running ${ZONES.length} time zones together: ${ZONES.join(', ')} (${elapsed()} elapsed)`);
const beat = setInterval(() => console.log(`  ... still running (${elapsed()} elapsed)`), 60000);
const results = await Promise.all(ZONES.map(runZone));
clearInterval(beat);

let failed = 0;
for (const { TZ, status, out } of results) {
  const line = (name) => new RegExp(`^# ${name} (\\d+)$`, 'm').exec(out)?.[1] ?? '?';
  console.log(`${TZ.padEnd(18)} tests ${line('tests')}  pass ${line('pass')}  fail ${line('fail')}  skipped ${line('skipped')}  cancelled ${line('cancelled')}`);
  if (status !== 0) {
    failed += 1;
    // the tests that failed, with their messages
    const bad = out.split('\n').filter((l) => /^\s*not ok /.test(l));
    console.log(`  ${TZ} failures:\n${bad.slice(0, 30).map((l) => '    ' + l.trim()).join('\n')}`);
  }
}
console.log(`done in ${elapsed()}`);
process.exit(failed ? 1 : 0);
