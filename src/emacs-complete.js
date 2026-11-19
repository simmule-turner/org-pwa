// @ts-check
/**
 * Completion in the minibuffer as Emacs's `try-completion` and `all-completions` have it (the basic style: the input is the start of the
 * candidate; case is ignored when `completion-ignore-case` is on, which it is for buffer names only by default, so here it is a parameter).
 * Held to Emacs 29.3 by test/emacs-complete.test.js.
 */

/** @param {string} a @param {string} b @param {boolean} fold */
function commonPrefix(a, b, fold) {
  let i = 0;
  while (i < a.length && i < b.length && (fold ? a[i].toLowerCase() === b[i].toLowerCase() : a[i] === b[i])) i += 1;
  return a.slice(0, i);
}

/** `all-completions`: the candidates that start with `input`, in order. @param {string} input @param {string[]} candidates @param {boolean} [fold] */
export function allCompletions(input, candidates, fold = false) {
  const lower = input.toLowerCase();
  return candidates.filter((c) => (fold ? c.toLowerCase().startsWith(lower) : c.startsWith(input)));
}

/**
 * `try-completion`: null when nothing matches, true when `input` is the only match exactly, else the longest common start of the matches
 * (with case folded, in the case Emacs prefers: an exact match, or one that keeps the case of the input).
 * @param {string} input @param {string[]} candidates @param {boolean} [fold] @returns {string | true | null}
 */
export function tryCompletion(input, candidates, fold = false) {
  const matches = allCompletions(input, candidates, fold);
  if (matches.length === 0) return null;
  let best = matches[0];
  let bestSize = best.length;
  let count = 1;
  for (const elt of matches.slice(1)) {
    const matchSize = commonPrefix(best.slice(0, bestSize), elt, fold).length;
    const oldBest = best;
    const compare = Math.min(bestSize, elt.length);
    if (fold) {
      const exactHere = matchSize === elt.length;
      const exactBest = matchSize === best.length;
      if ((exactHere && matchSize < best.length) || (exactHere === exactBest && elt.slice(0, input.length) === input && best.slice(0, input.length) !== input)) best = elt;
    }
    if (bestSize !== elt.length || bestSize !== matchSize || (fold && oldBest.slice(0, compare) !== elt.slice(0, compare))) count = Math.min(2, count + 1);
    bestSize = matchSize;
  }
  if (fold && bestSize === input.length && best.length > bestSize) return input;
  if (count === 1 && best === input) return true;
  return best.slice(0, bestSize);
}

/**
 * What TAB does (`minibuffer-complete`): the new input and the message Emacs shows.
 * @param {string} input @param {string[]} candidates @param {boolean} [fold] @returns {{ input: string, message: string, list: boolean }}
 */
export function completeInput(input, candidates, fold = false) {
  const got = tryCompletion(input, candidates, fold);
  if (got === null) return { input, message: '[No match]', list: false };
  if (got === true) return { input, message: '[Sole completion]', list: false };
  const matches = allCompletions(got, candidates, fold);
  if (matches.length === 1) return { input: got, message: got === matches[0] ? '[Sole completion]' : '', list: false };
  return { input: got, message: '', list: got === input };
}
