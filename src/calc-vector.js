/**
 * Vectors and matrices for #+TBLFM, following Emacs Calc.
 *
 * A vector is `[1, 2, 3]`; a matrix is a vector of equal-length vectors, `[[1, 2], [3, 4]]`. Elements are the
 * Real / Complex values of calc-complex.js, so each keeps Calc's exact-or-float distinction and `pN` / `F` apply.
 * A cell range is always a flat vector (blank cells left out), as in org.
 */
import {
  isComplex, isReal, toReal, parseScalarText, cAdd, cSub, cMul, cDiv, cNeg, cSqrt, cConj, cEquals, formatComplexValue,
} from './calc-complex.js';

export const isVector = (v) => v !== null && typeof v === 'object' && v.isVector === true;
export const makeVector = (items) => ({ isVector: true, items });
const isMatrix = (v) => isVector(v) && v.items.length > 0 && v.items.every(isVector);

const MAX_DETERMINANT_SIZE = 7;

// ---- cells -----------------------------------------------------------------------------------------------------

/** Splits "a, b, [c, d]" at the commas that are not inside brackets or parentheses. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  parts.push(body.slice(start));
  return parts;
}

/** A cell such as "[1, 2, 3]" or "[[1, 2], [3, 4]]" as a vector, or null if it is not one. */
export function parseVectorCell(text, D, degrees) {
  const t = String(text).trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const body = t.slice(1, -1).trim();
  if (body === '') return makeVector([]);
  const parts = splitTopLevel(body);
  if (!parts) return null;
  const items = [];
  for (const part of parts) {
    const element = part.trim().startsWith('[') ? parseVectorCell(part, D, degrees) : parseScalarText(part, D, degrees);
    if (!element) return null;
    items.push(element);
  }
  return makeVector(items);
}

// ---- helpers ---------------------------------------------------------------------------------------------------

const ZERO = (D) => toReal(0, D);

function sum(list, D, degrees) {
  let total = ZERO(D);
  for (const x of list) total = cAdd(total, x, D, degrees);
  return total;
}

function sameShape(a, b) {
  if (a.items.length !== b.items.length) return false;
  return a.items.every((x, i) => (isVector(x) || isVector(b.items[i]) ? isVector(x) && isVector(b.items[i]) && sameShape(x, b.items[i]) : true));
}

function mapElements(v, f) {
  return makeVector(v.items.map((x) => (isVector(x) ? mapElements(x, f) : f(x))));
}

function zipElements(a, b, f) {
  if (!sameShape(a, b)) throw new Error('Vectors must be the same size');
  return makeVector(a.items.map((x, i) => (isVector(x) ? zipElements(x, b.items[i], f) : f(x, b.items[i]))));
}

function operand(v, D) {
  if (isVector(v) || isComplex(v) || isReal(v)) return v;
  if (typeof v === 'string') throw new Error('A vector operation needs numbers');
  return toReal(v, D);
}

/** Flattens any nesting into a plain list of elements. */
export function flattenVector(v) {
  if (!isVector(v)) return [v];
  return v.items.flatMap(flattenVector);
}

// ---- arithmetic ------------------------------------------------------------------------------------------------

export function vNeg(v, D, degrees) {
  return mapElements(v, (x) => cNeg(x, D, degrees));
}

function matrixProduct(a, b, D, degrees) {
  const rows = a.items.length;
  const inner = a.items[0].items.length;
  if (b.items.length !== inner) throw new Error('Matrix sizes do not match');
  const cols = b.items[0].items.length;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) {
      const terms = [];
      for (let k = 0; k < inner; k++) terms.push(cMul(a.items[i].items[k], b.items[k].items[j], D, degrees));
      row.push(sum(terms, D, degrees));
    }
    out.push(makeVector(row));
  }
  return makeVector(out);
}

export function vBinop(op, left, right, D, degrees) {
  const a = operand(left, D);
  const b = operand(right, D);
  const av = isVector(a);
  const bv = isVector(b);
  if (op === '+' || op === '-') {
    const f = op === '+' ? (x, y) => cAdd(x, y, D, degrees) : (x, y) => cSub(x, y, D, degrees);
    if (av && bv) return zipElements(a, b, f);
    if (av) return mapElements(a, (x) => f(x, b));
    return mapElements(b, (y) => f(a, y));
  }
  if (op === '*') {
    if (!av) return mapElements(b, (y) => cMul(a, y, D, degrees));
    if (!bv) return mapElements(a, (x) => cMul(x, b, D, degrees));
    if (isMatrix(a) && isMatrix(b)) return matrixProduct(a, b, D, degrees);
    if (isMatrix(a)) {
      // matrix times a vector: the vector is a column
      const column = makeVector(b.items.map((x) => makeVector([x])));
      const product = matrixProduct(a, column, D, degrees);
      return makeVector(product.items.map((row) => row.items[0]));
    }
    if (isMatrix(b)) {
      const row = makeVector([a]);
      return matrixProduct(row, b, D, degrees).items[0];
    }
    if (a.items.length !== b.items.length) throw new Error('Vectors must be the same size');
    return sum(a.items.map((x, i) => cMul(x, b.items[i], D, degrees)), D, degrees); // the dot product
  }
  if (op === '/') {
    if (!bv) return mapElements(a, (x) => cDiv(x, b, D, degrees));
    throw new Error('Division by a vector is not supported');
  }
  if (op === '^') {
    if (bv) throw new Error('A vector cannot be an exponent');
    const n = isReal(b) && !b.f && D.isInt(b.x) ? D.toNumber(b.x) : null;
    if (n === null) throw new Error('A matrix power must be an integer');
    if (isMatrix(a)) return matrixPower(a, n, D, degrees);
    if (n === 2) return vBinop('*', a, a, D, degrees); // v^2 is v . v
    throw new Error('Only the square of a vector is defined');
  }
  throw new Error(`Unknown operator "${op}"`);
}

