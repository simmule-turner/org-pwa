// Link prefixes a script registered with org.linkType, shared between the script runner and the link renderer.
// Kept apart from extension-flow.js so drawing a link does not pull in the whole script machinery.
export const links = { prefixes: new Set(), open: null };

/** { prefix, path } when `target` starts with a prefix a script claimed, else null. */
export function customLink(target) {
  const m = /^([a-z][a-z0-9-]*):(.*)$/i.exec(String(target || '').trim());
  return m && links.prefixes.has(m[1].toLowerCase()) ? { prefix: m[1].toLowerCase(), path: m[2] } : null;
}
