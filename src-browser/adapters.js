// Extracted from app.js: adapters.
import { S } from './app-state.js';
import { createFileSystemAccessAdapter } from './filesystem-adapter.js';
import { createGithubAdapter } from './github-adapter.js';
import { createInputFileAdapter } from './input-file-adapter.js';
import { kv } from './singletons.js';
import { createWebdavAdapter } from './webdav-adapter.js';

export const filesystemAdapter = createFileSystemAccessAdapter(kv);

export const inputFileAdapter = createInputFileAdapter(kv);

export const githubAdapter = createGithubAdapter(() => S.githubConfig);

export const webdavAdapter = createWebdavAdapter(() => S.webdavConfig);
