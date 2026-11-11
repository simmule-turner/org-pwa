// @ts-check
import { VariableValueError } from './variable-error.js';
/**
 * Size limits: how large a file the app opens, shows or attaches before it asks or refuses. Opening a large Org file is slow
 * (a keystroke in the text editor takes about a second at 1 MB), an inline image costs time in proportion to its bytes, and a
 * big attachment is held in memory several times over, so each kind has a size to warn at and a size to refuse at. The
 * numbers are settings (`org-xx-size-limit-*`, set in Global Variables); `off` (or 0) removes a limit.
 */

const KB = 1024;
const MB = 1024 * KB;

/** @typedef {'orgFile' | 'image' | 'attachment' | 'bibliography' | 'setupfile' | 'include'} SizeKind */
/** @typedef {{ warn?: number, max: number }} KindLimit  Bytes; 0 means no limit. */
/** @typedef {Record<SizeKind, KindLimit> & { fetchTimeoutSeconds: number }} SizeLimits */

/** @type {SizeLimits} */
export const DEFAULT_SIZE_LIMITS = Object.freeze({
  orgFile: { warn: 500 * KB, max: 2 * MB },
  image: { max: 3 * MB },
  attachment: { warn: 20 * MB, max: 95 * MB },
  bibliography: { max: 5 * MB },
  setupfile: { max: 1 * MB },
  include: { max: 2 * MB },
  fetchTimeoutSeconds: 30,
});

/** What each kind is called in a message, and the settings that hold its limits (`key` the refuse limit, `warnKey` the warn limit). */
export const SIZE_KINDS = Object.freeze({
  orgFile: { label: 'an Org file', key: 'org-xx-size-limit-org-file', warnKey: 'large-file-warning-threshold' },
  image: { label: 'an inline image', key: 'org-xx-size-limit-image', warnKey: null },
  attachment: { label: 'an attachment', key: 'org-xx-size-limit-attachment', warnKey: 'org-xx-size-limit-attachment-warn' },
  bibliography: { label: 'a bibliography file', key: 'org-xx-size-limit-bibliography', warnKey: null },
  setupfile: { label: 'a #+SETUPFILE', key: 'org-xx-size-limit-setupfile', warnKey: null },
  include: { label: 'an #+INCLUDE file', key: 'org-xx-size-limit-include', warnKey: null },
});

export const FETCH_TIMEOUT_KEY = 'org-xx-fetch-timeout';

/**
 * Bytes in a size such as `500KB`, `2 MB`, `1.5m` or `1048576` (a number or a string, as the variable holds it); 0 for `nil` or `0`
 * (no limit); null for text that is not a size.
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseSize(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? Math.round(text) : null;
  const s = String(text ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (s === 'nil') return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib)?$/.exec(s);
  if (!m) return null;
  const unit = m[2] || 'b';
  const factor = unit[0] === 'k' ? KB : unit[0] === 'm' ? MB : unit[0] === 'g' ? 1024 * MB : 1;
  return Math.round(Number(m[1]) * factor);
}

/** A size for people: `512 KB`, `2 MB`, `1.5 MB`; `off` for 0.
 * @param {number} bytes */
export function formatSize(bytes) {
  if (!bytes) return 'off';
  const [n, unit] = bytes >= MB ? [bytes / MB, 'MB'] : bytes >= KB ? [bytes / KB, 'KB'] : [bytes, 'bytes'];
  const rounded = unit === 'bytes' ? String(n) : String(Math.round(n * 10) / 10);
  return `${rounded} ${unit}`;
}

/** The limits a variables map sets, the defaults for anything unset; a value that is not a size is a VariableValueError.
 * @param {Record<string, unknown> | null | undefined} vars
 * @returns {SizeLimits} */
export function sizeLimitsOf(vars) {
  const pick = (/** @type {string} */ key, /** @type {number | undefined} */ fallback) => {
    const raw = vars ? vars[key] : undefined;
    if (raw === undefined || raw === '') return fallback;
    const n = parseSize(raw);
    if (n === null) throw new VariableValueError(key, raw, 'a size such as "500KB", a number of bytes or nil');
    return n;
  };
  const d = DEFAULT_SIZE_LIMITS;
  const timeoutRaw = vars ? vars[FETCH_TIMEOUT_KEY] : undefined;
  const timeout = timeoutRaw === undefined || timeoutRaw === '' ? d.fetchTimeoutSeconds : Number(String(timeoutRaw).trim() === 'nil' ? 0 : timeoutRaw);
  if (!Number.isFinite(timeout) || timeout < 0) throw new VariableValueError(FETCH_TIMEOUT_KEY, timeoutRaw, 'a number of seconds or nil');
  return {
    orgFile: { warn: pick(SIZE_KINDS.orgFile.warnKey, d.orgFile.warn), max: pick(SIZE_KINDS.orgFile.key, d.orgFile.max) ?? d.orgFile.max },
    image: { max: pick(SIZE_KINDS.image.key, d.image.max) ?? d.image.max },
    attachment: { warn: pick(SIZE_KINDS.attachment.warnKey, d.attachment.warn), max: pick(SIZE_KINDS.attachment.key, d.attachment.max) ?? d.attachment.max },
    bibliography: { max: pick(SIZE_KINDS.bibliography.key, d.bibliography.max) ?? d.bibliography.max },
    setupfile: { max: pick(SIZE_KINDS.setupfile.key, d.setupfile.max) ?? d.setupfile.max },
    include: { max: pick(SIZE_KINDS.include.key, d.include.max) ?? d.include.max },
    fetchTimeoutSeconds: timeout,
  };
}

