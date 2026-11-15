// @ts-check
// The Info manuals kept on this device: one record per manual under "info:manual:<name>" in the app's key-value store.
import { kv } from './singletons.js';

/** @typedef {import('../src/info-store.js').ManualRecord} ManualRecord */

const PREFIX = 'info:manual:';

/** Every stored manual, by name. @returns {Promise<ManualRecord[]>} */
export async function loadRecords() {
  const { keys } = await kv.list(PREFIX);
  /** @type {ManualRecord[]} */
  const records = [];
  for (const key of keys) {
    const entry = await kv.get(key);
    if (entry) records.push(JSON.parse(String(entry.value)));
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {ManualRecord} record */
export async function saveRecord(record) {
  await kv.set(PREFIX + record.name, JSON.stringify(record));
}

/** @param {string} name */
export async function removeRecord(name) {
  await kv.delete(PREFIX + name);
}
