// examples/plots.org: the series and data the app takes from each table are the ones Emacs 29.3's org-plot hands to gnuplot
// (tools/gen-plots-example.mjs), and the file says where they differ.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePlotOptions, extractPlotData } from '../src/org-plot.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/plots-example.json', import.meta.url), 'utf8'));
const file = fs.readFileSync(new URL('../examples/plots.org', import.meta.url), 'utf8');

/** The app's reading of a #+PLOT: line and its table: series as [columns, title] and the data rows. @param {string} org */
function ours(org) {
  const lines = org.split('\n');
  const options = parsePlotOptions((lines.find((l) => l.startsWith('#+PLOT:')) || '').slice(7));
  const rows = lines.filter((l) => l.startsWith('|')).map((l) => (/^\|-/.test(l) ? { type: /** @type {const} */ ('rule') } : { type: /** @type {const} */ ('row'), cells: l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) }));
  const d = extractPlotData({ rows }, options.type === 'radar' && !Number.isFinite(options.ind) ? { ...options, ind: 1 } : options);
  const ind = Number.isFinite(options.ind) ? options.ind : null;
  return {
    series: d.series.map((s) => [ind ? `${ind}:${s.index + 1}` : `${s.index + 1}`, s.label]),
    data: d.rows.map((r) => [r.ind, ...r.values.map(String)]),
  };
}

for (const c of oracle.cases) {
  test(`plots.org, "${c.heading}": the app plots what Emacs hands to gnuplot`, () => {
    const got = ours(c.org);
    if (c.radar) {
      // a radar chart's axes are the rows after the swap, with one value per series
      assert.deepEqual(got.data.map((r) => r[0]), c.emacs.data.filter((r) => r[0]).map((r) => r[0]));
      assert.deepEqual(got.data.map((r) => r.slice(1).map(Number)), c.emacs.data.filter((r) => r[0]).map((r) => r.slice(1).map(Number)));
    } else {
      assert.deepEqual(got.series, c.emacs.series);
      c.emacs.data.forEach((/** @type {string[]} */ row, /** @type {number} */ i) => {
        c.emacs.series.forEach((/** @type {string[]} */ [using], /** @type {number} */ j) => {
          const [x, y] = using.split(':').map(Number);
          assert.equal(got.data[i][0], row[x - 1]);
          assert.equal(Number(got.data[i][j + 1]), Number(row[y - 1]));
        });
      });
    }
    assert.ok(file.includes(c.org), 'the file holds the table');
  });
}

test('plots.org: the three cases Emacs and the app once drew differently now agree', () => {
  const byName = Object.fromEntries(oracle.differences.map((/** @type {{ name: string }} */ d) => [d.name, d]));
  for (const name of ['deps', 'ind', 'labels']) assert.deepEqual(ours(byName[name].org).series, byName[name].emacs.series, name);
  // the file lists none of them as a difference any more
  for (const text of ['Without =deps=', 'Without =ind=', '=labels:(']) assert.ok(!file.includes(text), text);
});
