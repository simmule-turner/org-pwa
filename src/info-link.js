// @ts-check
// `[[info:manual#node]]` links, as ol-info reads them (org-info--link-file-node): the manual and the node, separated by "#" or ":"
// (or "::"); a link without a node opens the manual's Top, and one without a manual the directory.

/**
 * @param {string | null | undefined} path what follows "info:" in the link
 * @returns {{ manual: string, node: string }}
 */
export function parseInfoLink(path) {
  if (path === null || path === undefined) return { manual: 'dir', node: 'Top' };
  const m = /^([^#:]*)(?:[#:]:?([\s\S]*))?$/.exec(path);
  const manual = (m && m[1] ? m[1] : '').trim();
  const node = (m && m[2] ? m[2] : '').trim();
  return { manual: manual || 'dir', node: node || 'Top' };
}
