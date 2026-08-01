import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGithubAdapter,
  isGithubConfigured,
  utf8ToBase64,
  base64ToUtf8,
} from '../src-browser/github-adapter.js';

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const CONFIG = { token: 'tok123', owner: 'me', repo: 'notes', branch: 'main' };

// ---- UTF-8 / emoji round-trip (the highest-risk part) ---------------------

test('utf8ToBase64 / base64ToUtf8 round-trip plain ASCII', () => {
  const text = 'Hello, world!';
  assert.equal(base64ToUtf8(utf8ToBase64(text)), text);
});

test('utf8ToBase64 / base64ToUtf8 round-trip heavy emoji and multi-byte characters', () => {
  // Real content shape from an actual user file: emoji headings, accented
  // characters, non-Latin text.
  const text = '* \ud83d\udce5 Inbox - unprocessed\n** \ud83c\udf89 Anniversaries\nH\u00e9rm\u00e9tique Tourer, Ma\u00c9nglish\ud83e\udd11';
  assert.equal(base64ToUtf8(utf8ToBase64(text)), text);
});

test('base64ToUtf8 tolerates embedded newlines in the base64 (GitHub wraps its response content at 60 chars)', () => {
  const text = 'A'.repeat(200);
  const wrapped = utf8ToBase64(text).replace(/(.{10})/g, '$1\n');
  assert.equal(base64ToUtf8(wrapped), text);
});

// ---- isGithubConfigured ---------------------------------------------------

test('isGithubConfigured requires token, owner, and repo', () => {
  assert.equal(isGithubConfigured(CONFIG), true);
  assert.equal(isGithubConfigured({ ...CONFIG, token: '' }), false);
  assert.equal(isGithubConfigured({ ...CONFIG, owner: '' }), false);
  assert.equal(isGithubConfigured({ ...CONFIG, repo: '' }), false);
  assert.equal(isGithubConfigured(null), false);
});

// ---- read -------------------------------------------------------------

test('read: requests the correct URL with auth headers, and decodes content', async () => {
  let capturedUrl, capturedHeaders;
  await withMockFetch(
    async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return jsonResponse(200, { content: utf8ToBase64('* Hello'), sha: 'abc123' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.read('notes.org');
      assert.equal(result.content, '* Hello');
      assert.equal(result.hash, 'abc123');
    }
  );
  assert.equal(capturedUrl, 'https://api.github.com/repos/me/notes/contents/notes.org?ref=main');
  assert.equal(capturedHeaders.Authorization, 'Bearer tok123');
  assert.equal(capturedHeaders.Accept, 'application/vnd.github+json');
});

test('read: returns null on 404 (file does not exist) rather than throwing', async () => {
  await withMockFetch(
    async () => jsonResponse(404, { message: 'Not Found' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      assert.equal(await adapter.read('missing.org'), null);
    }
  );
});

test('read: throws an informative error on 401', async () => {
  await withMockFetch(
    async () => jsonResponse(401, { message: 'Bad credentials' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.rejects(adapter.read('notes.org'), /rejected the token/);
    }
  );
});

test('read: throws a clear error when the path is a directory, not a file', async () => {
  await withMockFetch(
    async () => jsonResponse(200, [{ name: 'a.org' }, { name: 'b.org' }]),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.rejects(adapter.read('journal'), /directory/);
    }
  );
});

test('read: throws when GitHub is not configured yet', async () => {
  const adapter = createGithubAdapter(() => ({ token: '', owner: '', repo: '' }));
  await assert.rejects(adapter.read('notes.org'), /not configured/);
});

// ---- write -------------------------------------------------------------

test('write: a brand-new file (no prior sha) omits sha from the request body', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) {
        return jsonResponse(404, { message: 'Not Found' }); // the internal existence-check read
      }
      return jsonResponse(201, { content: { sha: 'newsha001' } });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.write('new-file.org', '* New');
      assert.equal(result.hash, 'newsha001');
    }
  );
  const putCall = calls.find((c) => c.opts && c.opts.method === 'PUT');
  const body = JSON.parse(putCall.opts.body);
  assert.equal('sha' in body, false);
  assert.equal(body.content, utf8ToBase64('* New'));
  assert.match(body.message, /Create new-file\.org/);
});

