import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkOpenUrl, normalizeExport, usableLinkPrefix } from '../src/extension-net.js';
import { setUserTableFunctions, recalculateTable } from '../src/table-formula.js';
import { cacheGet, cacheSet, checkCacheKey, checkFetchUrl, encodeCacheValue, hostAllowed, normalizeFetchOptions, parseLocationHeader, parseNetHeader, roundPosition } from '../src/extension-net.js';

test('fetch addresses: https, or http to this device only', () => {
  assert.equal(checkFetchUrl('https://api.open-meteo.com/v1/forecast?x=1').host, 'api.open-meteo.com');
  assert.equal(checkFetchUrl('http://127.0.0.1:8080/a').host, '127.0.0.1');
  assert.throws(() => checkFetchUrl('http://example.org/'), /https/);
  assert.throws(() => checkFetchUrl('ftp://example.org/'), /https/);
  assert.throws(() => checkFetchUrl('https://user:pw@example.org/'), /user name/);
  assert.throws(() => checkFetchUrl('nonsense'), /usable address/);
  assert.throws(() => checkFetchUrl('https://example.org/' + 'a'.repeat(3000)), /too long/);
});

test(':net and :location headers', () => {
  assert.deepEqual(parseNetHeader('api.open-meteo.com *.Example.org, 127.0.0.1'), ['api.open-meteo.com', '*.example.org', '127.0.0.1']);
  assert.deepEqual(parseNetHeader('no'), []);
  assert.throws(() => parseNetHeader('bad_host!'), /not a host name/);
  assert.equal(parseLocationHeader('yes'), true);
  assert.equal(parseLocationHeader('no'), false);
  assert.equal(parseLocationHeader(''), false);
});

test('host matching', () => {
  assert.equal(hostAllowed('a.example.org', ['*.example.org']), true);
  assert.equal(hostAllowed('example.org', ['*.example.org']), false);
  assert.equal(hostAllowed('evilexample.org', ['*.example.org']), false);
  assert.equal(hostAllowed('example.org', ['example.org']), true);
  assert.equal(hostAllowed('x.example.org', ['example.org']), false);
});

test('fetch options are reduced to a safe set', () => {
  assert.deepEqual(normalizeFetchOptions(undefined), { method: 'GET', headers: {}, body: undefined });
  const o = normalizeFetchOptions({ method: 'post', headers: { accept: 'application/json', 'x-api-key': 'k' }, body: { a: 1 } });
  assert.equal(o.method, 'POST');
  assert.deepEqual(o.headers, { Accept: 'application/json', 'X-Api-Key': 'k' });
  assert.equal(o.body, '{"a":1}');
  assert.throws(() => normalizeFetchOptions({ method: 'DELETE' }), /GET and POST/);
  assert.throws(() => normalizeFetchOptions({ headers: { Cookie: 'x' } }), /not allowed/);
  assert.throws(() => normalizeFetchOptions({ body: 'x' }), /no body/);
  assert.throws(() => normalizeFetchOptions({ method: 'POST', body: 'x'.repeat(200000) }), /100 KB/);
});

test('cache keys, values and limits', () => {
  assert.equal(checkCacheKey('weather:nyc'), 'weather:nyc');
  assert.throws(() => checkCacheKey('has space'), /cache key/);
  assert.throws(() => encodeCacheValue('x'.repeat(300000)), /200 KB/);
  let scope = {};
  scope = cacheSet(scope, 'a', encodeCacheValue({ n: 1 }), 1000);
  assert.deepEqual(cacheGet(scope, 'a', 500, 1400), { value: { n: 1 } });
  assert.equal(cacheGet(scope, 'a', 500, 1600), null);
  assert.deepEqual(cacheGet(scope, 'a', undefined, 99999), { value: { n: 1 } });
  assert.equal(cacheGet(scope, 'zz', 500, 1000), null);
  for (let i = 0; i < 150; i++) scope = cacheSet(scope, 'k' + i, '1', 2000 + i);
  assert.equal(Object.keys(scope).length, 100);
  assert.ok(scope.k149 && !scope.k0);
  let big = {};
  for (let i = 0; i < 8; i++) big = cacheSet(big, 'b' + i, JSON.stringify('y'.repeat(190000)), i);
  assert.ok(Object.values(big).reduce((n, e) => n + e.v.length, 0) <= 1024 * 1024);
  assert.ok(big.b7);
});

