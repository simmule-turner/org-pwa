#!/bin/sh
# Regenerates src/vendor/mathjs/mathjs-custom.min.js -- a tree-shaken
# custom mathjs build containing ONLY BigNumber, Fraction, Unit, and
# the core arithmetic operations this app's own table-formula engine
# needs (see src/table-formula.js's own uconv() and, eventually, its
# F-mode/precision-mode handling). NOT the full mathjs library (which
# includes matrices, complex numbers, statistics, and its own
# expression parser, none of which this app uses).
#
# This is a dev-only, occasional script -- run by hand when mathjs
# needs updating, not part of running or deploying the app itself.
# Nothing in package.json depends on mathjs or esbuild; both are
# installed into a throwaway scratch directory here, matching this
# app's own "zero dependencies" identity for the actual shipped code.
#
# Usage: sh tools/build-mathjs-vendor.sh
#
# Measured sizes for this exact dependency set (mathjs 15.2.0):
#   raw minified: ~248 KB   gzipped: ~72 KB
# (for comparison, this app's own vendored KaTeX is ~266 KB raw / ~74 KB gzipped)

set -e

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/vendor/mathjs"

SCRATCH=$(mktemp -d)
echo "Building in scratch directory: $SCRATCH"

cd "$SCRATCH"
npm init -y --silent > /dev/null
npm install --silent mathjs esbuild

cat > entry.js << 'ENTRY_EOF'
import {
  create,
  bignumberDependencies,
  fractionDependencies,
  unitDependencies,
  createUnitDependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  sqrtDependencies,
  absDependencies,
  unaryMinusDependencies,
  compareDependencies,
  equalDependencies,
  largerDependencies,
  smallerDependencies,
} from 'mathjs';

const {
  bignumber, fraction, unit, createUnit,
  add, subtract, multiply, divide, pow, sqrt, abs, unaryMinus,
  compare, equal, larger, smaller,
} = create({
  bignumberDependencies,
  fractionDependencies,
  unitDependencies,
  createUnitDependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  sqrtDependencies,
  absDependencies,
  unaryMinusDependencies,
  compareDependencies,
  equalDependencies,
  largerDependencies,
  smallerDependencies,
});

export {
  bignumber, fraction, unit, createUnit,
  add, subtract, multiply, divide, pow, sqrt, abs, unaryMinus,
  compare, equal, larger, smaller,
};
ENTRY_EOF

npx esbuild entry.js --bundle --minify --format=esm --outfile=mathjs-custom.min.js

mkdir -p "$OUT_DIR"
cp mathjs-custom.min.js "$OUT_DIR/mathjs-custom.min.js"

RAW_SIZE=$(wc -c < "$OUT_DIR/mathjs-custom.min.js")
GZIP_SIZE=$(gzip -9 -c "$OUT_DIR/mathjs-custom.min.js" | wc -c)
echo "Wrote $OUT_DIR/mathjs-custom.min.js"
echo "  raw: $RAW_SIZE bytes | gzip: $GZIP_SIZE bytes"

rm -rf "$SCRATCH"
