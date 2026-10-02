// Dev tool: checks that every .org file in a directory comes back byte for byte after being parsed and
// serialized with no edit (the app's round-trip requirement), and reports the first line that differs.
//   node tools/roundtrip-corpus.mjs DIR
import fs from 'node:fs';
import path from 'node:path';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/roundtrip-corpus.mjs DIR');
  process.exit(2);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.org')).sort();
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  let out;
  try {
    out = serializeOrg(parseOrg(text));
  } catch (err) {
    bad++;
    console.log(`THREW  ${f}: ${err.message}`);
    continue;
  }
  if (out === text) continue;
  bad++;
  const a = text.split('\n');
  const b = out.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log(`DIFFERS ${f} at line ${i + 1}:\n  was: ${JSON.stringify(a[i])}\n  now: ${JSON.stringify(b[i])}`);
}
console.log(`${files.length - bad} of ${files.length} files round-trip unchanged`);
process.exit(bad ? 1 : 0);
