// @ts-check
/**
 * Whether a file named by a document (a #+SETUPFILE:, a bibliography) may be fetched from the web. Like Emacs
 * (org-resource-download-policy 'prompt), nothing is fetched until the person has said yes to that address.
 */

/** The key a decision is kept under: the address without a #fragment.
 * @param {string} url */
export function remoteKey(url) {
  return 'remote-ok:' + url.trim().replace(/#.*$/, '');
}

/**
 * What to do with a remote file.
 * @param {string | null | undefined} saved  the answer kept for this address: 'always', 'never' or nothing
 * @param {string | null | undefined} thisSession  the answer given in this visit: 'once', 'skip' or nothing
 * @returns {'fetch' | 'skip' | 'ask'}
 */
export function remoteDecision(saved, thisSession) {
  if (saved === 'always') return 'fetch';
  if (saved === 'never') return 'skip';
  if (thisSession === 'once') return 'fetch';
  if (thisSession === 'skip') return 'skip';
  return 'ask';
}
