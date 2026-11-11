// @ts-check
// Reading a download without letting it grow past a size or hang: the shared half of the size limits (src/size-limits.js).
import { SIZE_KINDS, SizeLimitError, formatSize, getSizeLimits } from '../src/size-limits.js';

/** @typedef {import('../src/size-limits.js').SizeKind} SizeKind */

/**
 * fetch, giving up when no answer has started within `seconds` (0 or less: no timeout). The request is not cut off once the
 * answer is coming, so a long download is not killed halfway; readLimited stops a download that stalls.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [seconds] defaults to the download timeout setting
 */
export async function fetchWithTimeout(url, options = {}, seconds = getSizeLimits().fetchTimeoutSeconds) {
  if (!(seconds > 0)) return fetch(url, options);
  const controller = new AbortController();
  const outer = options.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !(outer && outer.aborted)) throw new Error(`No answer from the server in ${seconds} seconds. Set org-xx-fetch-timeout in Global Variables to change the timeout.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throws when a response says (Content-Length) it is larger than `maxBytes`, before any of it is read.
 * @param {Response} response
 * @param {number} maxBytes 0: no limit
 * @param {SizeKind} kind
 * @param {string} [name]
 */
export function refuseByContentLength(response, maxBytes, kind, name = '') {
  if (!(maxBytes > 0)) return;
  const header = response.headers && response.headers.get('Content-Length');
  const length = header ? Number(header) : NaN;
  if (Number.isFinite(length) && length > maxBytes) throw tooLarge(kind, length, maxBytes, name);
}

/**
 * The body of a response as bytes, stopping (and cancelling the download) as soon as it is over `maxBytes`, or when nothing
 * arrives for `idleSeconds`. A response without a stream is read whole and then checked.
 * @param {Response} response
 * @param {{ maxBytes?: number, kind?: SizeKind, name?: string, idleSeconds?: number }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function readLimited(response, { maxBytes = 0, kind = 'orgFile', name = '', idleSeconds = getSizeLimits().fetchTimeoutSeconds } = {}) {
  refuseByContentLength(response, maxBytes, kind, name);
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const whole = typeof response.arrayBuffer === 'function' ? new Uint8Array(await response.arrayBuffer()) : new TextEncoder().encode(await response.text()); // text() only: stand-ins in tests
    if (maxBytes > 0 && whole.length > maxBytes) throw tooLarge(kind, whole.length, maxBytes, name);
    return whole;
  }
  const reader = body.getReader();
  /** @type {Uint8Array[]} */ const chunks = [];
  let total = 0;
  for (;;) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
    const stalled = idleSeconds > 0 ? new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`The download stopped for ${idleSeconds} seconds.`)), idleSeconds * 1000))) : null;
    let step;
    try {
      step = await (stalled ? Promise.race([reader.read(), stalled]) : reader.read());
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const { done, value } = /** @type {ReadableStreamReadResult<Uint8Array>} */ (step);
    if (done) break;
    total += value.length;
    if (maxBytes > 0 && total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(kind, total, maxBytes, name, true);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * @param {SizeKind} kind @param {number} bytes @param {number} max @param {string} name @param {boolean} [atLeast] the download was cut off, so `bytes` is only how far it got
 */
function tooLarge(kind, bytes, max, name, atLeast = false) {
  const what = name ? `"${name}"` : 'The file';
  const size = atLeast ? `more than ${formatSize(max)}` : formatSize(bytes);
  return new SizeLimitError(`${what} is ${size}, over the ${formatSize(max)} limit. Set ${SIZE_KINDS[kind].key} in Global Variables to change the limit.`, kind, bytes, atLeast);
}

/**
 * The text of an answer whose size has no setting of its own (a server's listing, a weather answer, GitHub's replies): read in
 * pieces and cut off past `maxBytes`, with a message that does not point at the size settings.
 * @param {Response} response
 * @param {number} maxBytes
 * @param {string} what  how the message names the answer, e.g. 'The calendar listing'
 * @returns {Promise<string>}
 */
export async function readTextCapped(response, maxBytes, what) {
  try {
    return new TextDecoder().decode(await readLimited(response, { maxBytes, kind: 'orgFile', name: '' }));
  } catch (error) {
    if (error instanceof SizeLimitError) throw new Error(`${what} is larger than ${formatSize(maxBytes)}, so it was not read.`);
    throw error;
  }
}

/** Like readTextCapped, parsed as JSON.
 * @param {Response} response @param {number} maxBytes @param {string} what
 * @returns {Promise<any>} */
export async function readJsonCapped(response, maxBytes, what) {
  // Minimal stand-ins (tests) that can only answer json(): nothing streams, so there is nothing to cap.
  if (!response.body && typeof response.arrayBuffer !== 'function' && typeof response.text !== 'function') return response.json();
  return JSON.parse(await readTextCapped(response, maxBytes, what));
}

/** The most a server's directory listing, or a GitHub reply that is not a file's content, may be. */
export const REPLY_CAP_BYTES = 32 * 1024 * 1024;
