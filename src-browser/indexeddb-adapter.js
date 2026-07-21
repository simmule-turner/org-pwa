/**
 * Real IndexedDB-backed implementation of the kv adapter interface used
 * everywhere else (get/set/delete/list) — a drop-in replacement for
 * kv-adapter.js's in-memory version. Every module in src/ that takes a
 * "kvAdapter" argument was written and tested against that interface, not
 * against IndexedDB directly, so this file is the only place IndexedDB
 * specifics live.
 */

const DB_NAME = 'org-pwa';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIndexedDbAdapter() {
  const dbPromise = openDb();

  async function withStore(mode, fn) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    async get(key) {
      const value = await withStore('readonly', (store) => store.get(key));
      return value === undefined ? null : { key, value };
    },
    async set(key, value) {
      await withStore('readwrite', (store) => store.put(value, key));
      return { key, value };
    },
    async delete(key) {
      const existing = await this.get(key);
      await withStore('readwrite', (store) => store.delete(key));
      return existing ? { key, deleted: true } : null;
    },
    async list(prefix = '') {
      const db = await dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const keys = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve({ keys });
            return;
          }
          if (String(cursor.key).startsWith(prefix)) keys.push(cursor.key);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },
  };
}
