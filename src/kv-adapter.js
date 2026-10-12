// @ts-check

/**
 * In-memory adapter matching the artifact platform's window.storage shape
 * (get/set/delete/list), so modules written against this interface — fold
 * state, outbox, sync — work unmodified against the real thing later.
 * Used directly by tests; browser code would swap in a real IndexedDB or
 * window.storage-backed adapter with the same four methods.
 */
function createInMemoryAdapter() {
  const map = new Map();
  return {
    /** @param {any} [key] */
    async get(key) {
      return map.has(key) ? { key, value: map.get(key) } : null;
    },
    /**
     * @param {any} [key]
     * @param {any} [value]
     */
    async set(key, value) {
      map.set(key, value);
      return { key, value };
    },
    /** @param {any} [key] */
    async delete(key) {
      const existed = map.has(key);
      map.delete(key);
      return existed ? { key, deleted: true } : null;
    },
    async list(prefix = '') {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)) };
    },
  };
}

export { createInMemoryAdapter };
