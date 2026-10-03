#!/bin/sh
# Regenerates src/vendor/mathjs/mathjs-custom.min.js -- a tree-shaken
# custom mathjs build containing Unit, BigNumber, Fraction, and the
# arithmetic/transcendental functions this app's own table-formula
# engine needs (uconv, and F-mode/precision-mode support), plus
# create() and the dependency collections themselves -- NOT
# pre-constructed functions from one fixed instance, since real
# Calc's own pN precision mode needs a fresh, differently-configured
# instance per formula (BigNumber precision is instance-level config
# in mathjs, not a per-value option). NOT the full mathjs library
# either (matrices, complex numbers, statistics, its own expression
# parser -- none of which this app uses).
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
#   raw minified: ~251 KB   gzipped: ~73 KB
# (for comparison, this app's own vendored KaTeX is ~266 KB raw / ~74 KB gzipped)

set -e

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/vendor/mathjs"

SCRATCH=$(mktemp -d)
echo "Building in scratch directory: $SCRATCH"

cd "$SCRATCH"
npm init -y --silent > /dev/null
npm install --silent mathjs esbuild

cat > entry.js << 'ENTRY_EOF'
export {
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
  logDependencies,
  log10Dependencies,
  expDependencies,
  sinDependencies,
  cosDependencies,
  tanDependencies,
  asinDependencies,
  acosDependencies,
  atanDependencies,
  roundDependencies,
  floorDependencies,
  ceilDependencies,
  fixDependencies,
} from 'mathjs';
ENTRY_EOF

npx esbuild entry.js --bundle --minify --format=esm --outfile=mathjs-custom.min.js

mkdir -p "$OUT_DIR"
cp mathjs-custom.min.js "$OUT_DIR/mathjs-custom.min.js"

RAW_SIZE=$(wc -c < "$OUT_DIR/mathjs-custom.min.js")
GZIP_SIZE=$(gzip -9 -c "$OUT_DIR/mathjs-custom.min.js" | wc -c)
echo "Wrote $OUT_DIR/mathjs-custom.min.js"
echo "  raw: $RAW_SIZE bytes | gzip: $GZIP_SIZE bytes"

rm -rf "$SCRATCH"
