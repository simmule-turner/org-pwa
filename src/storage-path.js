// @ts-check
/**
 * The last check before a path is sent to a storage backend (GitHub, WebDAV): a path that has a "." or ".." part, an empty part in
 * the middle, a backslash or a control character is refused, so a document can never name a file outside the repository or
 * folder it is stored in. (A web request would otherwise resolve "a/../../b" for it.)
 */

/** Throws if `path` is not a plain relative path inside the storage root. A leading or trailing "/" and the empty path (the
 * root itself) are fine.
 * @param {string} path
 * @returns {string} the same path */
export function assertSafeStoragePath(path) {
  const text = String(path ?? '');
  if (/[\\\u0000-\u001f\u007f]/.test(text)) throw new Error(`Refusing the path "${text.replace(/[\u0000-\u001f\u007f]/g, '?')}": it has a backslash or control character.`);
  const parts = text.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length === 1 && parts[0] === '') return text; // the root
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`Refusing the path "${text}": it would leave the folder it is stored in.`);
  return text;
}
