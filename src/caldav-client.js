/**
 * The few CalDAV requests the calendar mirror needs, over an injected `fetch` so they can be tested without a
 * network (and run against a real server in Node). CalDAV is WebDAV plus iCalendar: an event is one .ics file in a
 * calendar folder, written with PUT, removed with DELETE, and the folder is listed with PROPFIND.
 *
 * CardDAV is the same thing for contacts: a contact is one .vcf file (a vCard) in an address book folder, with the same
 * three requests. `createCarddavClient` is this client told to speak that, and only the file type and the wording differ.
 *
 * Every failure becomes a CaldavError with a `kind` the caller can act on and a message fit to show a person:
 *   'auth'       the server said no to the credentials (401, 403)
 *   'not-found'  the calendar address does not exist (404, or 409 for a missing parent)
 *   'network'    the server could not be reached; in a browser this is also what a missing CORS permission looks like
 *   'server'     anything else
 */

class CaldavError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'CaldavError';
    this.kind = kind;
    this.status = status;
  }
}

/** Basic credentials, encoded as UTF-8 so a non-ASCII username or password works. */
function basicAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'Basic ' + btoa(binary);
}

/** The hrefs in a PROPFIND multistatus body, whatever namespace prefix the server used (D:, d:, or none). */
function parseHrefs(xml) {
  const hrefs = [];
  const re = /<(?:[A-Za-z][\w.-]*:)?href\b[^>]*>([^<]*)<\/(?:[A-Za-z][\w.-]*:)?href>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) hrefs.push(m[1].trim());
  return hrefs;
}

/** What differs between a calendar and an address book: the file type, what it is sent as, and what to call it. */
const KINDS = {
  calendar: { extension: '.ics', contentType: 'text/calendar; charset=utf-8', noun: 'calendar', Noun: 'Calendar' },
  contacts: { extension: '.vcf', contentType: 'text/vcard; charset=utf-8', noun: 'address book', Noun: 'Address book' },
};

/** The file names with `extension` among `hrefs` (each a path or a full URL, possibly percent-encoded). The folder itself and
 *  anything with another extension are skipped. */
function icsNamesFromHrefs(hrefs, extension = '.ics') {
  const names = [];
  for (const href of hrefs) {
    let path = href;
    try {
      path = new URL(href, 'http://x').pathname;
    } catch {
      // keep it as it is
    }
    const last = path.split('/').filter(Boolean).pop();
    if (!last || path.endsWith('/')) continue;
    let name = last;
    try {
      name = decodeURIComponent(last);
    } catch {
      // keep it as it is
    }
    if (name.endsWith(extension)) names.push(name);
  }
  return names;
}

function errorForResponse(response, what, { noun, Noun }) {
  const status = response.status;
  if (status === 401) return new CaldavError('auth', `The ${noun} server rejected the username or password.`, status);
  if (status === 403) return new CaldavError('auth', `The ${noun} server does not allow this account to change that ${noun}.`, status);
  if (status === 404 || status === 409) return new CaldavError('not-found', `${Noun} not found. Create it on the server first; the address must end at the ${noun} itself.`, status);
  return new CaldavError('server', `The ${noun} server answered ${status}${response.statusText ? ' ' + response.statusText : ''} (${what}).`, status);
}

function createCaldavClient({ url, username, password, kind = 'calendar', fetch: fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 20000 }) {
  const what = KINDS[kind] || KINDS.calendar;
  const base = url.endsWith('/') ? url : url + '/';
  const authorization = basicAuthHeader(username || '', password || '');

  async function request(method, name, { headers = {}, body } = {}) {
    const target = name ? base + encodeURIComponent(name) : base;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(target, { method, headers: { Authorization: authorization, ...headers }, body, signal: controller ? controller.signal : undefined });
    } catch {
      throw new CaldavError('network', `Couldn't reach the ${what.noun} server. Check the address, and that the server allows requests from this app (CORS).`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    /** Writes (creates or replaces) one event file (or contact file). */
    async put(name, ics) {
      const response = await request('PUT', name, { headers: { 'Content-Type': what.contentType }, body: ics });
      if (!response.ok) throw errorForResponse(response, `writing ${name}`, what);
    },
    /** Removes one event file. Already gone counts as removed. */
    async remove(name) {
      const response = await request('DELETE', name);
      if (!response.ok && response.status !== 404) throw errorForResponse(response, `removing ${name}`, what);
    },
    /** The names of the .ics files in the calendar (the .vcf files in an address book). */
    async list() {
      const response = await request('PROPFIND', null, {
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><getetag/></prop></propfind>',
      });
      if (response.status !== 207 && !response.ok) throw errorForResponse(response, `listing the ${what.noun}`, what);
      return icsNamesFromHrefs(parseHrefs(await response.text()), what.extension);
    },
    /** Whether the address and credentials work. Throws a CaldavError if not. */
    async check() {
      const response = await request('PROPFIND', null, {
        headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      });
      if (response.status !== 207 && !response.ok) throw errorForResponse(response, `checking the ${what.noun}`, what);
    },
  };
}

/** The same client for an address book (CardDAV): .vcf files, sent as text/vcard, with the wording to match. */
function createCarddavClient(options) {
  return createCaldavClient({ ...options, kind: 'contacts' });
}

/**
 * Runs `worker(item)` over `items`, at most `limit` at a time. A failure is recorded and the rest carry on, except a
 * failure the whole run shares (the credentials, the address, the network): that stops it, since every remaining
 * request would fail the same way.
 * @returns {{ ok: any[], failed: { item: any, error: Error }[], stopped: Error | null }}
 */
async function runLimited(items, limit, worker) {
  const ok = [];
  const failed = [];
  let stopped = null;
  let next = 0;
  const lane = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
        ok.push(item);
      } catch (error) {
        failed.push({ item, error });
        if (error && ['auth', 'not-found', 'network'].includes(error.kind)) stopped = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return { ok, failed, stopped };
}

export { CaldavError, basicAuthHeader, parseHrefs, icsNamesFromHrefs, createCaldavClient, createCarddavClient, runLimited };
