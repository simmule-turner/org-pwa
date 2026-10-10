// What scripts may ask of the page: network, cache and the phone's position. The sandbox has none of these itself;
// each request arrives here, is checked against src/extension-net.js, and is allowed only after the person said yes.
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES, cacheGet, cacheSet, checkCacheKey, checkFetchUrl, encodeCacheValue, hostAllowed, normalizeFetchOptions, roundPosition } from '../src/extension-net.js';
import { confirmDialog } from './dialogs.js';
import { kv } from './singletons.js';

const GRANTS_KEY = 'org-pwa-extension-grants';
const MAX_GRANT_OWNERS = 100;
const REFUSAL_MEMORY_MS = 15000;

/** Grants given to unsaved documents last until the page is closed. */
const sessionGrants = new Map();
const sessionCaches = new Map();

function storedGrants() {
  try {
    const o = JSON.parse(localStorage.getItem(GRANTS_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

function readGrant(owner) {
  if (owner.startsWith('session:')) return sessionGrants.get(owner) || { hosts: [], location: false };
  const g = storedGrants()[owner];
  return { hosts: Array.isArray(g && g.hosts) ? g.hosts : [], location: !!(g && g.location) };
}

function writeGrant(owner, grant) {
  if (owner.startsWith('session:')) {
    sessionGrants.set(owner, grant);
    return;
  }
  try {
    const all = storedGrants();
    delete all[owner];
    all[owner] = grant;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_GRANT_OWNERS))) delete all[k];
    localStorage.setItem(GRANTS_KEY, JSON.stringify(all));
  } catch (e) {
    /* not remembered; asked again next time */
  }
}

/** The grant owner for a document: saved documents keep their grants, unsaved ones do not outlive the page. */
export function documentOwner(documentId) {
  const id = documentId || '';
  return id && !id.startsWith(UNSAVED_DOCUMENT_ID) ? 'doc:' + id : 'session:' + (id || 'unsaved');
}

export const scriptOwner = (hash) => 'script:' + hash;

async function readCache(owner) {
  if (owner.startsWith('session:')) return sessionCaches.get(owner) || {};
  try {
    const raw = await kv.get('ext-cache:' + owner);
    const v = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

async function writeCache(owner, scope) {
  if (owner.startsWith('session:')) sessionCaches.set(owner, scope);
  else await kv.set('ext-cache:' + owner, JSON.stringify(scope));
}

function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device cannot give its position'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(roundPosition(p.coords, Date.now())),
      (err) => reject(new Error('Position unavailable: ' + (err && err.message ? err.message : 'refused'))),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

async function readBody(response) {
  if (!response.body || !response.body.getReader) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('The response is larger than 1 MB');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      reader.cancel();
      throw new Error('The response is larger than 1 MB');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function doFetch(url, options, isHostOk) {
  const target = checkFetchUrl(url);
  const o = normalizeFetchOptions(options);
  await isHostOk(target.host, true);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target.url, { method: o.method, headers: o.headers, body: o.body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    const finalHost = response.url ? checkFetchUrl(response.url).host : target.host;
    if (finalHost !== target.host) await isHostOk(finalHost, false); // a redirect to a site that was not approved: the answer is discarded
    const body = await readBody(response);
    return { status: response.status, ok: response.ok, url: response.url || target.url, body };
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`The request took longer than ${FETCH_TIMEOUT_MS / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The request handler for one script or block. `declared` is { hosts, location } when the code's header
 * lists what it needs (source blocks); null for the init script, which is asked as it goes.
 */
export function createServices({ owner, declared = null }) {
  const refused = new Map(); // host -> when it was refused: not asked again for a while, so a script in a loop cannot flood the person with questions
  const isHostOk = async (host, mayAsk) => {
    const grant = readGrant(owner);
    if (declared && !hostAllowed(host, declared.hosts)) throw new Error(`This block did not ask for ${host}; add it to :net`);
    if (grant.hosts.includes(host) || (declared && declared.hosts.some((h) => hostAllowed(host, [h]) && grant.hosts.includes(h)))) return true;
    if (!mayAsk || Date.now() - (refused.get(host) || 0) < REFUSAL_MEMORY_MS) throw new Error(`Network access to ${host} was not allowed`);
    const ok = await confirmDialog(`Allow this code to contact ${host}? It can send anything it can read, including the text of the open file, to that site.`, { confirmLabel: 'Allow', danger: false });
    if (!ok) {
      refused.set(host, Date.now());
      throw new Error(`Network access to ${host} was not allowed`);
    }
    writeGrant(owner, { ...grant, hosts: [...grant.hosts, host] });
    return true;
  };
  const locationOk = async () => {
    const grant = readGrant(owner);
    if (grant.location) return;
    if (declared && !declared.location) throw new Error('This block did not ask for your position; add :location yes');
    const ok = await confirmDialog("Allow this code to read your phone's position?", { confirmLabel: 'Allow', danger: false });
    if (!ok) throw new Error('Reading the position was not allowed');
    writeGrant(owner, { ...readGrant(owner), location: true });
  };
  return async (method, args) => {
    if (method === 'fetch') return doFetch(args[0], args[1], isHostOk);
    if (method === 'location.get') {
      await locationOk();
      return readPosition();
    }
    if (method === 'cache.get') {
      const hit = cacheGet(await readCache(owner), checkCacheKey(args[0]), Number.isFinite(args[1]) ? args[1] : undefined, Date.now());
      return hit ? { found: true, value: hit.value } : { found: false };
    }
    if (method === 'cache.set') {
      const key = checkCacheKey(args[0]);
      const text = encodeCacheValue(args[1]);
      await writeCache(owner, cacheSet(await readCache(owner), key, text, Date.now()));
      return true;
    }
    throw new Error('Unknown request: ' + method);
  };
}

/** Before a block runs: asks for the hosts and the position its header lists, unless granted already. */
export async function authorizeBlock(owner, declared) {
  const grant = readGrant(owner);
  const hosts = declared.hosts.filter((h) => !grant.hosts.includes(h));
  const needLocation = declared.location && !grant.location;
  if (!hosts.length && !needLocation) return true;
  const parts = [];
  if (hosts.length) parts.push(`contact ${hosts.join(', ')}`);
  if (needLocation) parts.push("read your phone's position");
  const ok = await confirmDialog(`Allow this document's code to ${parts.join(' and ')}? It can send anything it can read, including the text of the open file, to ${hosts.length ? 'those sites' : 'a site it contacts'}.`, { confirmLabel: 'Allow', danger: false });
  if (ok) writeGrant(owner, { hosts: [...grant.hosts, ...hosts], location: grant.location || declared.location });
  return ok;
}
