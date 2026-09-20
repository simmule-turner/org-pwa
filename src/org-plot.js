/** Real org-mode's own Org Plot feature (org-plot.el): draws 2D and
 *  radar graphs of information stored in an org table, driven by a
 *  #+PLOT: line directly above it. Real org-plot shells out to an
 *  external, native gnuplot process for its own graphical output --
 *  something no browser sandbox can do at all, so this module
 *  necessarily supports a considered subset: it parses the exact same
 *  #+PLOT: option syntax real org-mode does (so a real file, copied
 *  in unmodified, is read correctly), but renders with inline SVG
 *  instead of shelling out to gnuplot. Deliberately excludes the `3d`
 *  and `grid` plot types (real org's own manual hedges on these too --
 *  "will probably require some more knowledge of gnuplot to make full
 *  use of" -- true 3D projection is a fundamentally different scope
 *  for a feature real users reach for far less than 2D/radar) and
 *  treats gnuplot's own raw-script escape hatches (`set`, `line`,
 *  `script`, `file`, `map`, `timefmt`) as recognized-but-inert: parsed
 *  so a real #+PLOT: line never errors out, but with no rendering
 *  effect, since supporting them meaningfully would mean implementing
 *  enough of gnuplot's own scripting language to be real scope creep
 *  rather than "a reasonable subset."
 *
 *  ---- #+PLOT: option syntax --------------------------------------
 *
 *  parsePlotOptions below mirrors org-plot/add-options-to-plist's own
 *  actual regex exactly (confirmed directly against real org-plot.el
 *  source, not the manual's prose alone):
 *
 *    ":\([\"][^\"]+?[\"]\|[(][^)]+?[)]\|[^ \t\n\r;,.]*\)"
 *
 *  i.e. after "key:", a value is one of: a double-quoted string, a
 *  flat (non-nested) parenthesized list, or a bare, space-free word --
 *  read the same way real elisp's own (read-from-string ...) would:
 *  a quoted value becomes a string, a parenthesized value becomes a
 *  list (each item read the same way, recursively), a bare numeric
 *  value becomes a number, anything else stays a bare string. `set`
 *  and `line` are real org-plot's only two options that can
 *  legitimately repeat (confirmed directly from the same source --
 *  every other option only ever keeps its first match), accumulated
 *  into an array here for the same reason, even though this module
 *  never uses either value for anything.
 *
 *  ONE DELIBERATE DEVIATION FROM THE REAL REGEX, noted here plainly:
 *  real org's own bare-value character class excludes ".", meaning an
 *  unquoted `min:0.5` in real Emacs actually reads as just `0`,
 *  silently truncated at the decimal point. That reads as an
 *  accidental side effect of the real regex (most plausibly there to
 *  avoid swallowing a trailing sentence period in prose sitting near
 *  the options line) rather than a meaningful, deliberate design
 *  choice, and would be a confusing, silent data-loss trap for anyone
 *  typing a real decimal value here. This module allows "." in a bare
 *  value instead -- the one place this parser is intentionally more
 *  correct than real org-plot's own actual behavior, rather than
 *  bug-for-bug faithful to it.
 */

const OPTION_KEYS = [
  'title',
  'ind',
  'timeind',
  'deps',
  'transpose',
  'trans',
  'type',
  'with',
  'file',
  'labels',
  'line',
  'map',
  'min',
  'max',
  'xmin',
  'xmax',
  'ymin',
  'ymax',
  'ticks',
  'timefmt',
  'script',
  'set',
];

const MULTI_VALUE_KEYS = new Set(['set', 'line']);

/** Mirrors real elisp's own (read-from-string ...) for exactly the
 *  three value shapes parsePlotOptions's own regex can ever capture. */
function readPlotValue(text) {
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  if (text.startsWith('(') && text.endsWith(')')) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    const items = [];
    const re = /"(?:[^"\\]|\\.)*"|\S+/g;
    let m;
    while ((m = re.exec(inner))) items.push(readPlotValue(m[0]));
    return items;
  }
  const num = Number(text);
  return text !== '' && !Number.isNaN(num) ? num : text;
}

