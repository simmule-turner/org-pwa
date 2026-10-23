// Rewrites test/fixtures/odt/*.xml from the current exporter. Review the diff: apart from the deviations the
// README lists, the .xml files were checked line by line against Emacs 29.3's org-odt-export-to-odt.
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, FIXTURE_NAMES, normalizedFixture } from '../test/support/odt-normalize.mjs';

for (const name of FIXTURE_NAMES) fs.writeFileSync(path.join(FIXTURES, name + '.xml'), normalizedFixture(name));
console.log(`wrote ${FIXTURE_NAMES.length} fixtures`);
