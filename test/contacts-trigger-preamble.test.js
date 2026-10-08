import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';

const BODY = `* Anniversaries
** Simmule & Jennifer
:PROPERTIES:
:ANNIV: 1989-11-02
:END:
`;
const run = (text) =>
  buildAgendaItems([{ documentId: 'a', doc: parseOrg(text) }], {
    rangeStart: new Date(2026, 10, 1), rangeEnd: new Date(2026, 10, 30), today: new Date(2026, 9, 8),
  }).filter((i) => i.kind === 'anniversary');

test('a contacts trigger above the first heading activates the scan', () => {
  const items = run(`%%(org-contacts-anniversaries "ANNIV")\n\n${BODY}`);
  assert.equal(items.length, 1);
  assert.equal(items[0].date.getDate(), 2);
});

test('no trigger anywhere: nothing shows', () => {
  assert.equal(run(BODY).length, 0);
});
