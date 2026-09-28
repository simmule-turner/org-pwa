// Extracted from app.js: render helpers. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { isAudioFilename } from '../src/attach.js';
import { IMAGE_EXT_RE } from '../src/inline-markup.js';
import { guessAudioMimeType, guessImageMimeType, guessViewableMimeType } from '../src/link-resolve.js';
import { renderMathHtml } from '../src/math-render.js';
import { parsePlotOptions, renderPlotSvg } from '../src/org-plot.js';
import { buildWeatherApiUrl } from '../src/org-weather.js';
import { diffHunks } from '../src/text-diff.js';
import { PLOT_SVG_CACHE_LIMIT } from './constants.js';
import { plotSvgCache } from './singletons.js';

/** Every image/audio extension already has its own dedicated MIME
 *  lookup (guessImageMimeType/guessAudioMimeType); this tries each in
 *  turn and falls back to a generic binary type -- for
 *  saveAttachmentLink's own download, which needs SOME MIME type
 *  regardless of what kind of file it turns out to be. */
export function guessAnyAttachmentMimeType(filename) {
  if (IMAGE_EXT_RE.test(filename)) return guessImageMimeType(filename);
  if (isAudioFilename(filename)) return guessAudioMimeType(filename);
  return guessViewableMimeType(filename) || 'application/octet-stream';
}

/** Fetches current conditions + today's own high/low from Open-Meteo
 *  and normalizes the response into the flat shape
 *  org-weather.js's own formatWeatherLine expects -- real browser
 *  fetch(), a genuine network call this app's own automated tests
 *  can't exercise directly (there's no live network access in that
 *  environment), but works exactly as any other fetch() call would
 *  in the actual, shipped app. A 10-second timeout (AbortController)
 *  keeps a stalled connection from hanging the whole refresh
 *  indefinitely; a non-2xx response or malformed JSON both throw a
 *  clear, specific error rather than silently returning incomplete
 *  data. */
export async function fetchWeatherData(latitude, longitude) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(buildWeatherApiUrl(latitude, longitude), { signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Weather request timed out.' : `Weather request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Weather request failed: HTTP ${response.status}`);
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error('Weather response was not valid JSON.');
  }
  if (!json.current || !json.current_units || !json.daily) {
    throw new Error('Weather response was missing expected fields.');
  }
  return {
    currentTime: json.current.time,
    weatherCode: json.current.weather_code,
    humidity: json.current.relative_humidity_2m,
    humidityUnit: json.current_units.relative_humidity_2m,
    pressure: json.current.surface_pressure,
    pressureUnit: json.current_units.surface_pressure,
    temperatureCurrent: json.current.temperature_2m,
    temperatureMin: json.daily.temperature_2m_min[0],
    temperatureMax: json.daily.temperature_2m_max[0],
    apparentTemperatureMin: json.daily.apparent_temperature_min[0],
    apparentTemperatureMax: json.daily.apparent_temperature_max[0],
    windSpeed: json.current.wind_speed_10m,
  };
}

export function scrollFocusedHeadingIntoView() {
  requestAnimationFrame(() => {
    const el = document.getElementById('keyboard-focused-row');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  });
}

export function plotCacheKey(table) {
  return JSON.stringify({ plot: table.plot, rows: table.rows.filter((r) => r.type === 'row').map((r) => r.cells) });
}

/** Returns the rendered SVG for `table`'s own current #+PLOT: line and
 *  data, from cache when the content hasn't changed since it was last
 *  rendered, or by rendering (and caching) it fresh otherwise. Lets a
 *  thrown error (unsupported plot type, an out-of-range column, not
 *  enough data -- see org-plot.js) propagate to the caller rather than
 *  caching a failure, so a fixed #+PLOT: line gets a fresh, real
 *  attempt next time rather than a stale cached error. */
export function getOrRenderPlotSvg(table) {
  const key = plotCacheKey(table);
  const cached = plotSvgCache.get(key);
  if (cached !== undefined) return cached;
  const svg = renderPlotSvg(table, parsePlotOptions(table.plot));
  if (plotSvgCache.size >= PLOT_SVG_CACHE_LIMIT) {
    plotSvgCache.delete(plotSvgCache.keys().next().value);
  }
  plotSvgCache.set(key, svg);
  return svg;
}

