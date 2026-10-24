// @ts-check
/**
 * prfac: Calc's prime factorization, a vector of the prime factors in ascending order. Like Calc it divides only by the primes up to 5003,
 * so what is left after that comes back as one last element, which may not be prime.
 */

import { I, VEC, registerFunction } from './calc-symbolic.js';

/** @typedef {import('./calc-symbolic.js').Form} Form */

const LIMIT = 5003;
const PRIMES = (() => {
  /** @type {number[]} */ const out = [];
  for (let n = 2; n <= LIMIT; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out.map(BigInt);
})();

/** @param {bigint} n a natural number @returns {bigint[]} */
function factorsOf(n) {
  if (n <= 2n) return [n];
  /** @type {bigint[]} */ const factors = [];
  for (const p of PRIMES) {
    if (n === 1n) break;
    while (n % p === 0n) {
      factors.push(p);
      n /= p;
    }
    if (n !== 1n && p >= n / p) { // nothing below p divides n, and p * p > n: what is left is prime
      factors.push(n);
      n = 1n;
    }
  }
  if (n !== 1n) factors.push(n);
  return factors;
}

registerFunction('prfac', (args) => {
  if (args.length !== 1) return null;
  const [x] = args;
  /** @type {bigint | null} */ let n = null;
  if (x.t === 'int') n = x.v;
  else if (x.t === 'flt' && x.e >= 0) n = x.m * 10n ** BigInt(x.e);
  if (n === null) return null;
  if (n < 0n) return VEC(n === -1n ? [I(-1)] : [I(-1), ...factorsOf(-n).map(I)]);
  return VEC(factorsOf(n).map(I));
});
