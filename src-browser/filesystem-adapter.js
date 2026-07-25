/**
 * Real File System Access API implementation of the "disk" adapter
 * interface — read(fileId)/write(fileId, content)/exists(fileId) — that
 * sync-engine.js and document-store.js were written and tested against
 * using createInMemoryDiskAdapter(). This file is the only place browser
 * file-picker/permission specifics live.
 *
 * FileSystemFileHandle objects are structured-cloneable and IndexedDB
 * explicitly supports storing them, which is what makes "remember this
 * file across sessions without re-prompting the picker" possible — we
 * store the handle itself (not a path string) in the kv adapter, keyed by
 * documentId, and re-request permission on it each session as the File
 * System Access API requires.
 */

import { contentHash } from '../src/sync-engine.js';

function handleKey(fileId) {
  return 'filehandle:' + fileId;
}

async function verifyPermission(handle, mode) {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

/**
 * Opens the browser's file picker and registers the chosen file's handle
 * under its own filename as documentId. Must be called from a user
 * gesture (click handler) — the File System Access API requires that.
 * Returns the documentId to use with openDocument/saveAndSync.
 */
export async function pickAndRegisterFile(kvAdapter) {
  // No `types` filter here, deliberately: an earlier attempt used
  // accept: {'*/*': ['.org']} specifically to work around Android's
  // Storage Access Framework filtering by MIME type rather than
  // extension -- but that was directly tested and confirmed to still
  // hide .org files in Android's picker while .txt worked fine. This
  // points to Android Chrome's file-type filtering being unreliable
  // for non-standard extensions regardless of how the MIME filter is
  // configured, not something fixable by trying yet another `accept`
  // shape. Showing every file sidesteps the buggy filtering logic
  // entirely: the person picks their .org file by name, same as they
  // would in any other file-picking context on the platform.
  const [handle] = await window.showOpenFilePicker();
  const documentId = handle.name;
  await kvAdapter.set(handleKey(documentId), handle);
  return documentId;
}

/** Same idea, for creating a brand new file rather than opening an existing one. */
export async function pickAndRegisterNewFile(kvAdapter, suggestedName = 'untitled.org') {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    // Save is a different situation from open above: it's about typing
    // a new filename, not selecting from a list of existing files, so
    // it doesn't have the "file invisible in the list" failure mode --
    // and suggestedName already gives the right default extension
    // regardless of what this filter does. Left as '*/*' rather than
    // removed for consistency, not because it's confirmed necessary.
    types: [{ description: 'Org files', accept: { '*/*': ['.org'] } }],
  });
  const documentId = handle.name;
  await kvAdapter.set(handleKey(documentId), handle);
  return documentId;
}

export function createFileSystemAccessAdapter(kvAdapter) {
  async function getHandle(documentId) {
    const result = await kvAdapter.get(handleKey(documentId));
    return result ? result.value : null;
  }

  return {
    async read(documentId) {
      const handle = await getHandle(documentId);
      if (!handle) return null;
      const ok = await verifyPermission(handle, 'read');
      if (!ok) throw new Error(`Permission denied reading "${documentId}"`);
      const file = await handle.getFile();
      const content = await file.text();
      return { content, hash: contentHash(content) };
    },

    async write(documentId, content) {
      const handle = await getHandle(documentId);
      if (!handle) {
        throw new Error(
          `No file handle registered for "${documentId}" — call pickAndRegisterFile/pickAndRegisterNewFile first`
        );
      }
      const ok = await verifyPermission(handle, 'readwrite');
      if (!ok) throw new Error(`Permission denied writing "${documentId}"`);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { hash: contentHash(content) };
    },

    async exists(documentId) {
      return (await getHandle(documentId)) !== null;
    },
  };
}

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}
