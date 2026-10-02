// Extracted from app.js: adapters.
import { S } from './app-state.js';
import { createFileSystemAccessAdapter } from './filesystem-adapter.js';
import { createGithubAdapter } from './github-adapter.js';
import { createInputFileAdapter } from './input-file-adapter.js';
import { withLineEndings } from './line-endings-adapter.js';
import { kv } from './singletons.js';
import { createWebdavAdapter } from './webdav-adapter.js';

// Every adapter is wrapped so the app only sees "\n" text and a file keeps its own line endings (see line-endings-adapter.js).
// A local file's hash is made from its content, so it is recomputed; GitHub's sha and WebDAV's ETag are the server's own.
export const filesystemAdapter = withLineEndings(createFileSystemAccessAdapter(kv), kv, { contentDerivedHash: true });

export const inputFileAdapter = withLineEndings(createInputFileAdapter(kv), kv, { contentDerivedHash: true });

export const githubAdapter = withLineEndings(createGithubAdapter(() => S.githubConfig), kv);

export const webdavAdapter = withLineEndings(createWebdavAdapter(() => S.webdavConfig), kv);
