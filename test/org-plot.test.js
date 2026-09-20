import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlotOptions, extractPlotData, renderPlotSvg } from '../src/org-plot.js';

function mkTable(rowsData) {
  return { rows: rowsData.map((r) => (r === null ? { type: 'rule' } : { type: 'row', cells: r })) };
}

// ---- parsePlotOptions -- verified against real org-plot.el's own actual
// source and the manual's own documented examples, not derived from the
// docstring or prose alone ---------------------------------------------

test('THE FEATURE (the exact real-world example from the manual): the documented histogram #+PLOT: line parses exactly as real org-plot itself would', () => {
  const options = parsePlotOptions('title:"Citas" ind:1 deps:(3) type:2d with:histograms set:"yrange [0:]"');
  assert.deepEqual(options, {
    title: 'Citas',
    ind: 1,
    deps: [3],
    type: '2d',
    with: 'histograms',
    set: ['yrange [0:]'],
  });
});

test('THE FEATURE (the exact real-world example from the manual): the documented radar #+PLOT: line parses correctly', () => {
  const options = parsePlotOptions('title:"An evaluation of plaintext document formats" transpose:yes type:radar min:0 max:4');
  assert.deepEqual(options, {
    title: 'An evaluation of plaintext document formats',
    transpose: 'yes',
    type: 'radar',
    min: 0,
    max: 4,
  });
});

test('a parenthesized list of quoted strings (labels) parses into a real array of strings, matching real elisp\u2019s own (read-from-string ...) for the same value', () => {
  const options = parsePlotOptions('labels:("first new label" "second column" "last column")');
  assert.deepEqual(options.labels, ['first new label', 'second column', 'last column']);
});

test('a bare numeric value reads as a real number, matching real elisp\u2019s own reader', () => {
  assert.equal(parsePlotOptions('ind:2').ind, 2);
  assert.equal(typeof parsePlotOptions('ind:2').ind, 'number');
});

test('a bare non-numeric value reads as a string', () => {
  assert.equal(parsePlotOptions('type:radar').type, 'radar');
});

test('set and line are real org-plot\u2019s only two options that can legitimately repeat -- confirmed directly from the real source -- and accumulate into an array; every other option only ever keeps its first match', () => {
  const options = parsePlotOptions('set:"xrange [0:10]" set:"yrange [0:]" title:"first" title:"second"');
  assert.deepEqual(options.set, ['xrange [0:10]', 'yrange [0:]']);
  assert.equal(options.title, 'first');
});

test('THE FIX (a deliberate deviation from real org-plot\u2019s own actual behavior, noted directly): a bare decimal value like min:0.5 is NOT silently truncated at the decimal point the way real Emacs\u2019s own actual regex would -- allowing "." in a bare value here instead, since reproducing that quirk would be a confusing, silent data-loss trap', () => {
  assert.equal(parsePlotOptions('min:0.5').min, 0.5);
});

test('an unrecognized key elsewhere in the line is silently ignored, matching real org-plot\u2019s own behavior of only ever looking for its own known option names', () => {
  const options = parsePlotOptions('title:"x" nonsense:"y" ind:1');
  assert.deepEqual(options, { title: 'x', ind: 1 });
});

// ---- extractPlotData -------------------------------------------------

test('THE FEATURE: extractPlotData reads the manual\u2019s own documented histogram table correctly -- ind:1 (Sede) supplies the x-axis, deps:(3) selects only the H-index column', () => {
  const table = mkTable([
    ['Sede', 'Max cites', 'H-index'],
    null,
    ['Chile', '257.72', '21.39'],
    ['Leeds', '165.77', '19.68'],
  ]);
  const data = extractPlotData(table, { ind: 1, deps: [3] });
  assert.equal(data.indLabel, 'Sede');
  assert.deepEqual(data.series, [{ index: 2, label: 'H-index' }]);
  assert.deepEqual(data.rows, [
    { ind: 'Chile', values: [21.39] },
    { ind: 'Leeds', values: [19.68] },
  ]);
});

test('ind and deps both default correctly when omitted: ind defaults to column 1, deps defaults to every other column', () => {
  const table = mkTable([
    ['Sede', 'Max cites', 'H-index'],
    null,
    ['Chile', '257.72', '21.39'],
  ]);
  const data = extractPlotData(table, {});
  assert.equal(data.indLabel, 'Sede');
  assert.deepEqual(data.series.map((s) => s.label), ['Max cites', 'H-index']);
});

test('labels overrides the default column-header labels, matching real org-plot\u2019s own documented behavior exactly ("Defaults to the column headers if they exist")', () => {
  const table = mkTable([
    ['x', 'a', 'b'],
    null,
    ['1', '10', '20'],
  ]);
  const data = extractPlotData(table, { labels: ['Alpha', 'Beta'] });
  assert.deepEqual(data.series.map((s) => s.label), ['Alpha', 'Beta']);
});

