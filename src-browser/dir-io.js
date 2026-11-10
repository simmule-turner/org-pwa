// @ts-check
// Lists, reads, writes and deletes in a folder the browser gave access to (a FileSystemDirectoryHandle); paths are relative to it.
// device-folder.js supplies the folder the person chose; the tests supply one made of plain objects.
import { arrayBufferToBase64, base64ToArrayBuffer } from './webdav-adapter.js';

/** @typedef {import('../src/file-ops.js').FileEntry} FileEntry */

/** @param {string} path @returns {[string, string]} the folder and the name */
export function splitPath(path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop() || '';
  return [parts.join('/'), name];
}

/** @param {() => Promise<any>} getRoot the folder handle, or null when none is chosen */
export function createDirIo(getRoot) {
  /** The folder handle at `folder` below the root. @param {string} folder @param {boolean} [create] */
  async function dirAt(folder, create = false) {
    let dir = await getRoot();
    if (!dir) throw new Error('No folder has been chosen.');
    for (const part of folder.split('/').filter(Boolean)) {
      if (part === '.' || part === '..') throw new Error('A path cannot leave the folder.');
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  const io = {
    /** @param {string} folder @returns {Promise<FileEntry[]>} */
    async list(folder) {
      const dir = await dirAt(folder.replace(/^\/+/, ''));
      /** @type {FileEntry[]} */
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        const path = [folder.replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');
        if (handle.kind === 'directory') out.push({ name, path, type: 'dir' });
        else {
          const file = await handle.getFile().catch(() => null);
          out.push({ name, path, type: 'file', ...(file ? { size: file.size, modified: file.lastModified } : {}) });
        }
      }
      return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    },
    /** @param {string} path */
    async readBinary(path) {
      const [folder, name] = splitPath(path);
      try {
        const file = await (await (await dirAt(folder)).getFileHandle(name)).getFile();
        return { base64: arrayBufferToBase64(await file.arrayBuffer()), hash: null };
      } catch (err) {
        if (err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
        throw err;
      }
    },
    /** @param {string} path @param {string} base64 */
    async writeBinary(path, base64) {
      const [folder, name] = splitPath(path);
      const handle = await (await dirAt(folder, true)).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(base64 ? new Uint8Array(base64ToArrayBuffer(base64)) : new Uint8Array(0));
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => {});
        throw err;
      }
      return { hash: null };
    },
    /** @param {string} path */
    async delete(path) {
      const [folder, name] = splitPath(path);
      try {
        await (await dirAt(folder)).removeEntry(name, { recursive: true });
      } catch (err) {
        if (!err || err.name !== 'NotFoundError') throw err;
      }
    },
    /** @param {string} path */
    async exists(path) {
      return !!(await io.readBinary(path));
    },
  };
  return { ...io, dirAt };
}