test('positions are rounded', () => {
  assert.deepEqual(roundPosition({ latitude: 40.712776, longitude: -74.005974, accuracy: 12.7 }, 5), { lat: 40.7128, lon: -74.006, accuracy: 13, time: 5 });
});

test('link prefixes and where a link may lead', () => {
  assert.equal(usableLinkPrefix('weather'), true);
  assert.equal(usableLinkPrefix('file'), false);
  assert.equal(usableLinkPrefix('javascript'), false);
  assert.equal(usableLinkPrefix('W'), false);
  assert.equal(checkLinkOpenUrl('https://example.org/a'), 'https://example.org/a');
  assert.ok(checkLinkOpenUrl('geo:40.7,-74.0').startsWith('geo:'));
  assert.throws(() => checkLinkOpenUrl('javascript:alert(1)'), /https, mailto/);
  assert.throws(() => checkLinkOpenUrl('http://example.org'), /https, mailto/);
  assert.throws(() => checkLinkOpenUrl('nonsense'), /usable link/);
});

test('export results', () => {
  assert.deepEqual(normalizeExport('hi', 'a.txt'), { text: 'hi', filename: 'a.txt', mime: 'text/plain' });
  assert.deepEqual(normalizeExport({ text: 'x', filename: '../evil/n?.csv', mime: 'text/csv' }), { text: 'x', filename: '.._evil_n_.csv'.replace(/^\.+/, ''), mime: 'text/csv' });
  assert.equal(normalizeExport({ text: 'x', mime: 'bad' }, 'f.txt').mime, 'text/plain');
  assert.throws(() => normalizeExport({ nope: 1 }), /returns text/);
  assert.throws(() => normalizeExport('x'.repeat(3 * 1024 * 1024)), /2 MB/);
});

test('table formulas can call a registered script function', () => {
  const table = { tblfm: '$3=double($1, $2)', rows: [{ type: 'row', cells: ['1', '2', ''] }, { type: 'row', cells: ['3', '4', ''] }] };
  assert.throws(() => recalculateTable(table, {}).length, /./, 'unknown without registration -> error');
  setUserTableFunctions(['double']);
  try {
    const seen = [];
    const rows = recalculateTable(table, { userCall: (name, args) => (seen.push([name, args]), args[0] * 2 + args[1]) });
    assert.deepEqual(rows.map((r) => r.cells[2]), ['4', '10']);
    assert.deepEqual(seen[0], ['double', [1, 2]]);
    const none = recalculateTable(table, {});
    assert.deepEqual(none.map((r) => r.cells[2]), ['#ERROR', '#ERROR']);
  } finally {
    setUserTableFunctions();
  }
});

test('calendar feeds parse into plain events', async () => {
  const { parseIcalendarEvents } = await import('../src/import-icalendar.js');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Dentist\\, Dr. Lee', 'DTSTART:20261012T133000', 'DTEND:20261012T141500', 'LOCATION:Main St', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Trash', 'DTSTART;VALUE=DATE:20261014', 'RRULE:FREQ=WEEKLY;INTERVAL=1', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Odd', 'DTSTART;VALUE=DATE:20261015', 'RRULE:FREQ=DAILY;COUNT=3', 'STATUS:CANCELLED', 'END:VEVENT',
    'BEGIN:VTODO', 'SUMMARY:A task', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
  const ev = parseIcalendarEvents(ics);
  assert.equal(ev.length, 3);
  assert.deepEqual([ev[0].summary, ev[0].start, ev[0].end, ev[0].allDay, ev[0].location, ev[0].repeat], ['Dentist, Dr. Lee', '2026-10-12 13:30', '2026-10-12 14:15', false, 'Main St', null]);
  assert.deepEqual([ev[1].start, ev[1].allDay, ev[1].repeat], ['2026-10-14', true, '+1w']);
  assert.deepEqual([ev[2].repeat, ev[2].rrule, ev[2].cancelled], [null, 'FREQ=DAILY;COUNT=3', true]);
});
