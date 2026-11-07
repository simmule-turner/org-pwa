// @ts-check
// Reading a download without letting it grow past a size or hang: the shared half of the size limits (src/size-limits.js).
import { SizeLimitError, formatSize, getSizeLimits } from '../src/size-limits.js';

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
    if (controller.signal.aborted && !(outer && outer.aborted)) throw new Error(`No answer from the server in ${seconds} seconds. Change the timeout in Settings > Sync and storage > Size limits.`);
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
    const whole = new Uint8Array(await response.arrayBuffer());
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
  return new SizeLimitError(`${what} is ${size}, over the ${formatSize(max)} limit. Change the limit in Settings > Sync and storage > Size limits.`, kind, bytes);
}
