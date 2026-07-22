/**
 * Fallback storage for browsers without File System Access API — in
 * practice, every browser on iOS, since Apple requires all of them to use
 * WebKit under the hood, and WebKit has never implemented that API. Not
 * fixable by switching browsers on that platform; this is the real
 * workaround, not a placeholder for one.
 *
 * The shape here is necessarily different from the other adapters in what
 * it CAN do, because the platform genuinely has no live disk access:
 *   - read(fileId) can only ever return whatever was last imported via
 *     the file picker. There's no way to re-poll "the file" for changes
 *     made outside the app without the user explicitly re-picking it.
 *   - write(fileId, content) triggers a browser download of the new
 *     content; the user has to manually move it into place (overwrite the
 *     original in the Files app / iCloud Drive). Same pattern virtually
 *     every iOS web app with local file support uses, because there
 *     isn't a better one available on the platform.
 *
 * Despite that, it still implements the same { read, write, exists }
 * shape as the other adapters, so document-store.js and sync-engine.js
 * need zero changes to work with it.
 */

import { contentHash } from '../src/sync-engine.js';

function importedFileKey(fileId) {
  return 'ios-import:' + fileId;
}

function unwrap(result) {
  return result && typeof result === 'object' && 'value' in result ? result.value : result;
}

/**
 * Opens the browser's native file picker and returns { fileId, content }
 * for the chosen file, caching the content into `kvAdapter` so a later
 * read() in the same (or a future) session can return it again without
 * re-picking. Must be called from a user gesture (a click handler) — the
 * picker won't open otherwise.
 */
export function pickAndImportFile(kvAdapter, accept = '.org') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      try {
        const content = await file.text();
        const fileId = file.name;
        await kvAdapter.set(importedFileKey(fileId), content);
        resolve({ fileId, content });
      } catch (err) {
        reject(err);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}

/** Triggers a browser download of `content` as a file named `fileId` —
 *  the "write" half, since there's no handle to write back to in place. */
export function downloadFile(fileId, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileId;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function createInputFileAdapter(kvAdapter, downloadFn = downloadFile) {
  return {
    async read(fileId) {
      try {
        const result = await kvAdapter.get(importedFileKey(fileId));
        if (!result) return null;
        const content = unwrap(result);
        return { content, hash: contentHash(content) };
      } catch {
        return null;
      }
    },

    async write(fileId, content) {
      await kvAdapter.set(importedFileKey(fileId), content);
      downloadFn(fileId, content);
      return { hash: contentHash(content) };
    },

    async exists(fileId) {
      try {
        const result = await kvAdapter.get(importedFileKey(fileId));
        return !!result;
      } catch {
        return false;
      }
    },
  };
}

/** True when the platform has no File System Access API at all — the
 *  signal the UI uses to offer this fallback (and GitHub) instead of the
 *  native file picker flow. */
export function isFileSystemAccessUnsupported() {
  return typeof window === 'undefined' || !('showOpenFilePicker' in window);
}
