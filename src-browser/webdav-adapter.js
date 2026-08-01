/**
 * WebDAV-backed storage adapter — the same { read(fileId), write(fileId,
 * content), exists(fileId) } shape as the GitHub and local File System
 * Access adapters, using plain HTTP verbs (GET/PUT/HEAD) against a
 * configured WebDAV server (Nextcloud, ownCloud, a generic Apache
 * mod_dav server, a NAS, etc.). document-store.js and sync-engine.js
 * need zero changes to work with this — same reason the GitHub adapter
 * didn't need any either.
 *
 * A real, load-bearing caveat, stated plainly rather than discovered as a
 * cryptic "Failed to fetch": most WebDAV servers are NOT configured to
 * send CORS headers by default, because WebDAV has historically been used
 * by desktop clients (Finder, Explorer, native sync apps), not browser
 * JavaScript. Unless the server explicitly allows cross-origin requests
 * from this app's origin, the browser blocks every request here before
 * it even reaches this code's error handling — that's a server
 * configuration matter, not something a client-side adapter can work
 * around. Nextcloud and ownCloud both have settings for this; a bare
 * Apache/nginx WebDAV server needs CORS headers added explicitly
 * (mod_headers on Apache, add_header on nginx). fetchWithHint() below
 * exists specifically to make that failure mode recognizable instead of
 * an opaque browser error.
 *
 * Auth is HTTP Basic (base64 username:password) sent on every request —
 * use an app-specific password if the server supports one (Nextcloud and
 * ownCloud both do), not the main account password, for the same
 * "limit the blast radius if this origin is ever compromised" reasoning
 * as the GitHub adapter's PAT advice.
 *
 * Conflict detection uses WebDAV's standard ETag support where the
 * server provides one: If-Match on update (refuse to overwrite if the
 * file changed since this app last read it), If-None-Match: * on create
 * (refuse to silently overwrite something that already exists). ETag
 * support isn't universal across WebDAV servers; if a read doesn't come
 * back with one, writes proceed without a conditional header rather than
 * refusing to write at all — a stated, accepted small lost-update risk
 * on servers that don't support ETags, not a silent one.
 */

function authHeader(config) {
  const encoded = btoa(`${config.username}:${config.password}`);
  return { Authorization: `Basic ${encoded}` };
}

function encodePath(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Converts binary content to a base64 string, browser-safe (no Node
 *  Buffer -- btoa operates on a "binary string" where each character
 *  code is one byte, the standard technique for this conversion in a
 *  browser context; works identically under Node's own global btoa,
 *  which matches the same web standard, so this is testable directly
 *  under node:test too). */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fileUrl(config, path) {
  const base = config.baseUrl.replace(/\/+$/, '');
  const cleanPath = encodePath(path.replace(/^\/+/, ''));
  return `${base}/${cleanPath}`;
}

function requireConfig(getConfig) {
  const config = getConfig();
  if (!config || !config.baseUrl || !config.username) {
    throw new Error('WebDAV is not configured yet \u2014 set it up in Settings first.');
  }
  return config;
}

/** Wraps fetch so a CORS-blocked or otherwise unreachable request
 *  surfaces as an explanatory error instead of a bare "Failed to fetch"
 *  that gives no hint about what's actually wrong. */
async function fetchWithHint(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    throw new Error(
      'Could not reach the WebDAV server. This is often a CORS configuration issue on the ' +
        'server (WebDAV servers don\u2019t always allow cross-origin browser requests by default) ' +
        'rather than a problem with the request itself or your credentials. ' +
        'Original error: ' +
        err.message
    );
  }
}

function webdavErrorMessage(res) {
  if (res.status === 401) return 'WebDAV server rejected the credentials \u2014 check them in Settings.';
  if (res.status === 403) return 'WebDAV access forbidden \u2014 check the account/app-password permissions.';
  if (res.status === 404) return 'File or path not found on the WebDAV server.';
  if (res.status === 412) return 'The file changed on the server since this app last read it (ETag mismatch).';
  if (res.status === 409) return 'WebDAV conflict \u2014 an intermediate folder in the path may not exist yet.';
  return `WebDAV error (${res.status})`;
}

/**
 * Parses a WebDAV PROPFIND multistatus XML response into
 * [{ href, isCollection }]. Hand-rolled rather than DOMParser (not
 * available under Node, where this app's tests run) or an XML library
 * (this app has a zero-external-dependency principle) -- a targeted
 * parser for PROPFIND's specific, well-defined response shape, the
 * same approach org-parser.js itself takes for org syntax rather than
 * reaching for a general-purpose parser it doesn't need.
 *
 * Handles the realistic range of namespace-prefix variation between
 * WebDAV server implementations (`<d:response>`, `<D:response>`,
 * `<response>` with a default namespace) via case-insensitive,
 * prefix-agnostic tag matching, since the WebDAV spec itself doesn't
 * mandate a specific prefix, only that these element LOCAL names exist
 * in the DAV: namespace.
 */