/** Asks the currently-active (controlling) service worker for its own
 *  version via a GET_VERSION message/MessageChannel round-trip --
 *  sw.js is a classic, non-module script (registered without {type:
 *  'module'}), so it can't share an imported constant with app.js
 *  directly the way two ES modules could. Returns null if there's no
 *  service worker support, no controller yet (e.g. the very first
 *  load before the SW has taken control), or the round-trip doesn't
 *  resolve within a couple seconds for any reason -- callers should
 *  treat null as "unknown" and show nothing rather than a stale or
 *  fabricated value. */
export function getServiceWorkerVersion() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => settle((event.data && event.data.version) || null);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    setTimeout(() => settle(null), 2000);
  });
}

/** Renders a diffHunks() result as colored added/removed/same lines,
 *  with a visual gap between non-adjacent hunks -- the actual "show
 *  what changed" view for a single history entry, diffed against the
 *  entry immediately before it (what that one edit actually did, not
 *  a diff against the file's current live state). */
export function renderDiffView(oldText, newText) {
  const wrap = document.createElement('div');
  wrap.style.fontFamily = 'ui-monospace, monospace';
  wrap.style.fontSize = '12px';
  wrap.style.background = 'var(--surface, #f6f6f6)';
  wrap.style.borderRadius = '6px';
  wrap.style.padding = '6px 8px';
  wrap.style.margin = '4px 0 8px';
  wrap.style.overflowX = 'auto';
  wrap.style.whiteSpace = 'pre';

  const hunks = diffHunks(oldText, newText, 1);
  if (hunks.length === 0) {
    wrap.textContent = '(no textual difference)';
    wrap.style.fontStyle = 'italic';
    wrap.style.opacity = '0.6';
    return wrap;
  }

  hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) {
      const gap = document.createElement('div');
      gap.textContent = '\u22ee';
      gap.style.opacity = '0.4';
      wrap.appendChild(gap);
    }
    for (const op of hunk.lines) {
      const lineEl = document.createElement('div');
      const prefix = op.type === 'added' ? '+ ' : op.type === 'removed' ? '\u2212 ' : '  ';
      lineEl.textContent = prefix + op.line;
      if (op.type === 'added') {
        lineEl.style.color = '#227a1e';
        lineEl.style.background = '#dcf0d8';
      } else if (op.type === 'removed') {
        lineEl.style.color = '#a02020';
        lineEl.style.background = '#fde3e3';
      } else {
        lineEl.style.opacity = '0.6';
      }
      wrap.appendChild(lineEl);
    }
  });
  return wrap;
}

export function imagePlaceholder(target, reason) {
  const span = document.createElement('span');
  span.textContent = reason ? `[image: ${target} \u2014 ${reason}]` : `[image: ${target}]`;
  span.style.color = 'var(--text-muted, #888)';
  span.style.fontStyle = 'italic';
  return span;
}

/** Renders a 'latex' inline node (see src/inline-markup.js's own
 *  matchLatexFragmentAt) via math-render.js's own engine adapter. This
 *  function -- like every other caller of renderMathHtml -- knows
 *  nothing about KaTeX specifically, only that it gets back either an
 *  HTML string to inject, or a failure to show a graceful fallback
 *  for; see math-render.js's own docs for why that separation is what
 *  keeps a future engine swap cheap. A failure (the engine isn't
 *  available at all, or rejected this specific LaTeX as invalid) shows
 *  the raw source text with a distinct, dashed-border treatment rather
 *  than silently showing nothing or breaking the rest of the
 *  paragraph's own render. */
export function renderLatexNode(node) {
  const { html, ok } = renderMathHtml(node.source, node.displayMode);
  const el = document.createElement(node.displayMode ? 'div' : 'span');
  if (ok) {
    el.innerHTML = html;
  } else {
    el.textContent = node.source;
    el.style.border = '1px dashed #f88';
    el.style.borderRadius = '3px';
    el.style.padding = '0 3px';
    el.style.fontFamily = 'monospace';
    el.style.fontSize = '0.9em';
    el.title = 'This LaTeX fragment could not be rendered.';
  }
  return el;
}
