// @ts-check
// Extracted from app.js: adapters.
import { S } from './app-state.js';
import { createGithubAdapter } from './github-adapter.js';
import { createInputFileAdapter } from './input-file-adapter.js';
import { folderAvailable, folderFileExists, readFolderText, writeFolderText } from './local-folder.js';
import { platform } from './platform.js';
import { matchesExpected, writeConflict } from '../src/sync-engine.js';
import { withLineEndings } from './line-endings-adapter.js';
import { kv } from './singletons.js';
import { createWebdavAdapter } from './webdav-adapter.js';

// Every adapter is wrapped so the app only sees "\n" text and a file keeps its own line endings (see line-endings-adapter.js).
// A local file's hash is made from its content, so it is recomputed; GitHub's sha and WebDAV's ETag are the server's own.
// Files on the device come from the platform (the browser's File System Access API, or a native shell's own), looked up on
// every call so a platform installed later is used. The line-ending wrapper then applies to whichever it is.
const localFileAdapter = {
  // A file the person opened through the picker is found by its name and used where it was picked. Any other name is looked up
  // in the org-pwa folder, if one is chosen (local-folder.js), so `local:contacts.org` and the like resolve without a picker.
  async read(/** @type {any[]} */ ...args) {
    const picked = await platform.localFiles.adapter.read(...args);
    if (picked || !folderAvailable()) return picked;
    return readFolderText(args[0]);
  },
  /**
   * @param {string} id
   * @param {string} content
   */
  async write(id, content, /** @type {any[]} */ ...rest) {
    const options = rest[0];
    // `expect`: the version this save was compared against. A local file has no server to refuse a stale write, so the file is
    // read again just before writing, and if someone else changed it meanwhile the save says so instead of replacing it.
    if (options && options.expect && !matchesExpected(options.expect, await this.read(id))) {
      throw writeConflict(`"${id}" was changed by something else while it was being saved`);
    }
    if (folderAvailable() && (await platform.localFiles.adapter.access(id)) === 'none') return writeFolderText(id, content);
    return platform.localFiles.adapter.write(id, content, ...rest);
  },
  /** @param {string} id */
  async exists(id) {
    return (await platform.localFiles.adapter.exists(id)) || (folderAvailable() && (await folderFileExists(id)));
  },
  /** @param {string} id */
  async access(id) {
    const picked = await platform.localFiles.adapter.access(id);
    if (picked !== 'none' || !folderAvailable()) return picked;
    return (await folderFileExists(id)) ? 'granted' : 'none';
  },
  // attachments live in the same folder (see attachments-store.js), not beside the document
  readBinary: (/** @type {any[]} */ ...args) => platform.attachments.adapter.readBinary(...args),
  writeBinary: (/** @type {any[]} */ ...args) => platform.attachments.adapter.writeBinary(...args),
  delete: (/** @type {any[]} */ ...args) => platform.attachments.adapter.delete(...args),
  list: (/** @type {any[]} */ ...args) => platform.attachments.adapter.list(...args),
};
export const filesystemAdapter = withLineEndings(localFileAdapter, kv, { contentDerivedHash: true });

export const inputFileAdapter = withLineEndings(createInputFileAdapter(kv), kv, { contentDerivedHash: true });

export const githubAdapter = withLineEndings(createGithubAdapter(() => S.githubConfig), kv);

export const webdavAdapter = withLineEndings(createWebdavAdapter(() => S.webdavConfig), kv);
