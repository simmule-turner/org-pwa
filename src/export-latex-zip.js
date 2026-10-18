// @ts-check
/**
 * LaTeX export as a .zip: the .tex file with the pictures it includes beside it, so it compiles where it is unpacked.
 * `readImage(target)` fetches one picture by the link as written in the document (it knows about GitHub, WebDAV and
 * attachments); a picture it cannot read is left as a plain path in the .tex file.
 */
import { createZip } from './zip-writer.js';
import { exportToLatex, latexImageTargets } from './export-latex.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

/**
 * @param {Doc} doc
 * @param {Heading | null} scope
 * @param {{ baseName: string, readImage: (target: string) => Promise<Uint8Array | null>, defaults?: { cls?: string, compiler?: string, sup?: string, header?: string } }} options
 * @returns {Promise<Uint8Array>}
 */
export async function exportLatexZip(doc, scope, { baseName, readImage, defaults }) {
  /** @type {Map<string, string>} link as written -> path inside the zip */
  const images = new Map();
  /** @type {{ name: string, content: Uint8Array }[]} */
  const files = [];
  const taken = new Set([baseName + '.tex']);
  for (const target of latexImageTargets(doc, scope)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\/\/)|^https?:/i.test(target.replace(/^file:/i, 'x:/')) && !/^(file|attachment):/i.test(target)) continue; // a web address stays a link
    const bytes = await readImage(target);
    if (!bytes) continue;
    const file = target.replace(/^(file|attachment):(\/\/)?/i, '').split('/').pop() || 'image';
    let name = 'images/' + file;
    for (let n = 2; taken.has(name); n++) name = 'images/' + file.replace(/(\.[^.]*)?$/, `-${n}$1`);
    taken.add(name);
    images.set(target, name);
    files.push({ name, content: bytes });
  }
  return createZip([{ name: baseName + '.tex', content: exportToLatex(doc, scope, { images, defaults }) }, ...files]);
}
