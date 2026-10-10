// Runs the unit tests under several time zones (a west-of-UTC one, UTC, east-of-UTC, a half-hour one and a far-east one), because
// a test that quietly assumes the machine's zone only fails for users somewhere else. Usage: node tools/test-zones.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ZONES = ['America/New_York', 'UTC', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Auckland'];
const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
let failed = 0;
for (const TZ of ZONES) {
  const run = spawnSync(process.execPath, ['--test', ...files], { env: { ...process.env, TZ }, encoding: 'utf8' });
  const line = (name) => new RegExp(`^# ${name} (\\d+)$`, 'm').exec(run.stdout)?.[1] ?? '?';
  console.log(`${TZ.padEnd(18)} pass ${line('pass')}  fail ${line('fail')}`);
  if (run.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
