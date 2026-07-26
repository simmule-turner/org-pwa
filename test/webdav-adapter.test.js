import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebdavAdapter,
  isWebdavConfigured,
  fileUrl,
  encodePath,
  parsePropfindResponse,
  baseUrlPath,
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
