// The date prompt (src/read-date.js) against Emacs 29.3's org-read-date: test/fixtures/read-date-oracle.json, from tools/gen-read-date-oracle.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readDate } from '../src/read-date.js';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/read-date-oracle.json', import.meta.url), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const local = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), Number(s.slice(14, 16)), Number(s.slice(17, 19) || 0));
const show = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

test('read-date matches Emacs for every typed form', () => {
  const bad = [];
  for (const r of rows) {
    const key = `${r.now}|${r.pf}|${r.ext}|${r.def ?? ''}|${r.endb ? 'e' : ''}|${r.in}`;
    if (!r.err && show(local(r.res)) !== r.res) continue; // a time this machine's zone skips (daylight saving): the oracle ran in UTC
    const got = readDate(r.in, { now: local(r.now + ':00'), defaultTime: r.def ? local(r.def + ':00') : null, preferFuture: r.pf === 'nil' ? false : r.pf === 't' ? true : 'time', extendTodayUntil: r.ext, endBound: r.endb });
    const want = { res: r.res, given: r.given, end: r.endb ? r.endGiven : false };
    const have = { res: show(got.date), given: got.timeGiven, end: r.endb ? got.endTimeGiven ?? false : false };
    if (r.err || JSON.stringify(want) !== JSON.stringify(have)) bad.push({ key, want, have, err: r.err });
  }
  assert.deepEqual(bad.slice(0, 25), [], `${bad.length} of ${rows.length} differ`);
});
