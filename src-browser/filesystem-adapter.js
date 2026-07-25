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
  const [handle] = await window.showOpenFilePicker({
    // '*/*' rather than 'text/plain': on Android, the underlying Storage
    // Access Framework filters by each file's actual reported MIME
    // type, not by extension — and .org has no registered MIME type on
    // Android (unlike .txt, which cleanly maps to text/plain), so files
    // were being hidden from the picker even though the extension
    // matched. '*/*' filters by extension only, sidestepping MIME-type
    // lookup entirely. This is the documented fix for this exact issue.
    types: [{ description: 'Org files', accept: { '*/*': ['.org'] } }],
  });
  const documentId = handle.name;
  await kvAdapter.set(handleKey(documentId), handle);
  return documentId;
}

/** Same idea, for creating a brand new file rather than opening an existing one. */
export async function pickAndRegisterNewFile(kvAdapter, suggestedName = 'untitled.org') {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'Org files', accept: { '*/*': ['.org'] } }], // same reasoning as pickAndRegisterFile above
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
