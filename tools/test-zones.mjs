// Runs the unit tests under three time zones (west of UTC, a half-hour offset, and far east), because
// a test that quietly assumes the machine's zone only fails for users somewhere else. Usage: node tools/test-zones.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ZONES = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'];
const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
let failed = 0;
const started = Date.now();
for (const [n, TZ] of ZONES.entries()) {
  console.log(`[${n + 1}/${ZONES.length}] ${TZ} ... (${Math.round((Date.now() - started) / 1000)}s elapsed)`);
  const run = spawnSync(process.execPath, ['--import', './test/support/fixed-clock.mjs', '--test', ...files], { env: { ...process.env, TZ }, encoding: 'utf8' });
  const line = (name) => new RegExp(`^# ${name} (\\d+)$`, 'm').exec(run.stdout)?.[1] ?? '?';
  console.log(`${TZ.padEnd(18)} pass ${line('pass')}  fail ${line('fail')}`);
  if (run.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