function parsePropfindResponse(xml) {
  const responseBlocks = xml.match(/<[\w-]*:?response[^>]*>[\s\S]*?<\/[\w-]*:?response>/gi) || [];
  const entries = [];
  for (const block of responseBlocks) {
    const hrefMatch = /<[\w-]*:?href[^>]*>([^<]*)<\/[\w-]*:?href>/i.exec(block);
    if (!hrefMatch) continue;
    const href = decodeURIComponent(hrefMatch[1].trim());
    const isCollection = /<[\w-]*:?collection\s*\/?>/i.test(block);
    entries.push({ href, isCollection });
  }
  return entries;
}

/** The path portion of `config.baseUrl`, with a trailing slash, so an
 *  href from the server (also always trailing-slash-normalized for a
 *  directory) can be compared/stripped consistently regardless of
 *  whether either one happened to include a trailing slash already. */
function baseUrlPath(config) {
  const url = new URL(config.baseUrl);
  return url.pathname.replace(/\/+$/, '') + '/';
}

export function createWebdavAdapter(getConfig) {
  async function readImpl(fileId) {
    const config = requireConfig(getConfig);
    const res = await fetchWithHint(fileUrl(config, fileId), {
      method: 'GET',
      headers: authHeader(config),
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(webdavErrorMessage(res));
    const content = await res.text();
    const hash = res.headers.get('ETag') || null;
    return { content, hash };
  }

  /** Reads `fileId` as binary content (base64-encoded), for an image or
   *  any other non-text file -- separate from readImpl's own text
   *  decoding, which would corrupt binary data. Returns null for a 404,
   *  matching readImpl's own "not found" convention. */
  async function readBinaryImpl(fileId) {
    const config = requireConfig(getConfig);
    const res = await fetchWithHint(fileUrl(config, fileId), {
      method: 'GET',
      headers: authHeader(config),
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(webdavErrorMessage(res));
    const buffer = await res.arrayBuffer();
    return { base64: arrayBufferToBase64(buffer), hash: res.headers.get('ETag') || null };
  }

  async function writeImpl(fileId, content) {
    const config = requireConfig(getConfig);
    const existing = await readImpl(fileId);
    const headers = { ...authHeader(config), 'Content-Type': 'text/plain; charset=utf-8' };
    if (existing && existing.hash) {
      headers['If-Match'] = existing.hash;
    } else if (!existing) {
      headers['If-None-Match'] = '*';
    }
    const res = await fetchWithHint(fileUrl(config, fileId), {
      method: 'PUT',
      headers,
      body: content,
    });
    if (!res.ok) throw new Error(webdavErrorMessage(res));
    return { hash: res.headers.get('ETag') || null };
  }

  /**
   * Lists the contents of `path` (default: configured baseUrl root)
   * via PROPFIND with Depth: 1 (immediate children only, not a full
   * recursive tree). Returns [{ name, path, type }], directories-first
   * then alphabetical, same shape and ordering as the GitHub adapter's
   * own list() -- so the UI layer can treat both backends identically
   * without knowing which one it's talking to.
   *
   * The response's own href for the queried collection itself (always
   * present as the first <response> entry in a compliant PROPFIND
   * reply) is excluded -- it's the directory being listed, not a child
   * of it. A 404 (directory doesn't exist) returns [] rather than
   * throwing, matching the GitHub adapter's own "nothing here" handling.
   */
  async function listImpl(path = '') {
    const config = requireConfig(getConfig);
    const url = fileUrl(config, path);
    const res = await fetchWithHint(url, {
      method: 'PROPFIND',
      headers: { ...authHeader(config), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(webdavErrorMessage(res));
    const xml = await res.text();
    const entries = parsePropfindResponse(xml);
    const basePath = baseUrlPath(config);
    const normalizedQueriedPath = path.replace(/^\/+|\/+$/g, '');

    const results = [];
    for (const entry of entries) {
      let relative = entry.href;
      if (relative.startsWith(basePath)) relative = relative.slice(basePath.length);
      relative = relative.replace(/\/+$/, ''); // directories come back with a trailing slash; strip it for a clean name/path
      if (relative === normalizedQueriedPath) continue; // this was the queried directory itself, not a child -- must compare against the actual queried path, not just check for emptiness, since a subdirectory's self-reference isn't empty after stripping the base path
      if (!relative) continue; // defensive: an unexpected genuinely-empty entry, not a real child either way
      const name = relative.split('/').pop();
      results.push({ name, path: relative, type: entry.isCollection ? 'dir' : 'file' });
    }
    return results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    read: readImpl,
    write: writeImpl,
    list: listImpl,
    readBinary: readBinaryImpl,
    async exists(fileId) {
      const config = requireConfig(getConfig);
      const res = await fetchWithHint(fileUrl(config, fileId), {
        method: 'HEAD',
        headers: authHeader(config),
      });
      return res.ok;
    },
  };
}

export function isWebdavConfigured(config) {
  return !!(config && config.baseUrl && config.username);
}

// Exported for testing path/URL construction and the PROPFIND parser in isolation.
export { fileUrl, encodePath, parsePropfindResponse, baseUrlPath, arrayBufferToBase64 };
