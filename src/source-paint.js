// @ts-check
/** @typedef {string | null} Face */

/** One face per UTF-16 unit of the code; `set` overrides, `fill` paints only what is still plain (a font-lock rule without OVERRIDE). */
export class Paint {
  /** @param {number} n */
  constructor(n) {
    /** @type {Face[]} */
    this.faces = new Array(n).fill(null);
  }

  /** @param {number} a @param {number} b @param {string | null} face */
  set(a, b, face) {
    for (let i = a; i < b; i++) this.faces[i] = face;
  }

  /** Paints the range only when none of it has a face yet, as font-lock does for a rule that does not override (font-lock-apply-highlight). @param {number} a @param {number} b @param {string} face */
  fill(a, b, face) {
    for (let i = a; i < b; i++) if (this.faces[i] !== null) return;
    for (let i = a; i < b; i++) this.faces[i] = face;
  }

  /** @param {string} code @returns {[string, Face][]} */
  runs(code) {
    /** @type {[string, Face][]} */
    const out = [];
    let start = 0;
    for (let i = 1; i <= code.length; i++) {
      if (i === code.length || this.faces[i] !== this.faces[start]) {
        out.push([code.slice(start, i), this.faces[start] ?? null]);
        start = i;
      }
    }
    return code.length ? out : [];
  }
}

/**
 * One font-lock rule: every match of `re` in turn, searching on from the end of the last, and its groups painted `[group, face, override]`; a group that
 * did not match is skipped. A face may be a function of the match (a rule whose face depends on whether another group matched).
 * @param {string} code @param {Paint} paint @param {RegExp} re
 * @param {[number, string | ((m: RegExpExecArray) => string), boolean?][]} groups
 */
export function rule(code, paint, re, groups) {
  const g = new RegExp(re.source, [...new Set([...re.flags, 'g', 'd', 'u'])].join(''));
  for (let m; (m = g.exec(code)); ) {
    if (m[0] === '') { g.lastIndex++; continue; }
    const spans = /** @type {RegExpIndicesArray} */ (m.indices);
    for (const [k, face, override] of groups) {
      const span = spans[k];
      if (!span) continue;
      const name = typeof face === 'function' ? face(m) : face;
      if (override) paint.set(span[0], span[1], name);
      else paint.fill(span[0], span[1], name);
    }
  }
}
