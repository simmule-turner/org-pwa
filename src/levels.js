// @ts-check
// Odd levels (org-odd-levels-only, #+STARTUP: odd / oddeven) and hidden leading stars (org-hide-leading-stars, #+STARTUP: hidestars /
// showstars): the stars a heading takes when its level changes, and how they are drawn.

/**
 * `org-get-valid-level`: the number of stars a heading gets when its level changes by `change` (-1, 0 or 1) under org-odd-levels-only.
 * @param {number} level @param {number} change @param {boolean} odd
 */
export function validLevel(level, change, odd) {
  if (!odd) return Math.max(1, level + change);
  if (change === 0) return 1 + 2 * Math.trunc(level / 2);
  if (change > 0) return 1 + 2 * Math.trunc((level - 1 + 2 * change) / 2);
  return Math.max(1, 1 + 2 * Math.trunc((level + 2 * change) / 2));
}

/** The last of the `#+STARTUP:` words `names` that the file has, or null. @param {import('./types.js').Doc} doc @param {string[]} names */
function startupWord(doc, names) {
  let found = null;
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'STARTUP') continue;
    for (const word of kw.value.toLowerCase().split(/\s+/)) if (names.includes(word)) found = word;
  }
  return found;
}

/** org-odd-levels-only for this file: `#+STARTUP: odd` or `oddeven`, else the variable. @param {import('./types.js').Doc | null} doc */
export function oddLevelsOnly(doc) {
  if (!doc) return false;
  const word = startupWord(doc, ['odd', 'oddeven']);
  return word === null ? doc.oddLevelsVariable === true : word === 'odd';
}

/** org-hide-leading-stars for this file: `#+STARTUP: hidestars` or `showstars`, else the variable. @param {import('./types.js').Doc | null} doc */
export function hideLeadingStars(doc) {
  if (!doc) return false;
  const word = startupWord(doc, ['hidestars', 'showstars']);
  return word === null ? doc.hideStarsVariable === true : word === 'hidestars';
}

/** How the stars of a heading with `level` stars are drawn: a hidden star is blank. @param {number} level @param {boolean} hide */
export function starsText(level, hide) {
  return hide ? ' '.repeat(level - 1) + '*' : '*'.repeat(level);
}
