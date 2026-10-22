// @ts-check
/**
 * `(load "github:org/holidays.el")` in an init text: the file's own text goes in its place, so one file can hold the settings shared
 * between devices. The name is written like an agenda file (`github:`, `webdav:` or `local:`); a name without a scheme is looked for
 * beside the file that loads it. Files may load files, to five levels, each once.
 */

const MAX_DEPTH = 5;

/**
 * The `(load "name")` forms of an init text outside strings and comments, with where they are.
 * @param {string} text
 * @returns {{ start: number, end: number, name: string }[]}
 */
export function findLoads(text) {
  /** @type {{ start: number, end: number, name: string }[]} */
  const found = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ';') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '(') {
      const m = /^\(\s*load\s+"((?:[^"\\]|\\.)*)"[^()]*\)/.exec(text.slice(i));
      if (m) {
        found.push({ start: i, end: i + m[0].length, name: m[1].replace(/\\(.)/g, '$1') });
        i += m[0].length;
      } else i++;
    } else i++;
  }
  return found;
}

/**
 * Where a name loaded from `from` points: a name with a scheme as it is, any other next to `from` (a leading "/" means from the top).
 * @param {string} name @param {string} from  a spec such as "github:org/init.el", or "" for the settings box
 */
export function resolveLoad(name, from) {
  if (/^(github|webdav|local):/.test(name) || !from) return name;
  const colon = from.indexOf(':');
  const dir = from.slice(colon + 1).split('/').slice(0, -1);
  const parts = name.startsWith('/') ? name.slice(1).split('/') : [...dir, ...name.split('/')];
  /** @type {string[]} */
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return `${from.slice(0, colon)}:${out.join('/')}`;
}

/**
 * The init text with every `load` replaced by the text of its file. A file that cannot be read is left out and named in `errors`.
 * @param {string} text
 * @param {(spec: string) => Promise<string>} read
 * @param {string} [from]
 * @param {Set<string>} [seen]
 * @param {number} [depth]
 * @returns {Promise<{ text: string, errors: string[], specs: string[] }>}
 */
export async function expandLoads(text, read, from = '', seen = new Set(), depth = 0) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const specs = [];
  let out = '';
  let at = 0;
  for (const load of findLoads(text)) {
    out += text.slice(at, load.start);
    at = load.end;
    const spec = resolveLoad(load.name, from);
    if (!/^(github|webdav|local):/.test(spec)) {
      errors.push(`load "${load.name}": name it like an agenda file, such as github:holidays.el`);
    } else if (seen.has(spec)) {
      continue; // each file once, which also ends a file that loads itself
    } else if (depth >= MAX_DEPTH) {
      errors.push(`load "${spec}": files load files more than ${MAX_DEPTH} levels deep`);
    } else {
      seen.add(spec);
      try {
        const inner = await expandLoads(await read(spec), read, spec, seen, depth + 1);
        specs.push(spec, ...inner.specs);
        errors.push(...inner.errors);
        out += `\n${inner.text}\n`;
      } catch (err) {
        errors.push(`load "${spec}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return { text: out + text.slice(at), errors, specs };
}