/** Parses a #+PLOT: line's own already-unioned text (see
 *  body-parser.js's own PLOT_RE handling -- multiple #+PLOT: lines
 *  directly above the same table are already joined into one string
 *  by the time this runs, the same way multiple #+CONSTANTS: lines
 *  are already unioned elsewhere in this app) into a plain options
 *  object. Unrecognized keys are silently ignored, matching real
 *  org-plot's own behavior of only ever looking for its own known
 *  option names and leaving anything else in the line untouched. */
export function parsePlotOptions(text) {
  const options = {};
  for (const key of OPTION_KEYS) {
    const pattern = `${key}:("[^"]+?"|\\([^)]+?\\)|[^ \\t\\n\\r;,]*)`;
    if (MULTI_VALUE_KEYS.has(key)) {
      const re = new RegExp(pattern, 'g');
      const all = [];
      let m;
      while ((m = re.exec(text))) all.push(readPlotValue(m[1]));
      if (all.length) options[key] = all;
    } else {
      const m = new RegExp(pattern).exec(text);
      if (m) options[key] = readPlotValue(m[1]);
    }
  }
  return options;
}

/** Extracts plottable data from `table` and `options`, in real
 *  org-plot's own documented shape -- shared by both 2D and radar
 *  rendering below, since a radar chart's own data (confirmed by
 *  re-reading the manual's own radar example closely) is the exact
 *  same "one ind/label column, N deps/value columns" model a 2D plot
 *  already uses, after any `transpose` is applied; it's the same
 *  extraction, rendered differently, not a separate data shape.
 *
 *  `ind` (1-based column, default 1) supplies the independent-axis
 *  value for each data row -- an x-position for 2D, an axis label for
 *  radar. `deps` (1-based columns, default: every column except
 *  `ind`) supplies one series per column. `labels` (default: the
 *  table's own header row, matching real org-plot's own documented
 *  default exactly) names each series. `transpose` swaps rows and
 *  columns before any of the above is computed, exactly as real
 *  org-plot does.
 *
 *  Returns { indLabel, rows: [{ ind, values: [n1, n2, ...] }, ...],
 *  series: [{ label, index }, ...] } -- `rows` are only the real data
 *  rows (the header row and any rule lines already excluded); a
 *  non-numeric value in a deps column becomes `null` in its own
 *  `values` slot rather than throwing, so one bad cell doesn't abort
 *  plotting the rest of a real, otherwise-good table. Throws only
 *  when there's genuinely nothing plottable at all (fewer than 2
 *  columns, or no real data rows). */
export function extractPlotData(table, options) {
  const rawRows = table.rows || [];
  // A header exists only when the table has a real hline SOMEWHERE --
  // matching this app's own established convention exactly (see
  // body-edit.js's own isTableHeaderRow and the matching logic in
  // table-formula.js): with no hline at all, nothing is a header and
  // every row is real, plottable data. Checked here, before rule rows
  // get filtered out below, since that's the only point this
  // information is still available at all.
  const hasHeader = rawRows.some((r) => r.type === 'rule');

  let rows = rawRows.filter((r) => r.type === 'row').map((r) => r.cells);
  if (options.transpose === 'yes' || options.transpose === 'y' || options.transpose === 't' || options.trans === 'yes' || options.trans === 'y' || options.trans === 't') {
    const colCount = Math.max(0, ...rows.map((r) => r.length));
    rows = Array.from({ length: colCount }, (_, c) => rows.map((r) => r[c] ?? ''));
  }
  const minRows = hasHeader ? 2 : 1;
  if (rows.length < minRows || (rows[0] || []).length < 2) {
    throw new Error('Not enough data to plot -- need at least one data row (plus a header row, if the table has one) with at least two columns.');
  }
  const header = hasHeader ? rows[0] : null;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const colCount = (header || rows[0]).length;

  const indCol = Number.isFinite(options.ind) ? options.ind : 1;
  const indIdx = indCol - 1;
  if (indIdx < 0 || indIdx >= colCount) throw new Error(`ind:${indCol} is out of range for a table with ${colCount} columns.`);

  const depsOption = Array.isArray(options.deps) ? options.deps : options.deps !== undefined ? [options.deps] : null;
  const depIdxs = depsOption ? depsOption.map((n) => Number(n) - 1) : Array.from({ length: colCount }, (_, i) => i).filter((i) => i !== indIdx);
  for (const idx of depIdxs) {
    if (idx < 0 || idx >= colCount) throw new Error(`deps column ${idx + 1} is out of range for a table with ${colCount} columns.`);
  }

  const labelsOption = Array.isArray(options.labels) ? options.labels : null;
  const series = depIdxs.map((idx, i) => ({
    index: idx,
    label: labelsOption && labelsOption[i] !== undefined ? String(labelsOption[i]) : header ? String(header[idx] ?? `Column ${idx + 1}`) : `Column ${idx + 1}`,
  }));

  const plotRows = dataRows.map((cells) => ({
    ind: cells[indIdx],
    values: depIdxs.map((idx) => {
      const n = Number(cells[idx]);
      return cells[idx] !== undefined && cells[idx] !== '' && !Number.isNaN(n) ? n : null;
    }),
  }));

  return { indLabel: header ? String(header[indIdx] ?? '') : '', rows: plotRows, series };
}

