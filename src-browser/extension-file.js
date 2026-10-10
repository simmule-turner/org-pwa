// The init script kept in a literate Org document: the file is read, tangled, and the text of one tangle target is the script.
import { parseOrg } from '../src/org-parser.js';
import { tangleDocument } from '../src/tangle.js';
import { resolveIncludePath } from './export-import.js';

const MAX_SCRIPT_CHARS = 64 * 1024;
export const DEFAULT_TARGET = 'init.js';

/** 'github:me/notes/init.org::init.js' -> { key, target }. The target defaults to init.js. */
export function parseScriptFileSetting(text) {
  const at = String(text).lastIndexOf('::');
  const key = (at < 0 ? String(text) : String(text).slice(0, at)).trim();
  const target = (at < 0 ? '' : String(text).slice(at + 2)).trim() || DEFAULT_TARGET;
  return { key, target };
}

export async function readScriptFromFile(setting) {
  const { key, target } = parseScriptFileSetting(setting);
  if (!key) throw new Error('No file is named for the script.');
  let found = null;
  try {
    found = await resolveIncludePath(key);
  } catch (err) {
    throw new Error(`Could not read ${key}: ${err.message}`);
  }
  if (!found || typeof found.content !== 'string') throw new Error(`${key} was not found. Name it as github:path, webdav:path or local:name.`);
  const name = key.split(/[/:]/).pop() || 'init.org';
  const result = tangleDocument(parseOrg(found.content), { documentName: name });
  const file = result.files.find((f) => f.path === target);
  if (!file) {
    const available = result.files.map((f) => f.path).join(', ');
    throw new Error(`${key} has no source block with :tangle ${target}.` + (available ? ` It tangles to: ${available}.` : ' No block there has a :tangle header argument.'));
  }
  if (file.text.length > MAX_SCRIPT_CHARS) throw new Error(`The tangled script is longer than ${MAX_SCRIPT_CHARS / 1024} KB`);
  return file.text;
}