test('write: updating an existing file includes the current sha to avoid clobbering a newer commit', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) {
        return jsonResponse(200, { content: utf8ToBase64('* Old'), sha: 'oldsha001' });
      }
      return jsonResponse(200, { content: { sha: 'updatedsha002' } });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.write('notes.org', '* Updated');
      assert.equal(result.hash, 'updatedsha002');
    }
  );
  const putCall = calls.find((c) => c.opts && c.opts.method === 'PUT');
  const body = JSON.parse(putCall.opts.body);
  assert.equal(body.sha, 'oldsha001');
  assert.match(body.message, /Update notes\.org/);
});

test('write: throws an informative error on failure rather than silently losing the edit', async () => {
  await withMockFetch(
    async (url, opts) => {
      if (!opts || !opts.method) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(403, { message: 'Resource not accessible by personal access token' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.rejects(adapter.write('notes.org', '* content'), /forbidden/);
    }
  );
});

// ---- exists -------------------------------------------------------------

test('exists: true when read succeeds, false on 404', async () => {
  await withMockFetch(
    async (url) => {
      return url.includes('present.org')
        ? jsonResponse(200, { content: utf8ToBase64('x'), sha: 's' })
        : jsonResponse(404, { message: 'Not Found' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      assert.equal(await adapter.exists('present.org'), true);
      assert.equal(await adapter.exists('absent.org'), false);
    }
  );
});

// ---- config reactivity ----------------------------------------------------

test('getConfig is called fresh on every operation, so a settings change mid-session takes effect', async () => {
  let currentConfig = { ...CONFIG, token: 'first-token' };
  let capturedAuth;
  await withMockFetch(
    async (url, opts) => {
      capturedAuth = opts.headers.Authorization;
      return jsonResponse(404, { message: 'Not Found' });
    },
    async () => {
      const adapter = createGithubAdapter(() => currentConfig);
      await adapter.read('a.org');
      assert.equal(capturedAuth, 'Bearer first-token');

      currentConfig = { ...CONFIG, token: 'second-token' };
      await adapter.read('a.org');
      assert.equal(capturedAuth, 'Bearer second-token');
    }
  );
});

// ---- list() -------------------------------------------------------------

test('list() returns files and directories, sorted directories-first then alphabetically', () => {
  return withMockFetch(
    async () =>
      jsonResponse(200, [
        { name: 'zebra.org', path: 'zebra.org', type: 'file' },
        { name: 'archive', path: 'archive', type: 'dir' },
        { name: 'apple.org', path: 'apple.org', type: 'file' },
        { name: 'journal', path: 'journal', type: 'dir' },
      ]),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const entries = await adapter.list();
      assert.deepEqual(
        entries.map((e) => e.name),
        ['archive', 'journal', 'apple.org', 'zebra.org']
      );
      assert.deepEqual(
        entries.map((e) => e.type),
        ['dir', 'dir', 'file', 'file']
      );
    }
  );
});

test('list() correctly requests a subdirectory path', () => {
  let requestedUrl = null;
  return withMockFetch(
    async (url) => {
      requestedUrl = url;
      return jsonResponse(200, [{ name: '2026.org', path: 'journal/2026.org', type: 'file' }]);
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const entries = await adapter.list('journal');
      assert.match(requestedUrl, /\/contents\/journal\?/);
      assert.deepEqual(entries, [{ name: '2026.org', path: 'journal/2026.org', type: 'file' }]);
    }
  );
});

test('list() wraps a single-file response (not an array) into a one-item list', () => {
  return withMockFetch(
    async () => jsonResponse(200, { name: 'notes.org', path: 'notes.org', type: 'file' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const entries = await adapter.list('notes.org');
      assert.deepEqual(entries, [{ name: 'notes.org', path: 'notes.org', type: 'file' }]);
    }
  );
});

test('list() returns an empty array for a 404 rather than throwing', () => {
  return withMockFetch(
    async () => jsonResponse(404, { message: 'Not Found' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      assert.deepEqual(await adapter.list('nonexistent'), []);
    }
  );
});

test('list() filters out entries that are neither file nor dir (e.g. submodule, symlink)', () => {
  return withMockFetch(
    async () =>
      jsonResponse(200, [
        { name: 'notes.org', path: 'notes.org', type: 'file' },
        { name: 'some-submodule', path: 'some-submodule', type: 'submodule' },
        { name: 'a-symlink', path: 'a-symlink', type: 'symlink' },
      ]),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const entries = await adapter.list();
      assert.deepEqual(
        entries.map((e) => e.name),
        ['notes.org']
      );
    }
  );
});

test('list() throws a clear error on a non-ok, non-404 response', () => {
  return withMockFetch(
    async () => jsonResponse(403, { message: 'rate limited' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.rejects(() => adapter.list(), /forbidden/i);
    }
  );
});

test('list() requires configuration, same as read/write', () => {
  const adapter = createGithubAdapter(() => null);
  return assert.rejects(() => adapter.list(), /not configured yet/);
});

// ---- readBinary -----------------------------------------------------------

test('readBinary returns the base64 content directly, without utf8-decoding it', () => {
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes -- not valid utf8, would corrupt if decoded
  const base64 = imageBytes.toString('base64');
  return withMockFetch(
    async () => jsonResponse(200, { content: base64, sha: 'img-sha' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.readBinary('photo.png');
      assert.equal(result.base64, base64);
      assert.equal(result.hash, 'img-sha');
      // round-trip: decoding the returned base64 must reproduce the exact original bytes
      assert.deepEqual(Buffer.from(result.base64, 'base64'), imageBytes);
    }
  );
});

test('readBinary strips MIME-style line wrapping from GitHub\u2019s own response', () => {
  return withMockFetch(
    async () => jsonResponse(200, { content: 'YWJj\nZGVm\n', sha: 's' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.readBinary('file.bin');
      assert.equal(result.base64, 'YWJjZGVm');
    }
  );
});

test('readBinary returns null for a 404, matching read()\u2019s own convention', () => {
  return withMockFetch(
    async () => jsonResponse(404, { message: 'Not Found' }),
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      assert.equal(await adapter.readBinary('missing.png'), null);
    }
  );
});

// ---- cache: 'no-store' on every GET (prevents a stale sha from a --
// browser-cached read causing a false "conflict" on the very next write,
// especially with repeated captures to the same file in quick succession) --

test('read() passes cache: "no-store" so a fresh sha is always fetched, never a stale cached one', () => {
  let capturedOpts = null;
  return withMockFetch(
    async (url, opts) => { capturedOpts = opts; return jsonResponse(200, { content: '', sha: 's' }); },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.read('notes.org');
      assert.equal(capturedOpts.cache, 'no-store');
    }
  );
});

test('readBinary() also passes cache: "no-store"', () => {
  let capturedOpts = null;
  return withMockFetch(
    async (url, opts) => { capturedOpts = opts; return jsonResponse(200, { content: '', sha: 's' }); },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.readBinary('photo.png');
      assert.equal(capturedOpts.cache, 'no-store');
    }
  );
});

test('list() also passes cache: "no-store"', () => {
  let capturedOpts = null;
  return withMockFetch(
    async (url, opts) => { capturedOpts = opts; return jsonResponse(200, []); },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.list('');
      assert.equal(capturedOpts.cache, 'no-store');
    }
  );
});
