// Differences from Emacs that test/outline-edit-oracle.test.js keeps, each with its reason.
/** @type {{ reason: string, test: (c: any, got: string, want: string) => boolean }[]} */
export const KNOWN = [];
export const known = (c, got, want) => KNOWN.some((k) => k.test(c, got, want));
