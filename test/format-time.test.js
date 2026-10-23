import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.TZ = 'America/New_York'; // the zone the Emacs answers were made in
const { formatTimeString } = await import('../src/format-time.js');

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/format-time-oracle.json', import.meta.url), 'utf8'));

test('format-time-string agrees with Emacs on every format, instant and zone', () => {
  const wrong = [];
  oracle.instants.forEach((instant, k) => {
    const date = new Date(instant[7]);
    oracle.formats.forEach((format, i) => {
      const [local, utc] = oracle.results[k][i];
      const gotLocal = formatTimeString(date, format);
      const gotUtc = formatTimeString(date, format, { utc: true });
      if (gotLocal !== local) wrong.push(`${format} @${k}: ${JSON.stringify(gotLocal)} != ${JSON.stringify(local)}`);
      if (gotUtc !== utc) wrong.push(`${format} @${k} utc: ${JSON.stringify(gotUtc)} != ${JSON.stringify(utc)}`);
    });
  });
  assert.deepEqual(wrong.slice(0, 40), [], `${wrong.length} differ`);
});
