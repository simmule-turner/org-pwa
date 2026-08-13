import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebdavAdapter,
  isWebdavConfigured,
  fileUrl,
  encodePath,
  parsePropfindResponse,
  baseUrlPath,
  arrayBufferToBase64,
} from '../src-browser/webdav-adapter.js';

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

function textResponse(status, body, headers = {}) {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    headers: { get: (name) => headerMap.get(name) || null },
  };
}

const CONFIG = { baseUrl: 'https://cloud.example.com/remote.php/dav/files/me', username: 'me', password: 'app-pass' };

// ---- path/URL construction ------------------------------------------------

test('fileUrl joins baseUrl and path cleanly regardless of trailing/leading slashes', () => {
  assert.equal(
    fileUrl({ baseUrl: 'https://x.com/dav/' }, '/notes.org'),
    'https://x.com/dav/notes.org'
  );
  assert.equal(
    fileUrl({ baseUrl: 'https://x.com/dav' }, 'notes.org'),
    'https://x.com/dav/notes.org'
  );
});

test('encodePath encodes each segment but preserves slashes as directory separators', () => {
  assert.equal(encodePath('journal/my notes.org'), 'journal/my%20notes.org');
  assert.equal(encodePath('a/b/c.org'), 'a/b/c.org');
});

// ---- isWebdavConfigured ----------------------------------------------------

test('isWebdavConfigured requires baseUrl and username', () => {
  assert.equal(isWebdavConfigured(CONFIG), true);
  assert.equal(isWebdavConfigured({ ...CONFIG, baseUrl: '' }), false);
  assert.equal(isWebdavConfigured({ ...CONFIG, username: '' }), false);
  assert.equal(isWebdavConfigured(null), false);
});

// ---- read -------------------------------------------------------------

test('read: sends Basic auth and captures the ETag as the hash', async () => {
  let capturedHeaders;
  await withMockFetch(
    async (url, opts) => {
      capturedHeaders = opts.headers;
      return textResponse(200, '* Hello', { ETag: '"abc123"' });
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.read('notes.org');
      assert.equal(result.content, '* Hello');
      assert.equal(result.hash, '"abc123"');
    }
  );
  const expectedAuth = 'Basic ' + Buffer.from('me:app-pass').toString('base64');
  assert.equal(capturedHeaders.Authorization, expectedAuth);
});

test('read: returns null on 404', async () => {
  await withMockFetch(
    async () => textResponse(404, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      assert.equal(await adapter.read('missing.org'), null);
    }
  );
});

test('read: works fine when the server sends no ETag (not all WebDAV servers do)', async () => {
  await withMockFetch(
    async () => textResponse(200, '* content'), // no ETag header
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.read('notes.org');
      assert.equal(result.content, '* content');
      assert.equal(result.hash, null);
    }
  );
});

test('read: throws an informative error on 401', async () => {
  await withMockFetch(
    async () => textResponse(401, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.read('notes.org'), /rejected the credentials/);
    }
  );
});

test('read: throws when WebDAV is not configured yet', async () => {
  const adapter = createWebdavAdapter(() => ({ baseUrl: '', username: '' }));
  await assert.rejects(adapter.read('notes.org'), /not configured/);
});

test('read: a network-level failure (e.g. CORS block) surfaces with a CORS hint, not a bare error', async () => {
  await withMockFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.read('notes.org'), /CORS/);
    }
  );
});

// ---- write -------------------------------------------------------------

test('write: a new file (no existing ETag) sends If-None-Match: *', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts);
      if (opts.method === 'GET') return textResponse(404, '');
      return textResponse(201, '', { ETag: '"new001"' });
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.write('new.org', '* New');
      assert.equal(result.hash, '"new001"');
    }
  );
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall.headers['If-None-Match'], '*');
  assert.equal('If-Match' in putCall.headers, false);
  assert.equal(putCall.body, '* New');
});

test('write: updating an existing file sends If-Match with the current ETag', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts);
      if (opts.method === 'GET') return textResponse(200, '* Old', { ETag: '"old001"' });
      return textResponse(200, '', { ETag: '"updated002"' });
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.write('notes.org', '* Updated');
      assert.equal(result.hash, '"updated002"');
    }
  );
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall.headers['If-Match'], '"old001"');
});

test('write: proceeds without a conditional header when the server never sends ETags', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts);
      if (opts.method === 'GET') return textResponse(200, '* Old'); // no ETag
      return textResponse(200, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await adapter.write('notes.org', '* Updated');
    }
  );
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal('If-Match' in putCall.headers, false);
  assert.equal('If-None-Match' in putCall.headers, false);
});

test('write: throws on a 412 precondition failure (server-side conflict)', async () => {
  await withMockFetch(
    async (url, opts) => {
      if (opts.method === 'GET') return textResponse(200, '* Old', { ETag: '"old"' });
      return textResponse(412, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.write('notes.org', '* content'), /changed on the server/);
    }
  );
});

