// @ts-check
// Pictures for HTML export: a standalone page has nowhere to find `[[file:pic.png]]`, so every picture this app can
// read (GitHub and WebDAV files, attachments) is embedded as a data URL. Anything else keeps its link.
import { guessImageMimeType, isExternalUrl, resolveAttachmentTarget, resolveImagePath } from '../src/link-resolve.js';
import { S } from './app-state.js';
import { attachmentsAvailable } from './attachments-store.js';
import { activeDiskAdapter } from './external-sync.js';
import { imageDataUrlCache } from './singletons.js';

const IMAGE_LINK_RE = /\[\[((?:file:|attachment:)?[^\]\n]+?\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:::[^\]]*)?\]/gi;

/**
 * The headings of the export, depth first: the whole document or the subtree under `scope`.
 * @param {any} [doc]
 * @param {any} [scope]
 */
function headingsToScan(doc, scope) {
  /** @type {any[]} */ const out = [];
  /** @param {any} [h] */
  const walk = (h) => {
    out.push(h);
    for (const c of h.children || []) walk(c);
  };
  if (scope) walk(scope);
  else for (const h of doc.children || []) walk(h);
  return out;
}

/**
 * Map of image link target -> data URL for every picture in the export that can be read.
 * @param {any} [doc]
 */
export async function collectExportImages(doc, scope = /** @type {any} */ (null)) {
  const images = new Map();
  const readable = S.state.storageKind === 'github' || S.state.storageKind === 'webdav';
  const sources = [{ heading: null, lines: scope ? scope.bodyLines || [] : doc.bodyLines || [] }, ...headingsToScan(doc, scope).map((h) => ({ heading: h, lines: h.bodyLines || [] }))];
  const jobs = [];
  for (const { heading, lines } of sources) {
    for (const line of lines) {
      for (const m of line.matchAll(IMAGE_LINK_RE)) {
        const target = m[1];
        if (images.has(target) || /^https?:/i.test(target) || isExternalUrl(target)) continue;
        const isAttachment = /^attachment:/i.test(target);
        if (!(readable || (isAttachment && attachmentsAvailable()))) continue;
        const path = isAttachment ? resolveAttachmentTarget(doc, heading, target, S.state.documentId) : resolveImagePath(target, S.state.documentId);
        if (!path) continue;
        images.set(target, null);
        jobs.push(
          (async () => {
            const key = S.state.storageKind + ':' + path;
            if (imageDataUrlCache.has(key)) return images.set(target, imageDataUrlCache.get(key));
            try {
              const result = await activeDiskAdapter().readBinary(path);
              if (result) {
                const url = `data:${guessImageMimeType(path)};base64,${result.base64}`;
                imageDataUrlCache.set(key, url);
                images.set(target, url);
              }
            } catch {
              // an unreadable picture keeps its link
            }
          })()
        );
      }
    }
  }
  await Promise.all(jobs);
  for (const [k, v] of images) if (!v) images.delete(k);
  return images;
}