// The limits in force: set when the settings load or change (global-variables.js), read wherever a file is fetched.
const current = { limits: /** @type {SizeLimits} */ (structuredCloneLimits(DEFAULT_SIZE_LIMITS)) };

/** @param {SizeLimits} limits */
function structuredCloneLimits(limits) {
  return {
    orgFile: { ...limits.orgFile },
    image: { ...limits.image },
    attachment: { ...limits.attachment },
    bibliography: { ...limits.bibliography },
    setupfile: { ...limits.setupfile },
    include: { ...limits.include },
    fetchTimeoutSeconds: limits.fetchTimeoutSeconds,
  };
}

/** @param {SizeLimits} limits */
export function setSizeLimits(limits) {
  current.limits = structuredCloneLimits(limits);
}

/** @returns {SizeLimits} */
export function getSizeLimits() {
  return current.limits;
}

/**
 * What to do with `bytes` of `kind`: `{ ok: true }` (go ahead), `{ ok: 'warn', message }` (ask first) or `{ ok: false, message }`
 * (refuse). A size exactly at a limit is allowed. `name` is what the message calls the file.
 * @param {SizeKind} kind
 * @param {number} bytes
 * @param {SizeLimits} [limits]
 * @param {string} [name]
 * @returns {{ ok: true } | { ok: 'warn', message: string } | { ok: false, message: string }}
 */
export function checkSize(kind, bytes, limits = current.limits, name = '') {
  const limit = limits[kind];
  const what = name ? `"${name}"` : SIZE_KINDS[kind].label;
  if (limit.max > 0 && bytes > limit.max) {
    return { ok: false, message: `${what} is ${formatSize(bytes)}, over the ${formatSize(limit.max)} limit for ${SIZE_KINDS[kind].label}. Set ${SIZE_KINDS[kind].key} in Global Variables to change the limit.` };
  }
  if (limit.warn && limit.warn > 0 && bytes > limit.warn) {
    return { ok: 'warn', message: `${what} is ${formatSize(bytes)}. This is large and may be slow. Open anyway?` };
  }
  return { ok: true };
}

/** Raised when a read is refused for its size.
 * @extends Error */
export class SizeLimitError extends Error {
  /** @param {string} message @param {SizeKind} kind @param {number} bytes @param {boolean} [atLeast] the download was cut off, so `bytes` is only how far it got */
  constructor(message, kind, bytes, atLeast = false) {
    super(message);
    this.name = 'SizeLimitError';
    this.kind = kind;
    this.bytes = bytes;
    this.atLeast = atLeast;
  }
}

/** Throws a SizeLimitError when `bytes` of `kind` is over its refuse limit.
 * @param {SizeKind} kind @param {number} bytes @param {string} [name] @param {SizeLimits} [limits] */
export function assertWithinLimit(kind, bytes, name = '', limits = current.limits) {
  const result = checkSize(kind, bytes, limits, name);
  if (result.ok === false) throw new SizeLimitError(result.message, kind, bytes);
}

/** Throws when `bytes` is over the ceiling for text (see textCeiling), before it is known what kind of text the file is.
 * @param {number} bytes @param {string} [name] @param {SizeLimits} [limits] */
export function assertWithinCeiling(bytes, name = '', limits = current.limits) {
  const ceiling = textCeiling(limits);
  if (ceiling > 0 && bytes > ceiling) {
    throw new SizeLimitError(`${name ? `"${name}"` : 'The file'} is ${formatSize(bytes)}, over the ${formatSize(ceiling)} limit. Set the org-xx-size-limit-* variables in Global Variables to change the limits.`, 'orgFile', bytes);
  }
}

/** The largest size any text kind may be, or 0 when one of them has no limit: the ceiling a download is cut off at when the
 * kind of file asked for is not known where it is fetched.
 * @param {SizeLimits} [limits] */
export function textCeiling(limits = current.limits) {
  const maxes = [limits.orgFile.max, limits.bibliography.max, limits.setupfile.max, limits.include.max];
  return maxes.some((m) => !m) ? 0 : Math.max(...maxes);
}

/** The bytes a string takes as UTF-8.
 * @param {string} text */
export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The bytes a base64 string holds.
 * @param {string} base64 */
export function base64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * What to do with a paste: `removedBytes` of the text are replaced by `pastedBytes`, in a file now `currentBytes`. The result is
 * checked as an Org file would be on opening: `{ ok: true }`, `{ ok: 'warn', message }` (ask first) or `{ ok: false, message }`.
 * @param {number} currentBytes
 * @param {number} removedBytes
 * @param {number} pastedBytes
 * @param {string} [name]
 * @param {SizeLimits} [limits]
 * @returns {{ ok: true } | { ok: 'warn', message: string } | { ok: false, message: string }}
 */
export function checkPaste(currentBytes, removedBytes, pastedBytes, name = '', limits = current.limits) {
  const total = Math.max(0, currentBytes - removedBytes) + pastedBytes;
  const verdict = checkSize('orgFile', total, limits, name);
  if (verdict.ok === 'warn') return { ok: 'warn', message: `Pasting makes ${name ? `"${name}"` : 'this file'} ${formatSize(total)}. That is large and may be slow. Paste anyway?` };
  return verdict;
}