// ---- writeBinary (attachments) ---------------------------------------------

test('writeBinary: a new attachment (no existing ETag) sends If-None-Match: *, with the actual decoded bytes as the PUT body', async () => {
  const calls = [];
  const fakeBase64 = arrayBufferToBase64(new Uint8Array([1, 2, 3, 4]).buffer);
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts);
      if (opts.method === 'GET') return textResponse(404, '');
      return textResponse(201, '', { ETag: '"binnew001"' });
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.writeBinary('data/ab/abc123/photo.png', fakeBase64);
      assert.equal(result.hash, '"binnew001"');
    }
  );
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall.headers['If-None-Match'], '*');
  assert.equal('If-Match' in putCall.headers, false);
  assert.deepEqual(Array.from(new Uint8Array(putCall.body)), [1, 2, 3, 4]); // real decoded bytes, not the base64 text itself
});

test('writeBinary: updating an existing attachment sends If-Match with the current ETag', async () => {
  const calls = [];
  const existingBytes = new Uint8Array([9, 9, 9]);
  const fakeBase64 = arrayBufferToBase64(new Uint8Array([5, 6, 7]).buffer);
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts);
      if (opts.method === 'GET') {
        return { status: 200, ok: true, arrayBuffer: async () => existingBytes.buffer, headers: { get: (n) => (n === 'ETag' ? '"binold001"' : null) } };
      }
      return textResponse(200, '', { ETag: '"binupdated002"' });
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.writeBinary('data/ab/abc123/photo.png', fakeBase64);
      assert.equal(result.hash, '"binupdated002"');
    }
  );
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall.headers['If-Match'], '"binold001"');
});

// ---- THE FIX: intermediate-directory creation (the reported WebDAV bug) ----

test('THE FIX: writeBinary on a brand-new file whose own path has a missing intermediate folder creates every level via MKCOL, then retries the PUT once, succeeding', () => {
  const calls = [];
  let putAttempts = 0;
  return withMockFetch(
    async (url, opts) => {
      calls.push({ url, method: opts.method });
      if (opts.method === 'GET') return textResponse(404, '');
      if (opts.method === 'MKCOL') return textResponse(201, '');
      if (opts.method === 'PUT') {
        putAttempts++;
        if (putAttempts === 1) return textResponse(409, '');
        return textResponse(201, '', { ETag: '"new-photo-sha"' });
      }
      return textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.writeBinary('org-pwa/data/ae/xyz/photo.jpg', 'ZmFrZQ==');
      assert.equal(result.hash, '"new-photo-sha"');
    }
  ).then(() => {
    const mkcolCalls = calls.filter((c) => c.method === 'MKCOL');
    // Every intermediate level, shallowest first, in order -- NOT the file itself.
    assert.equal(mkcolCalls.length, 4);
    assert.match(mkcolCalls[0].url, /org-pwa\/$/);
    assert.match(mkcolCalls[1].url, /org-pwa\/data\/$/);
    assert.match(mkcolCalls[2].url, /org-pwa\/data\/ae\/$/);
    assert.match(mkcolCalls[3].url, /org-pwa\/data\/ae\/xyz\/$/);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2, 'exactly one retry, not more');
  });
});

test('an MKCOL response indicating the folder already exists (405) is tolerated silently, not treated as an error', () => {
  return withMockFetch(
    async (url, opts) => {
      if (opts.method === 'GET') return textResponse(404, '');
      if (opts.method === 'MKCOL') return textResponse(405, ''); // "already exists" -- the most common real-server response for this
      if (opts.method === 'PUT') return textResponse(201, '', { ETag: '"ok"' });
      return textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.doesNotReject(adapter.writeBinary('a/b/photo.jpg', 'ZmFrZQ=='));
    }
  );
});

test('a genuine MKCOL failure (not "already exists") propagates as a real, informative error', () => {
  return withMockFetch(
    async (url, opts) => {
      if (opts.method === 'GET') return textResponse(404, '');
      if (opts.method === 'MKCOL') return textResponse(500, '');
      if (opts.method === 'PUT') return textResponse(409, '');
      return textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.writeBinary('a/b/photo.jpg', 'ZmFrZQ=='), /could not create.*folder/i);
    }
  );
});

test('a 409 while updating an EXISTING file (a genuine ETag precondition failure) does NOT trigger the MKCOL cascade at all -- only a brand-new file does', () => {
  const calls = [];
  return withMockFetch(
    async (url, opts) => {
      calls.push(opts.method);
      if (opts.method === 'GET') {
        return { status: 200, ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: (n) => (n === 'ETag' ? '"current-sha"' : null) } };
      }
      if (opts.method === 'PUT') return textResponse(409, ''); // a real conflict -- the file changed since read
      return textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.writeBinary('existing/photo.jpg', 'ZmFrZQ=='));
    }
  ).then(() => {
    assert.equal(calls.filter((m) => m === 'MKCOL').length, 0);
    assert.equal(calls.filter((m) => m === 'PUT').length, 1, 'no retry -- this was a real conflict, not a missing folder');
  });
});

