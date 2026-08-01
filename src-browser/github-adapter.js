/**
 * GitHub-backed storage adapter, using GitHub's REST Contents API directly
 * from the browser — no server component. This is exactly how GitHub's API
 * is designed to be used from client-side code: a Personal Access Token
 * scoped to a repo, called straight from the page, the same approach used
 * by browser-based git content editors generally.
 *
 * Implements the same { read(fileId), write(fileId, content), exists(fileId) }
 * shape as the local File System Access adapter (src-browser/filesystem-adapter.js),
 * so sync-engine.js and document-store.js work with it completely
 * unmodified — they were written against that interface, not against "the
 * filesystem" specifically. That's what makes plugging in a second,
 * completely different storage backend this cheap.
 *
 * `fileId` here is just the file's path within the configured repo (e.g.
 * "notes.org" or "journal/2026.org") — owner/repo/branch/token live in the
 * config object this adapter is constructed with (see settings.js), not
 * encoded into fileId. v1 supports one configured repo at a time, set via
 * Settings, not a different repo per file.
 *
 * A real, worth-stating security consideration, not glossed over: the
 * token is stored in IndexedDB (see settings.js), scoped to this origin —
 * the same trust model as a browser's saved passwords or any other
 * client-side-only credential store, since there's no server to keep it
 * further from. Use a fine-grained PAT scoped to just the one repo, with
 * only Contents read/write permission, not a broad classic token — that
 * keeps the blast radius small if this origin were ever compromised some
 * other way.
 */

const API_BASE = 'https://api.github.com';

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function contentsUrl(config, path) {
  return `${API_BASE}/repos/${config.owner}/${config.repo}/contents/${path}`;
}

function authHeaders(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function requireConfig(getConfig) {
  const config = getConfig();
  if (!config || !config.token || !config.owner || !config.repo) {
    throw new Error('GitHub is not configured yet \u2014 set it up in Settings first.');
  }
  return config;
}

async function githubErrorMessage(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body && body.message ? body.message : '';
  } catch {
    // response body wasn't JSON (or was empty) — fall back to a generic message below
  }
  if (res.status === 401) return 'GitHub rejected the token \u2014 check it in Settings.';
  if (res.status === 403) {
    return 'GitHub access forbidden (bad token scope, or rate-limited).' + (detail ? ' ' + detail : '');
  }
  if (res.status === 404) {
    return 'Repository or file not found (check owner/repo in Settings, and that the token can access it).';
  }
  if (res.status === 409) return 'GitHub reported a conflict \u2014 the file changed on GitHub since this app last read it.';
  return `GitHub API error (${res.status})${detail ? ': ' + detail : ''}`;
}

/**
 * `getConfig` is a function (not a static object) — called fresh on every
 * operation, so changing GitHub settings mid-session (e.g. after a user
 * fixes a typo'd token) takes effect on the next call without needing to
 * reconstruct the adapter.
 */
export function createGithubAdapter(getConfig) {
  async function readImpl(fileId) {
    const config = requireConfig(getConfig);
    const url = contentsUrl(config, fileId) + '?ref=' + encodeURIComponent(config.branch || 'main');
    const res = await fetch(url, { headers: authHeaders(config), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await githubErrorMessage(res));
    const body = await res.json();
    if (Array.isArray(body)) {
      throw new Error(`"${fileId}" is a directory in this repo, not a file.`);
    }
    return { content: base64ToUtf8(body.content), hash: body.sha };
  }

  /** Reads `fileId` as binary content (base64-encoded), for an image or
   *  any other non-text file. The Contents API already returns base64
   *  directly -- unlike readImpl, which decodes it to utf8 text (which
   *  would corrupt binary data), this just strips the MIME-style line
   *  wrapping GitHub's own response includes, for a clean data: URL
   *  payload. Returns null for a 404, matching readImpl's convention. */
  async function readBinaryImpl(fileId) {
    const config = requireConfig(getConfig);
    const url = contentsUrl(config, fileId) + '?ref=' + encodeURIComponent(config.branch || 'main');
    const res = await fetch(url, { headers: authHeaders(config), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await githubErrorMessage(res));
    const body = await res.json();
    if (Array.isArray(body)) {
      throw new Error(`"${fileId}" is a directory in this repo, not a file.`);
    }
    return { base64: body.content.replace(/\n/g, ''), hash: body.sha };
  }

  async function writeImpl(fileId, content) {
    const config = requireConfig(getConfig);
    // GitHub requires the current sha to update an existing file (so it
    // can refuse to silently clobber a newer commit); a brand new file
    // omits it entirely.
    const existing = await readImpl(fileId);
    const requestBody = {
      message: existing ? `Update ${fileId} via org-pwa` : `Create ${fileId} via org-pwa`,
      content: utf8ToBase64(content),
      branch: config.branch || 'main',
    };
    if (existing) requestBody.sha = existing.hash;

    const res = await fetch(contentsUrl(config, fileId), {
      method: 'PUT',
      headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(await githubErrorMessage(res));
    const result = await res.json();
    return { hash: result.content.sha };
  }

  /**
   * Lists the contents of `path` (default: repo root) — the same
   * Contents API endpoint readImpl already calls, just used for the
   * shape it returns when pointed at a directory instead of a file.
   * Returns [{ name, path, type }] where type is 'file' or 'dir',
   * sorted directories-first then alphabetically (so a folder-browsing
   * UI doesn't need its own sort logic) — a real, deliberate ordering,
   * not incidental: without it, GitHub's own API order (alphabetical
   * across both files and folders together) interleaves them, which
   * reads worse for browsing than a consistent folders-then-files
   * grouping does. An empty directory (or one that doesn't exist)
   * returns [] rather than throwing — same "nothing here" outcome
   * either way from a caller's perspective, no need to distinguish.
   */
  async function listImpl(path = '') {
    const config = requireConfig(getConfig);
    const url = contentsUrl(config, path) + '?ref=' + encodeURIComponent(config.branch || 'main');
    const res = await fetch(url, { headers: authHeaders(config), cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(await githubErrorMessage(res));
    const body = await res.json();
    const entries = Array.isArray(body) ? body : [body]; // a single file at this exact path is a valid (if unusual) thing to "list"
    return entries
      .filter((e) => e.type === 'file' || e.type === 'dir')
      .map((e) => ({ name: e.name, path: e.path, type: e.type }))
      .sort((a, b) => {
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
      return (await readImpl(fileId)) !== null;
    },
  };
}

export function isGithubConfigured(config) {
  return !!(config && config.token && config.owner && config.repo);
}

// Exported for testing the tricky part in isolation — real UTF-8 (emoji
// included, since real org files in the wild use them heavily in
// headings) round-tripping through GitHub's base64 encoding.
export { utf8ToBase64, base64ToUtf8 };