test('THE FEATURE (the exact real-world radar example from the manual, re-read closely): transpose swaps rows and columns before ind/deps are computed, turning criteria into axes and formats into series', () => {
  const table = mkTable([
    ['Format', 'Fine-grained-control', 'Initial Effort'],
    null,
    ['Word', '2', '4'],
    ['LaTeX', '4', '1'],
  ]);
  const data = extractPlotData(table, { transpose: 'yes' });
  assert.equal(data.indLabel, 'Format');
  assert.deepEqual(
    data.rows.map((r) => r.ind),
    ['Fine-grained-control', 'Initial Effort']
  );
  assert.deepEqual(
    data.series.map((s) => s.label),
    ['Word', 'LaTeX']
  );
});

test('a non-numeric or missing cell in a deps column becomes null in its own values slot rather than throwing -- one bad cell doesn\u2019t abort plotting the rest of an otherwise-good table', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', 'not a number'],
    ['b', '5'],
  ]);
  const data = extractPlotData(table, {});
  assert.deepEqual(
    data.rows.map((r) => r.values[0]),
    [null, 5]
  );
});

test('an out-of-range ind column throws a clear error rather than silently misreading the table', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  assert.throws(() => extractPlotData(table, { ind: 5 }), /out of range/);
});

test('a table with a header row but no real data rows below it throws a clear error rather than producing a nonsense empty plot', () => {
  const table = mkTable([['x', 'y'], null]);
  assert.throws(() => extractPlotData(table, {}), /[Nn]ot enough data/);
});

test('THE FIX (the exact reported bug): a table with no real header at all (no hline anywhere) treats every row as real, plottable data -- the first row is no longer silently swallowed as a fake header', () => {
  const table = mkTable([
    ['1', '5.2'],
    ['2', '6.8'],
    ['3', '6.1'],
  ]);
  const data = extractPlotData(table, { ind: 1 });
  assert.deepEqual(
    data.rows.map((r) => r.ind),
    ['1', '2', '3']
  );
  assert.equal(data.indLabel, ''); // no header at all -- nothing supplies this
  assert.equal(data.series[0].label, 'Column 2'); // falls back to a positional label, same fallback an unnamed column already gets when labels: is unspecified
});

test('a single data row with no header at all is valid on its own -- previously impossible to express correctly, since it was always misread as "just a header, no data" before this fix', () => {
  const table = mkTable([['a', '1']]);
  const data = extractPlotData(table, {});
  assert.deepEqual(data.rows, [{ ind: 'a', values: [1] }]);
});

// ---- renderPlotSvg -----------------------------------------------------

test('renderPlotSvg produces well-formed, self-contained SVG for a 2D plot, with an explicit width/height (not just viewBox) so it renders consistently regardless of its own host context', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
    ['b', '2'],
  ]);
  const svg = renderPlotSvg(table, {});
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  assert.match(svg, /width="\d+"/);
  assert.match(svg, /height="\d+"/);
});

test('type:2d is real org-plot\u2019s own documented default when type is omitted entirely', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  const svg = renderPlotSvg(table, {});
  assert.ok(svg.includes('<rect') || svg.includes('<polyline') || svg.includes('<circle'));
});

test('type:radar renders a genuinely different shape from type:2d for the same data -- a polygon per series, not a Cartesian axis pair', () => {
  const table = mkTable([
    ['x', 'a', 'b'],
    null,
    ['row1', '1', '2'],
    ['row2', '3', '4'],
  ]);
  const svg = renderPlotSvg(table, { type: 'radar' });
  assert.match(svg, /<polygon/);
});

test('THE FEATURE: type:3d and type:grid are explicitly refused with a clear, direct error, per this app\u2019s own considered scope decision -- real org-plot\u2019s own manual hedges on these too, and true 3D projection is a fundamentally different scope this app deliberately doesn\u2019t take on', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  assert.throws(() => renderPlotSvg(table, { type: '3d' }), /doesn't support type:3d/);
  assert.throws(() => renderPlotSvg(table, { type: 'grid' }), /doesn't support type:grid/);
});

test('an unrecognized plot type also produces a clear error rather than a silent, wrong fallback', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  assert.throws(() => renderPlotSvg(table, { type: 'nonsense' }), /doesn't support type:nonsense/);
});

test('title, when present, renders as real visible text in the SVG', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  const svg = renderPlotSvg(table, { title: 'My Plot Title' });
  assert.match(svg, /My Plot Title/);
});

test('a title or label containing XML-special characters is safely escaped, not injected raw into the SVG markup', () => {
  const table = mkTable([
    ['x', 'y'],
    null,
    ['a', '1'],
  ]);
  const svg = renderPlotSvg(table, { title: 'A & B <script>' });
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /A &amp; B &lt;script&gt;/);
});