const SERIES_COLORS = ['#4C78A8', '#F58518', '#54A24B', '#E45756', '#72B7B2', '#EECA3B', '#B279A2', '#FF9DA6', '#9D755D', '#BAB0AC'];

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Renders a 2D plot (`type:2d`, real org-plot's own default) as a
 *  self-contained SVG string. `with:` selects the visual style --
 *  `lines` (real org-plot's own default), `points`, `boxes` (also
 *  used for `histograms`, treated as a plain alias here rather than a
 *  separately-implemented style, since both render as bars for this
 *  module's own purposes), or `impulses`. The x-axis positions each
 *  data row evenly by index when its own `ind` values aren't all
 *  numeric (matching real-world usage -- both of org-plot's own
 *  documented 2D examples use non-numeric location names as `ind`),
 *  or scales proportionally to the real numeric values when they are.
 *  `min`/`max`/`ymin`/`ymax` (`min`/`max` implicitly refer to the y
 *  axis, matching real org-plot's own documented behavior exactly)
 *  override the data's own natural range; `xmin`/`xmax` likewise for
 *  a numeric x-axis. `ticks` requests a specific number of y-axis
 *  gridlines/labels, default 5. A null value (a non-numeric or
 *  missing cell, see extractPlotData) is simply skipped within its
 *  own series -- a broken line/missing bar at that one position,
 *  never a thrown error over one bad cell in an otherwise-good
 *  table. */
function render2dSvg(data, options) {
  const width = 480;
  const height = 320;
  const hasLegend = data.series.length > 1;
  const margin = { top: (options.title ? 30 : 10) + (hasLegend ? 20 : 0), right: 16, bottom: 56, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const withStyle = options.with === 'histograms' ? 'boxes' : options.with || 'lines';
  const allValues = data.rows.flatMap((r) => r.values).filter((v) => v !== null);
  const dataMin = allValues.length ? Math.min(0, ...allValues) : 0;
  const dataMax = allValues.length ? Math.max(...allValues) : 1;
  const yMin = Number.isFinite(options.ymin) ? options.ymin : Number.isFinite(options.min) ? options.min : dataMin;
  const yMax = Number.isFinite(options.ymax) ? options.ymax : Number.isFinite(options.max) ? options.max : dataMax;
  const yRange = yMax - yMin || 1;
  const yToPx = (v) => margin.top + plotH - ((v - yMin) / yRange) * plotH;

  const indNumeric = data.rows.length > 0 && data.rows.every((r) => r.ind !== '' && !Number.isNaN(Number(r.ind)));
  const xMinData = indNumeric ? Math.min(...data.rows.map((r) => Number(r.ind))) : 0;
  const xMaxData = indNumeric ? Math.max(...data.rows.map((r) => Number(r.ind))) : Math.max(1, data.rows.length - 1);
  const xMin = Number.isFinite(options.xmin) ? options.xmin : xMinData;
  const xMax = Number.isFinite(options.xmax) ? options.xmax : xMaxData;
  const xRange = xMax - xMin || 1;
  const xToPx = (row, i) => margin.left + (indNumeric ? ((Number(row.ind) - xMin) / xRange) * plotW : (i + 0.5) * (plotW / data.rows.length));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="11">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="none"/>`);
  if (options.title) parts.push(`<text x="${width / 2}" y="18" text-anchor="middle" font-size="13" font-weight="600">${escapeXml(options.title)}</text>`);

  // y-axis gridlines and labels
  const tickCount = Number.isFinite(options.ticks) ? options.ticks : 5;
  for (let t = 0; t <= tickCount; t++) {
    const v = yMin + (yRange * t) / tickCount;
    const py = yToPx(v);
    parts.push(`<line x1="${margin.left}" y1="${py}" x2="${width - margin.right}" y2="${py}" stroke="#ddd" stroke-width="1"/>`);
    parts.push(`<text x="${margin.left - 6}" y="${py + 3}" text-anchor="end" fill="#666">${formatPlotNumber(v)}</text>`);
  }
  parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#888"/>`);
  parts.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="#888"/>`);

  // x-axis labels (one per data row)
  data.rows.forEach((row, i) => {
    const px = xToPx(row, i);
    parts.push(`<text x="${px}" y="${margin.top + plotH + 16}" text-anchor="middle" fill="#666">${escapeXml(row.ind)}</text>`);
  });
  if (data.indLabel) parts.push(`<text x="${margin.left + plotW / 2}" y="${height - 6}" text-anchor="middle" fill="#666">${escapeXml(data.indLabel)}</text>`);

  const seriesCount = data.series.length;
  const groupW = data.rows.length > 1 ? plotW / data.rows.length : plotW;
  const barW = Math.max(2, (groupW * 0.7) / Math.max(1, seriesCount));

  data.series.forEach((series, sIdx) => {
    const color = SERIES_COLORS[sIdx % SERIES_COLORS.length];
    const points = data.rows.map((row, i) => ({ x: xToPx(row, i), y: row.values[sIdx] === null ? null : yToPx(row.values[sIdx]), v: row.values[sIdx] }));

    if (withStyle === 'lines') {
      const segments = [];
      let current = [];
      for (const p of points) {
        if (p.y === null) {
          if (current.length > 1) segments.push(current);
          current = [];
        } else {
          current.push(p);
        }
      }
      if (current.length > 1) segments.push(current);
      for (const seg of segments) {
        parts.push(`<polyline points="${seg.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`);
      }
      for (const p of points) if (p.y !== null) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}"/>`);
    } else if (withStyle === 'points') {
      for (const p of points) if (p.y !== null) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}"/>`);
    } else if (withStyle === 'boxes') {
      const groupStart = margin.left + sIdx * barW - (seriesCount * barW) / 2;
      points.forEach((p, i) => {
        if (p.y === null) return;
        const x = xToPx(data.rows[i], i) - (seriesCount * barW) / 2 + sIdx * barW;
        const y0 = yToPx(0);
        const barTop = Math.min(y0, p.y);
        const barH = Math.abs(y0 - p.y);
        parts.push(`<rect x="${x}" y="${barTop}" width="${barW - 1}" height="${barH}" fill="${color}"/>`);
      });
    } else if (withStyle === 'impulses') {
      const y0 = yToPx(0);
      for (const p of points) if (p.y !== null) parts.push(`<line x1="${p.x}" y1="${y0}" x2="${p.x}" y2="${p.y}" stroke="${color}" stroke-width="2"/>`);
    }
  });

  // legend -- a horizontal row in its own reserved margin space (see
  // margin.top above), not floating inside the plot area itself,
  // since that risked overlapping the first data point.
  if (hasLegend) {
    const legendY = options.title ? 30 : 10;
    const entryWidths = data.series.map((s) => 16 + s.label.length * 6.5 + 14);
    const totalWidth = entryWidths.reduce((a, b) => a + b, 0);
    let x = margin.left + plotW / 2 - totalWidth / 2;
    data.series.forEach((series, i) => {
      parts.push(`<rect x="${x}" y="${legendY}" width="10" height="10" fill="${SERIES_COLORS[i % SERIES_COLORS.length]}"/>`);
      parts.push(`<text x="${x + 14}" y="${legendY + 9}" fill="#333">${escapeXml(series.label)}</text>`);
      x += entryWidths[i];
    });
  }

  parts.push('</svg>');
  return parts.join('');
}

function formatPlotNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/** Renders a radar plot (`type:radar`, a real org-plot type alongside
 *  `2d`/`3d`/`grid` -- see the manual's own documented example, which
 *  this module's own extractPlotData reads identically to a 2D plot,
 *  the same underlying data shape rendered differently) as a
 *  self-contained SVG string. Each row of `data` becomes one spoke
 *  (an axis radiating from the center, evenly spaced around the
 *  circle, labeled with its own `ind` value); each series becomes one
 *  closed polygon connecting its own value on every spoke. All spokes
 *  share one scale (`min`/`max`, default the data's own overall
 *  range), matching the manual's own radar example, which sets a
 *  single min/max applying to every axis at once rather than a
 *  separate range per axis. */
function renderRadarSvg(data, options) {
  const width = 520;
  const height = 420;
  const cx = width / 2;
  const cy = height / 2 + (options.title ? 8 : 0);
  const radius = Math.min(width, height) / 2 - 90;

  const allValues = data.rows.flatMap((r) => r.values).filter((v) => v !== null);
  const dataMin = allValues.length ? Math.min(0, ...allValues) : 0;
  const dataMax = allValues.length ? Math.max(...allValues) : 1;
  const min = Number.isFinite(options.min) ? options.min : dataMin;
  const max = Number.isFinite(options.max) ? options.max : dataMax;
  const range = max - min || 1;

  const n = data.rows.length;
  const angleFor = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pointFor = (i, value) => {
    const r = Math.max(0, ((value - min) / range) * radius);
    const a = angleFor(i);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="11">`);
  if (options.title) parts.push(`<text x="${width / 2}" y="18" text-anchor="middle" font-size="13" font-weight="600">${escapeXml(options.title)}</text>`);

  // concentric reference rings (4 of them, unlabeled -- a visual scale cue, not precise ticks)
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius * ring) / 4;
    const ringPoints = Array.from({ length: n }, (_, i) => {
      const a = angleFor(i);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    });
    parts.push(`<polygon points="${ringPoints.join(' ')}" fill="none" stroke="#ddd" stroke-width="1"/>`);
  }

  // spokes and axis labels
  data.rows.forEach((row, i) => {
    const a = angleFor(i);
    const outerX = cx + radius * Math.cos(a);
    const outerY = cy + radius * Math.sin(a);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${outerX}" y2="${outerY}" stroke="#bbb" stroke-width="1"/>`);
    const labelX = cx + (radius + 14) * Math.cos(a);
    const labelY = cy + (radius + 14) * Math.sin(a);
    const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
    parts.push(`<text x="${labelX}" y="${labelY + 3}" text-anchor="${anchor}" fill="#555">${escapeXml(row.ind)}</text>`);
  });

  // one polygon per series
  data.series.forEach((series, sIdx) => {
    const color = SERIES_COLORS[sIdx % SERIES_COLORS.length];
    const pts = data.rows.map((row, i) => (row.values[sIdx] === null ? pointFor(i, min) : pointFor(i, row.values[sIdx])));
    parts.push(`<polygon points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2"/>`);
    for (const p of pts) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}"/>`);
  });

  // legend
  if (data.series.length > 1) {
    data.series.forEach((series, i) => {
      const ly = 8 + i * 14;
      parts.push(`<rect x="8" y="${ly}" width="10" height="10" fill="${SERIES_COLORS[i % SERIES_COLORS.length]}"/>`);
      parts.push(`<text x="22" y="${ly + 9}" fill="#333">${escapeXml(series.label)}</text>`);
    });
  }

  parts.push('</svg>');
  return parts.join('');
}

const SUPPORTED_PLOT_TYPES = new Set(['2d', 'radar']);

/** The one real entry point this module exposes for actually
 *  producing a plot: parses nothing itself (the caller already has
 *  `table.plot`'s own text and should have run it through
 *  parsePlotOptions), just dispatches by `type` (default `2d`,
 *  matching real org-plot's own documented default) to the
 *  appropriate renderer. Throws a clear, direct error for `3d`/`grid`
 *  or any other unrecognized type -- deliberately not silently
 *  falling back to a 2D rendering of data that was never meant to be
 *  shown that way. */
export function renderPlotSvg(table, options) {
  const type = options.type || '2d';
  if (!SUPPORTED_PLOT_TYPES.has(type)) {
    throw new Error(`This app doesn't support type:${type} plots -- only type:2d and type:radar are implemented (real org-plot's own 3d/grid types require an external gnuplot process this app can't run).`);
  }
  const data = extractPlotData(table, options);
  return type === 'radar' ? renderRadarSvg(data, options) : render2dSvg(data, options);
}
