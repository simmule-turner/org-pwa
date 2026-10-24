// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/**
 * The .odt export entry point: a port of Org's ox-odt.js (see ox-odt.js), packaged as a
 * ZIP. Kept as its own module so callers need not know which file holds the port.
 */
import { exportToOdtPort } from './ox-odt.js';

/**
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {{ sup?: string, brokenLinks?: import('./broken-links.js').BrokenLinks, images?: Map<string, string> | null, highlight?: boolean, userFullName?: string, init?: string }} [options]
 * @returns {Uint8Array}
 */
export function exportToOdt(doc, scope = null, options = {}) {
  return exportToOdtPort(doc, scope, { ...options, images: options.images || undefined }).zip;
}
