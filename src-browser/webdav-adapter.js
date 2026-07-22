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

export function createWebdavAdapter(getConfig) {
  async function readImpl(fileId) {
    const config = requireConfig(getConfig);
    const res = await fetchWithHint(fileUrl(config, fileId), {
      method: 'GET',
      headers: authHeader(config),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(webdavErrorMessage(res));
    const content = await res.text();
    const hash = res.headers.get('ETag') || null;
    return { content, hash };
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

  return {
    read: readImpl,
    write: writeImpl,
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

// Exported for testing path/URL construction in isolation.
export { fileUrl, encodePath };
