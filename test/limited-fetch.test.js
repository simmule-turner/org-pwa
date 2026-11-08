import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, readJsonCapped, readLimited, readTextCapped, refuseByContentLength } from '../src-browser/limited-fetch.js';
import { SizeLimitError } from '../src/size-limits.js';

/** A fake streaming Response: `chunks` are delivered one per read, `gaps` (ms) delay each, `length` is the Content-Length header. */
function fakeResponse(chunks, { length, gaps = [] } = {}) {
  let i = 0;
  let cancelled = false;
  const response = {
    headers: { get: (name) => (/content-length/i.test(name) && length !== undefined ? String(length) : null) },
    body: {
      getReader: () => ({
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          if (gaps[i]) await new Promise((r) => setTimeout(r, gaps[i]));
          return { done: false, value: chunks[i++] };
        },
        async cancel() {
          cancelled = true;
        },
      }),
    },
    get cancelled() {
      return cancelled;
    },
    arrayBuffer: async () => Buffer.concat(chunks.map((c) => Buffer.from(c))).buffer,
  };
  return response;
}

const bytes = (n) => new Uint8Array(n).fill(65);

test('readLimited collects a stream under the limit', async () => {
  const out = await readLimited(fakeResponse([bytes(3), bytes(4)]), { maxBytes: 10 });
  assert.equal(out.length, 7);
});

test('readLimited stops and cancels the download as soon as it is over the limit', async () => {
  const response = fakeResponse([bytes(6), bytes(6), bytes(6)]);
  await assert.rejects(readLimited(response, { maxBytes: 10, kind: 'orgFile', name: 'a.org' }), (e) => e instanceof SizeLimitError && /"a\.org" is more than 10 bytes/.test(e.message) && e.atLeast === true);
  assert.equal(response.cancelled, true);
});

test('Content-Length over the limit refuses before any of the body is read', async () => {
  const response = fakeResponse([bytes(1)], { length: 50 });
  assert.throws(() => refuseByContentLength(response, 10, 'orgFile', 'x'), (e) => e instanceof SizeLimitError && e.atLeast === false);
  await assert.rejects(readLimited(response, { maxBytes: 10 }), SizeLimitError);
});

test('no limit (0) reads everything', async () => {
  assert.equal((await readLimited(fakeResponse([bytes(1000)]), { maxBytes: 0 })).length, 1000);
});

test('a response with no stream is read whole and then checked', async () => {
  const response = { headers: { get: () => null }, body: null, arrayBuffer: async () => bytes(20).buffer };
  await assert.rejects(readLimited(response, { maxBytes: 10 }), SizeLimitError);
  assert.equal((await readLimited(response, { maxBytes: 20 })).length, 20);
});

test('a download that stalls fails with a message instead of hanging', async () => {
  const response = fakeResponse([bytes(1), bytes(1)], { gaps: [0, 300] });
  await assert.rejects(readLimited(response, { idleSeconds: 0.05 }), /stopped for 0\.05 seconds/);
  assert.equal(response.cancelled, true);
});

test('fetchWithTimeout gives up when the server does not start answering, with a message that names the setting', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  try {
    await assert.rejects(fetchWithTimeout('https://example.test/', {}, 0.05), /No answer from the server in 0\.05 seconds.*Size limits/);
  } finally {
    globalThis.fetch = real;
  }
});

test('fetchWithTimeout does not cut a response off once it has started, and 0 means no timeout', async () => {
  const real = globalThis.fetch;
  let signalSeen = 'unset';
  globalThis.fetch = async (url, options) => {
    signalSeen = options.signal;
    return { ok: true };
  };
  try {
    assert.deepEqual(await fetchWithTimeout('https://example.test/', {}, 5), { ok: true });
    assert.equal(signalSeen.aborted, false);
    await fetchWithTimeout('https://example.test/', {}, 0);
    assert.equal(signalSeen, undefined);
  } finally {
    globalThis.fetch = real;
  }
});

test('readTextCapped reads an answer under the cap and names the answer when it is over', async () => {
  assert.equal(await readTextCapped(fakeResponse([bytes(3)]), 10, 'The listing'), 'AAA');
  await assert.rejects(readTextCapped(fakeResponse([bytes(8), bytes(8)]), 10, 'The listing'), /The listing is larger than 10 bytes, so it was not read\./);
  const r = fakeResponse([bytes(8), bytes(8)]);
  await assert.rejects(readTextCapped(r, 10, 'x'));
  assert.equal(r.cancelled, true, 'the download is stopped');
});

test('readJsonCapped parses an answer under the cap, refuses one over it, and passes bad JSON on as a SyntaxError', async () => {
  const json = (text) => fakeResponse([new TextEncoder().encode(text)]);
  assert.deepEqual(await readJsonCapped(json('{"a":1}'), 100, 'x'), { a: 1 });
  await assert.rejects(readJsonCapped(json('{"a":"' + 'b'.repeat(50) + '"}'), 10, 'GitHub\'s answer'), /GitHub's answer is larger than/);
  await assert.rejects(readJsonCapped(json('not json'), 100, 'x'), SyntaxError);
});
