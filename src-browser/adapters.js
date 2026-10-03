// Extracted from app.js: adapters.
import { S } from './app-state.js';
import { createGithubAdapter } from './github-adapter.js';
import { createInputFileAdapter } from './input-file-adapter.js';
import { platform } from './platform.js';
import { withLineEndings } from './line-endings-adapter.js';
import { kv } from './singletons.js';
import { createWebdavAdapter } from './webdav-adapter.js';

// Every adapter is wrapped so the app only sees "\n" text and a file keeps its own line endings (see line-endings-adapter.js).
// A local file's hash is made from its content, so it is recomputed; GitHub's sha and WebDAV's ETag are the server's own.
// Files on the device come from the platform (the browser's File System Access API, or a native shell's own), looked up on
// every call so a platform installed later is used. The line-ending wrapper then applies to whichever it is.
const localFileAdapter = {
  read: (...args) => platform.localFiles.adapter.read(...args),
  write: (...args) => platform.localFiles.adapter.write(...args),
  exists: (...args) => platform.localFiles.adapter.exists(...args),
  access: (...args) => platform.localFiles.adapter.access(...args),
};
export const filesystemAdapter = withLineEndings(localFileAdapter, kv, { contentDerivedHash: true });

export const inputFileAdapter = withLineEndings(createInputFileAdapter(kv), kv, { contentDerivedHash: true });

export const githubAdapter = withLineEndings(createGithubAdapter(() => S.githubConfig), kv);

export const webdavAdapter = withLineEndings(createWebdavAdapter(() => S.webdavConfig), kv);
