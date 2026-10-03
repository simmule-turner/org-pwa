import test from 'node:test';
import assert from 'node:assert/strict';
import { CaldavError, basicAuthHeader, createCaldavClient, icsNamesFromHrefs, parseHrefs, runLimited } from '../src/caldav-client.js';

// A fetch that records every request and answers from a script.
function fakeFetch(answer = () => ({ status: 201 })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = answer({ url, ...init });
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: r.statusText || '', text: async () => r.body || '' };
  };
  fn.calls = calls;
  return fn;
}
const client = (fetch, extra = {}) => createCaldavClient({ url: 'https://dav.example.com/radicale/me/cal', username: 'me', password: 'pw', fetch, ...extra });

test('credentials go out as Basic auth encoded as UTF-8, so a non-ASCII password works', () => {
  assert.equal(basicAuthHeader('me', 'pw'), 'Basic ' + Buffer.from('me:pw').toString('base64'));
  assert.equal(basicAuthHeader('zoë', 'pässwörd'), 'Basic ' + Buffer.from('zoë:pässwörd', 'utf8').toString('base64'));
});

test('put writes the event to <calendar>/<name> as text/calendar, with the credentials', async () => {
  const f = fakeFetch();
  await client(f).put('orgpwa-a-1.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  const [c] = f.calls;
  assert.equal(c.method, 'PUT');
  assert.equal(c.url, 'https://dav.example.com/radicale/me/cal/orgpwa-a-1.ics');
  assert.equal(c.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.equal(c.headers.Authorization, basicAuthHeader('me', 'pw'));
  assert.equal(c.body, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
});

test('a calendar address with or without a trailing slash works, and names are URL-encoded', async () => {
  const f = fakeFetch();
  await createCaldavClient({ url: 'https://h/cal/', username: 'u', password: 'p', fetch: f }).put('orgpwa-a b#1.ics', 'x');
  assert.equal(f.calls[0].url, 'https://h/cal/orgpwa-a%20b%231.ics');
});

test('201, 204 and 200 all count as written', async () => {
  for (const status of [200, 201, 204]) await client(fakeFetch(() => ({ status }))).put('a.ics', 'x');
});

test('remove deletes the event, and an event that is already gone counts as removed', async () => {
  const f = fakeFetch(() => ({ status: 404 }));
  await client(f).remove('orgpwa-a-1.ics');
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].url, 'https://dav.example.com/radicale/me/cal/orgpwa-a-1.ics');
  await client(fakeFetch(() => ({ status: 204 }))).remove('x.ics');
  await client(fakeFetch(() => ({ status: 200 }))).remove('x.ics');
});

test('failures are classified so the caller can say what to do', async () => {
  const kind = async (status, op = 'put') => client(fakeFetch(() => ({ status })))[op]('a.ics', 'x').then(() => null, (e) => [e.kind, e.status]);
  assert.deepEqual(await kind(401), ['auth', 401]);
  assert.deepEqual(await kind(403), ['auth', 403]);
  assert.deepEqual(await kind(404), ['not-found', 404]);
  assert.deepEqual(await kind(409), ['not-found', 409]);
  assert.deepEqual(await kind(500), ['server', 500]);
  assert.deepEqual(await kind(401, 'remove'), ['auth', 401]);
  assert.deepEqual(await kind(500, 'remove'), ['server', 500]);
});

test('a network failure (which in a browser is also what a missing CORS permission looks like) is reported as such', async () => {
  const e = await client(fakeFetch(() => new TypeError('Failed to fetch'))).put('a.ics', 'x').then(() => null, (err) => err);
  assert.ok(e instanceof CaldavError);
  assert.equal(e.kind, 'network');
  assert.match(e.message, /CORS/);
});

test('list asks for the folder at depth 1 and returns the .ics file names', async () => {
  const body = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/radicale/me/cal/</href></response>
    <response><href>/radicale/me/cal/orgpwa-a-1.ics</href></response>
    <response><href>/radicale/me/cal/personal%20event.ics</href></response>
    <response><href>/radicale/me/cal/readme.txt</href></response></multistatus>`;
  const f = fakeFetch(() => ({ status: 207, body }));
  const names = await client(f).list();
  assert.equal(f.calls[0].method, 'PROPFIND');
  assert.equal(f.calls[0].headers.Depth, '1');
  assert.deepEqual(names, ['orgpwa-a-1.ics', 'personal event.ics']);
});

test('the hrefs are found whatever namespace prefix the server uses, and as full URLs or paths', () => {
  const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>https://h/cal/a.ics</D:href></D:response><d:response><d:href>/cal/b.ics</d:href></d:response></D:multistatus>';
  assert.deepEqual(parseHrefs(xml), ['https://h/cal/a.ics', '/cal/b.ics']);
  assert.deepEqual(icsNamesFromHrefs(parseHrefs(xml)), ['a.ics', 'b.ics']);
});

test('the folder itself is skipped, and only lower-case .ics names count (the names this app writes)', () => {
  assert.deepEqual(icsNamesFromHrefs(['/cal/', '/cal/x.ICS', '/cal/y.ics']), ['y.ics']);
});

test('a name with broken percent-encoding is kept as it is instead of throwing', () => {
  assert.deepEqual(icsNamesFromHrefs(['/cal/%E0%A4%A.ics']), ['%E0%A4%A.ics']);
});

test('check passes for a reachable calendar and says why when it is not', async () => {
  await client(fakeFetch(() => ({ status: 207, body: '<multistatus xmlns="DAV:"/>' }))).check();
  const e = await client(fakeFetch(() => ({ status: 401 }))).check().then(() => null, (err) => err);
  assert.equal(e.kind, 'auth');
});

// ---- runLimited -----------------------------------------------------------------------------------

test('runLimited never has more than `limit` running at once, and does every item', async () => {
  let running = 0;
  let peak = 0;
  const done = [];
  const result = await runLimited([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    done.push(n);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.ok.length, 8);
  assert.equal(result.failed.length, 0);
});

test('an ordinary failure on one item does not stop the others', async () => {
  const result = await runLimited(['a', 'b', 'c'], 1, async (x) => { if (x === 'b') throw new CaldavError('server', 'boom', 500); });
  assert.deepEqual(result.ok, ['a', 'c']);
  assert.deepEqual(result.failed.map((f) => f.item), ['b']);
  assert.equal(result.stopped, null);
});

test('a failure the whole run shares (credentials, address, network) stops it, since the rest would fail the same way', async () => {
  const attempted = [];
  const result = await runLimited(['a', 'b', 'c', 'd'], 1, async (x) => { attempted.push(x); if (x === 'b') throw new CaldavError('auth', 'no', 401); });
  assert.deepEqual(attempted, ['a', 'b']);
  assert.equal(result.stopped.kind, 'auth');
});

test('nothing to do is fine', async () => {
  const result = await runLimited([], 4, async () => { throw new Error('never'); });
  assert.deepEqual(result, { ok: [], failed: [], stopped: null });
});