test('writeImpl (text) gets the identical MKCOL-and-retry fix for a brand-new text file too', () => {
  const calls = [];
  let putAttempts = 0;
  return withMockFetch(
    async (url, opts) => {
      calls.push(opts.method);
      if (opts.method === 'GET') return textResponse(404, '');
      if (opts.method === 'MKCOL') return textResponse(201, '');
      if (opts.method === 'PUT') {
        putAttempts++;
        return putAttempts === 1 ? textResponse(409, '') : textResponse(201, '', { ETag: '"ok"' });
      }
      return textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.write('journal/2026/new-file.org', 'content');
      assert.equal(result.hash, '"ok"');
    }
  ).then(() => {
    assert.equal(calls.filter((m) => m === 'MKCOL').length, 2); // "journal/", "journal/2026/"
  });
});

// ---- delete (attachments) --------------------------------------------------

test('delete: sends a real HTTP DELETE request to the file\u2019s own URL', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push({ url, opts });
      return textResponse(204, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await adapter.delete('data/ab/abc123/photo.png');
    }
  );
  const deleteCall = calls.find((c) => c.opts.method === 'DELETE');
  assert.ok(deleteCall, 'a DELETE request should have been sent');
  assert.match(deleteCall.url, /data\/ab\/abc123\/photo\.png$/);
});

test('delete: a 404 (already gone) is treated as success, not an error', async () => {
  await withMockFetch(
    async () => textResponse(404, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.doesNotReject(adapter.delete('data/ab/abc123/photo.png'));
    }
  );
});

test('delete: throws on a genuine server error', async () => {
  await withMockFetch(
    async () => textResponse(500, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(adapter.delete('data/ab/abc123/photo.png'));
    }
  );
});

// ---- exists -------------------------------------------------------------

test('exists: uses HEAD and reflects response.ok', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts.method);
      return url.includes('present.org') ? textResponse(200, '') : textResponse(404, '');
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      assert.equal(await adapter.exists('present.org'), true);
      assert.equal(await adapter.exists('absent.org'), false);
    }
  );
  assert.ok(calls.every((m) => m === 'HEAD'));
});

// ---- parsePropfindResponse -------------------------------------------------

const SAMPLE_PROPFIND_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/me/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/me/notes.org</d:href>
    <d:propstat>
      <d:prop><d:resourcetype/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/me/journal/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

test('parsePropfindResponse extracts href and collection status for every response block', () => {
  const entries = parsePropfindResponse(SAMPLE_PROPFIND_XML);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].href, '/remote.php/dav/files/me/');
  assert.equal(entries[0].isCollection, true);
  assert.equal(entries[1].href, '/remote.php/dav/files/me/notes.org');
  assert.equal(entries[1].isCollection, false);
  assert.equal(entries[2].href, '/remote.php/dav/files/me/journal/');
  assert.equal(entries[2].isCollection, true);
});

test('parsePropfindResponse handles an uppercase namespace prefix (some servers use D: instead of d:)', () => {
  const xml = SAMPLE_PROPFIND_XML.replace(/d:/g, 'D:');
  const entries = parsePropfindResponse(xml);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].isCollection, false);
});

test('parsePropfindResponse decodes percent-encoded characters in href (e.g. a space in a filename)', () => {
  const xml = `<d:multistatus xmlns:d="DAV:">
    <d:response><d:href>/dav/files/me/my%20notes.org</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    </d:response>
  </d:multistatus>`;
  const entries = parsePropfindResponse(xml);
  assert.equal(entries[0].href, '/dav/files/me/my notes.org');
});

test('parsePropfindResponse returns an empty array for malformed/empty XML rather than throwing', () => {
  assert.deepEqual(parsePropfindResponse(''), []);
  assert.deepEqual(parsePropfindResponse('not xml at all'), []);
});

// ---- baseUrlPath ------------------------------------------------------------

test('baseUrlPath extracts just the path portion, with a trailing slash', () => {
  assert.equal(baseUrlPath({ baseUrl: 'https://cloud.example.com/remote.php/dav/files/me' }), '/remote.php/dav/files/me/');
  assert.equal(baseUrlPath({ baseUrl: 'https://cloud.example.com/remote.php/dav/files/me/' }), '/remote.php/dav/files/me/');
});

// ---- list() -------------------------------------------------------------