function identity(n, D) {
  return makeVector(Array.from({ length: n }, (_, i) => makeVector(Array.from({ length: n }, (_, j) => toReal(i === j ? 1 : 0, D)))));
}

function matrixPower(m, n, D, degrees) {
  const size = m.items.length;
  if (m.items[0].items.length !== size) throw new Error('A matrix power needs a square matrix');
  if (n === 0) return identity(size, D);
  const base = n < 0 ? vInv(m, D, degrees) : m;
  let result = null;
  for (let i = 0; i < Math.abs(n); i++) result = result === null ? base : matrixProduct(result, base, D, degrees);
  return result;
}

export function vEquals(a, b, D, degrees) {
  if (isVector(a) !== isVector(b)) return false;
  if (!isVector(a)) return cEquals(a, b, D, degrees);
  if (a.items.length !== b.items.length) return false;
  return a.items.every((x, i) => vEquals(x, b.items[i], D, degrees));
}

// ---- functions -------------------------------------------------------------------------------------------------

function requireMatrix(m) {
  if (!isMatrix(m)) throw new Error('This needs a matrix');
  const cols = m.items[0].items.length;
  if (!m.items.every((r) => r.items.length === cols && r.items.every((x) => !isVector(x)))) throw new Error('This needs a rectangular matrix');
  return m;
}
function requireSquare(m) {
  requireMatrix(m);
  if (m.items.length !== m.items[0].items.length) throw new Error('This needs a square matrix');
  return m;
}

function minor(rows, skipRow, skipCol) {
  return rows.filter((_, i) => i !== skipRow).map((r) => r.filter((_, j) => j !== skipCol));
}

function determinant(rows, D, degrees) {
  const n = rows.length;
  if (n === 1) return rows[0][0];
  if (n === 2) return cSub(cMul(rows[0][0], rows[1][1], D, degrees), cMul(rows[0][1], rows[1][0], D, degrees), D, degrees);
  let total = ZERO(D);
  for (let j = 0; j < n; j++) {
    const term = cMul(rows[0][j], determinant(minor(rows, 0, j), D, degrees), D, degrees);
    total = j % 2 === 0 ? cAdd(total, term, D, degrees) : cSub(total, term, D, degrees);
  }
  return total;
}

const toRows = (m) => m.items.map((r) => r.items);

export function vDet(m, D, degrees) {
  requireSquare(m);
  if (m.items.length > MAX_DETERMINANT_SIZE) throw new Error(`Matrices larger than ${MAX_DETERMINANT_SIZE}x${MAX_DETERMINANT_SIZE} are not supported`);
  return determinant(toRows(m), D, degrees);
}

export function vInv(m, D, degrees) {
  requireSquare(m);
  const n = m.items.length;
  if (n > MAX_DETERMINANT_SIZE) throw new Error(`Matrices larger than ${MAX_DETERMINANT_SIZE}x${MAX_DETERMINANT_SIZE} are not supported`);
  const rows = toRows(m);
  const det = determinant(rows, D, degrees);
  if (isReal(det) && D.isZero(det.x)) throw new Error('The matrix is singular');
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      // inverse(i, j) = cofactor(j, i) / det
      const cofactor = n === 1 ? toReal(1, D) : determinant(minor(rows, j, i), D, degrees);
      const signed = (i + j) % 2 === 0 ? cofactor : cNeg(cofactor, D, degrees);
      row.push(cDiv(signed, det, D, degrees));
    }
    out.push(makeVector(row));
  }
  return makeVector(out);
}

export function vTrn(m) {
  if (isMatrix(m)) {
    requireMatrix(m);
    const cols = m.items[0].items.length;
    return makeVector(Array.from({ length: cols }, (_, j) => makeVector(m.items.map((r) => r.items[j]))));
  }
  if (isVector(m)) return makeVector(m.items.map((x) => makeVector([x])));
  throw new Error('This needs a vector or matrix');
}

export function vTrace(m, D, degrees) {
  requireSquare(m);
  return sum(m.items.map((r, i) => r.items[i]), D, degrees);
}

export function vCross(a, b, D, degrees) {
  if (!isVector(a) || !isVector(b) || a.items.length !== 3 || b.items.length !== 3 || isMatrix(a) || isMatrix(b)) {
    throw new Error('cross needs two 3-element vectors');
  }
  const [a1, a2, a3] = a.items;
  const [b1, b2, b3] = b.items;
  const term = (x, y, z, w) => cSub(cMul(x, y, D, degrees), cMul(z, w, D, degrees), D, degrees);
  return makeVector([term(a2, b3, a3, b2), term(a3, b1, a1, b3), term(a1, b2, a2, b1)]);
}

export function vLength(v) {
  if (!isVector(v)) throw new Error('vlen needs a vector');
  return v.items.length;
}

/** abs of a vector: its length. */
export function vAbs(v, D, degrees) {
  const squares = flattenVector(v).map((x) => cMul(x, cConj(x, D, degrees), D, degrees));
  return cSqrt(sum(squares, D, degrees), D, degrees);
}

// ---- display ---------------------------------------------------------------------------------------------------

export function formatCalcValue(v, D, fmt) {
  if (isVector(v)) return `[${v.items.map((x) => formatCalcValue(x, D, fmt)).join(', ')}]`;
  return formatComplexValue(v, D, fmt);
}
