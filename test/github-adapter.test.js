import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGithubAdapter,
  isGithubConfigured,
  utf8ToBase64,
  base64ToUtf8,
  encodeGithubPath,
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

// ---- writeBinary (attachments) ---------------------------------------------

test('writeBinary: sends the given base64 payload directly, without utf8-encoding it (which would corrupt binary data)', async () => {
  const calls = [];
  const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; // arbitrary base64-looking payload, not real image data -- content itself doesn't matter for this test
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) {
        return jsonResponse(404, { message: 'Not Found' }); // the internal existence-check read
      }
      return jsonResponse(201, { content: { sha: 'binsha001' } });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.writeBinary('data/ab/abc123/photo.png', fakeBase64);
      assert.equal(result.hash, 'binsha001');
    }
  );
  const putCall = calls.find((c) => c.opts && c.opts.method === 'PUT');
  const body = JSON.parse(putCall.opts.body);
  assert.equal(body.content, fakeBase64); // sent as-is, not double-encoded
  assert.equal('sha' in body, false);
});

test('writeBinary: updating an existing attachment includes the current sha, same as a text write', async () => {
  const calls = [];
  const fakeBase64 = 'aGVsbG8=';
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) {
        return jsonResponse(200, { content: 'b2xk', sha: 'oldbinsha' });
      }
      return jsonResponse(200, { content: { sha: 'newbinsha' } });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.writeBinary('data/ab/abc123/photo.png', fakeBase64);
      assert.equal(result.hash, 'newbinsha');
    }
  );
  const putCall = calls.find((c) => c.opts && c.opts.method === 'PUT');
  const body = JSON.parse(putCall.opts.body);
  assert.equal(body.sha, 'oldbinsha');
});

// ---- delete (attachments) --------------------------------------------------

test('delete: sends the current sha in the DELETE request body, matching GitHub\u2019s own actual precondition', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) return jsonResponse(200, { content: 'ZGF0YQ==', sha: 'existingsha001' });
      return jsonResponse(200, {});
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.delete('data/ab/abc123/photo.png');
    }
  );
  const deleteCall = calls.find((c) => c.opts && c.opts.method === 'DELETE');
  assert.ok(deleteCall, 'a DELETE request should have been sent');
  const body = JSON.parse(deleteCall.opts.body);
  assert.equal(body.sha, 'existingsha001');
});

test('delete: is a no-op (no DELETE request sent) when the file doesn\u2019t exist -- the end state is already true', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      return jsonResponse(404, { message: 'Not Found' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.doesNotReject(adapter.delete('data/ab/abc123/photo.png'));
    }
  );
  assert.equal(calls.some((c) => c.opts && c.opts.method === 'DELETE'), false);
});

test('delete: throws an informative error on failure', async () => {
  await withMockFetch(
    async (url, opts) => {
      if (!opts || !opts.method) return jsonResponse(200, { content: 'ZGF0YQ==', sha: 'sha1' });
      return jsonResponse(403, { message: 'Resource not accessible by personal access token' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await assert.rejects(adapter.delete('data/ab/abc123/photo.png'), /forbidden/);
    }
  );
});

// ---- encodeGithubPath (THE FIX: a real, confirmed URL-corruption bug) ------

test('THE FIX: encodeGithubPath encodes a space, preserving path structure', () => {
  assert.equal(encodeGithubPath('data/ab/xyz/vacation photo.jpg'), 'data/ab/xyz/vacation%20photo.jpg');
});

test('THE FIX: encodeGithubPath encodes "#", which would otherwise be misread as a URL fragment separator, silently truncating the actual request path', () => {
  const encoded = encodeGithubPath('data/ab/xyz/bug #42 screenshot.png');
  assert.doesNotMatch(encoded, /#/);
  assert.match(encoded, /%23/);
});

test('THE FIX: encodeGithubPath encodes "?", which would otherwise be misread as the start of a URL query string', () => {
  const encoded = encodeGithubPath('data/ab/xyz/what?.jpg');
  assert.doesNotMatch(encoded, /\?/);
  assert.match(encoded, /%3F/);
});

test('THE FIX: encodeGithubPath preserves "/" as real path separators, not encoding them as %2F', () => {
  const encoded = encodeGithubPath('data/ab/xyz/photo.jpg');
  assert.equal(encoded.split('/').length, 4);
});

test('THE FIX: a write() call for a path containing "#" sends a request URL where the path segment survives intact, not truncated at the "#"', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(201, { content: { sha: 'sha001' } });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.write('data/ab/xyz/bug #42 screenshot.png', 'content');
    }
  );
  const putCall = calls.find((c) => c.opts && c.opts.method === 'PUT');
  assert.match(putCall.url, /bug%20%2342%20screenshot\.png$/);
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

test('THE FIX: readBinary falls back to the Blobs API when content is omitted from the Contents API response -- GitHub\u2019s own real, documented behavior for any file over its own 1MB inline-content threshold (an ordinary camera photo easily exceeds this)', () => {
  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]); // JPEG magic bytes + arbitrary payload
  const photoBase64 = photoBytes.toString('base64');
  const calls = [];
  return withMockFetch(
    async (url) => {
      calls.push(url);
      if (url.includes('/git/blobs/')) {
        assert.match(url, /\/git\/blobs\/big-photo-sha$/);
        return jsonResponse(200, { content: photoBase64, sha: 'big-photo-sha', encoding: 'base64' });
      }
      // The Contents API's own real response shape for a file over 1MB: no "content" field at all, just metadata (including sha, and a download_url this fix deliberately does NOT rely on -- see fetchBlobContent's own docs for why the Blobs API is the more robust choice).
      return jsonResponse(200, { name: 'photo.jpg', sha: 'big-photo-sha', size: 3145728, download_url: 'https://raw.githubusercontent.com/x' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.readBinary('photo.jpg');
      assert.equal(result.base64, photoBase64);
      assert.equal(result.hash, 'big-photo-sha');
      assert.deepEqual(Buffer.from(result.base64, 'base64'), photoBytes);
    }
  ).then(() => {
    assert.equal(calls.length, 2, 'should have made exactly two requests: the initial Contents API call, then the Blobs API fallback');
  });
});

test('THE FIX: read() (text) falls back to the Blobs API the same way, for a large org file', () => {
  const text = 'a very large org file\u2019s own content, hypothetically';
  const base64 = Buffer.from(text, 'utf8').toString('base64');
  return withMockFetch(
    async (url) => {
      if (url.includes('/git/blobs/')) {
        return jsonResponse(200, { content: base64, sha: 'big-file-sha' });
      }
      return jsonResponse(200, { name: 'huge.org', sha: 'big-file-sha', size: 2000000 });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      const result = await adapter.read('huge.org');
      assert.equal(result.content, text);
      assert.equal(result.hash, 'big-file-sha');
    }
  );
});

test('readBinary does NOT call the Blobs API at all when content is already present (the ordinary, small-file case) -- no unnecessary second request', () => {
  const calls = [];
  return withMockFetch(
    async (url) => {
      calls.push(url);
      return jsonResponse(200, { content: 'aGVsbG8=', sha: 'small-sha' });
    },
    async () => {
      const adapter = createGithubAdapter(() => CONFIG);
      await adapter.readBinary('small.txt');
    }
  ).then(() => {
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0], /\/git\/blobs\//);
  });
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