test('list() excludes the self-referencing entry for the queried directory itself', () => {
  return withMockFetch(
    async () => textResponse(207, SAMPLE_PROPFIND_XML),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const entries = await adapter.list();
      assert.equal(entries.length, 2); // NOT 3 -- the directory-itself entry must be excluded
    }
  );
});

test('list() returns correctly-shaped, directories-first-then-alphabetical entries', () => {
  return withMockFetch(
    async () => textResponse(207, SAMPLE_PROPFIND_XML),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const entries = await adapter.list();
      assert.deepEqual(entries, [
        { name: 'journal', path: 'journal', type: 'dir' },
        { name: 'notes.org', path: 'notes.org', type: 'file' },
      ]);
    }
  );
});

test('list() sends a PROPFIND request with Depth: 1', () => {
  let capturedMethod = null;
  let capturedHeaders = null;
  return withMockFetch(
    async (url, opts) => {
      capturedMethod = opts.method;
      capturedHeaders = opts.headers;
      return textResponse(207, SAMPLE_PROPFIND_XML);
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await adapter.list();
      assert.equal(capturedMethod, 'PROPFIND');
      assert.equal(capturedHeaders.Depth, '1');
    }
  );
});

test('list() returns an empty array for a 404 rather than throwing', () => {
  return withMockFetch(
    async () => textResponse(404, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      assert.deepEqual(await adapter.list('nonexistent'), []);
    }
  );
});

test('list() throws a clear error on a non-ok, non-404 response', () => {
  return withMockFetch(
    async () => textResponse(401, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(() => adapter.list(), /rejected the credentials/);
    }
  );
});

test('list() requires configuration, same as read/write', () => {
  const adapter = createWebdavAdapter(() => null);
  return assert.rejects(() => adapter.list(), /not configured yet/);
});

test('list() correctly requests a subdirectory path', () => {
  let requestedUrl = null;
  return withMockFetch(
    async (url) => {
      requestedUrl = url;
      return textResponse(
        207,
        `<d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/remote.php/dav/files/me/journal/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
          <d:response><d:href>/remote.php/dav/files/me/journal/2026.org</d:href>
            <d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`
      );
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const entries = await adapter.list('journal');
      assert.equal(requestedUrl, 'https://cloud.example.com/remote.php/dav/files/me/journal');
      assert.deepEqual(entries, [{ name: '2026.org', path: 'journal/2026.org', type: 'file' }]);
    }
  );
});

// ---- readBinary -----------------------------------------------------------

test('readBinary converts arrayBuffer content to base64 correctly', () => {
  const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  return withMockFetch(
    async () => ({
      status: 200,
      ok: true,
      arrayBuffer: async () => imageBytes.buffer,
      headers: { get: (name) => (name === 'ETag' ? 'img-etag' : null) },
    }),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      const result = await adapter.readBinary('photo.png');
      assert.equal(result.hash, 'img-etag');
      // round-trip: decoding the returned base64 must reproduce the exact original bytes
      assert.deepEqual(Buffer.from(result.base64, 'base64'), Buffer.from(imageBytes));
    }
  );
});

test('readBinary returns null for a 404, matching read()\u2019s own convention', () => {
  return withMockFetch(
    async () => textResponse(404, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      assert.equal(await adapter.readBinary('missing.png'), null);
    }
  );
});

test('readBinary throws a clear error on a non-ok, non-404 response', () => {
  return withMockFetch(
    async () => textResponse(401, ''),
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await assert.rejects(() => adapter.readBinary('photo.png'), /rejected the credentials/);
    }
  );
});

// ---- arrayBufferToBase64 ---------------------------------------------

test('arrayBufferToBase64 correctly encodes arbitrary binary data', () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127]);
  const result = arrayBufferToBase64(bytes.buffer);
  assert.deepEqual(Buffer.from(result, 'base64'), Buffer.from(bytes));
});

test('arrayBufferToBase64 handles empty input', () => {
  assert.equal(arrayBufferToBase64(new ArrayBuffer(0)), '');
});

// ---- cache: 'no-store' on every GET (same reasoning as the GitHub adapter --
// prevents a stale browser-cached read from causing a false conflict on the
// very next write, especially with repeated captures to the same file) --

test('read() passes cache: "no-store" so a fresh read is always fetched, never a stale cached one', () => {
  let capturedOpts = null;
  return withMockFetch(
    async (url, opts) => { capturedOpts = opts; return textResponse(200, 'content'); },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await adapter.read('notes.org');
      assert.equal(capturedOpts.cache, 'no-store');
    }
  );
});

test('readBinary() also passes cache: "no-store"', () => {
  let capturedOpts = null;
  return withMockFetch(
    async (url, opts) => {
      capturedOpts = opts;
      return { status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    },
    async () => {
      const adapter = createWebdavAdapter(() => CONFIG);
      await adapter.readBinary('photo.png');
      assert.equal(capturedOpts.cache, 'no-store');
    }
  );
});
