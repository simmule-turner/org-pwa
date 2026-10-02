// Wraps a storage adapter so the app only ever sees "\n" text, and the file keeps its own line endings (see
// src/line-endings.js). One wrapper, applied where the adapters are created, instead of a change in every place a file
// is read or written.
import { detectLineEnding, fromLf, toLf } from '../src/line-endings.js';
import { contentHash } from '../src/sync-engine.js';

const eolKey = (documentId) => 'lineEnding:' + documentId;

async function recall(kvAdapter, documentId) {
  try {
    const result = await kvAdapter.get(eolKey(documentId));
    const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
    return value === '\r\n' ? '\r\n' : '\n';
  } catch {
    return '\n';
  }
}

async function remember(kvAdapter, documentId, eol) {
  try {
    if (eol === '\r\n') await kvAdapter.set(eolKey(documentId), '\r\n');
    else await kvAdapter.delete(eolKey(documentId)); // Unix-style is the default, so it leaves nothing behind
  } catch {
    // remembering is a convenience: the file is re-read on the next open, which sets it again
  }
}

/**
 * `contentDerivedHash`: the adapter's `hash` is a hash of the content (a local file), not the server's own version
 * token (GitHub's blob sha, WebDAV's ETag). A content hash is recomputed on the "\n" text, so it agrees with every other
 * hash the app makes of that text; a server token is passed through untouched.
 */
export function withLineEndings(adapter, kvAdapter, { contentDerivedHash = false } = {}) {
  return {
    ...adapter,
    async read(documentId, ...rest) {
      const result = await adapter.read(documentId, ...rest);
      if (!result || typeof result.content !== 'string') return result;
      await remember(kvAdapter, documentId, detectLineEnding(result.content));
      const content = toLf(result.content);
      return contentDerivedHash ? { ...result, content, hash: contentHash(content) } : { ...result, content };
    },
    async write(documentId, content, ...rest) {
      const eol = await recall(kvAdapter, documentId);
      const written = await adapter.write(documentId, fromLf(content, eol), ...rest);
      return contentDerivedHash && written ? { ...written, hash: contentHash(content) } : written;
    },
  };
}
