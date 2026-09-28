// Extracted from app.js: weather flow.
import { getCalendarLatitude, getCalendarLongitude, getWeatherRefreshInterval } from '../src/local-variables.js';
import { documentUsesOrgWeather } from '../src/sexp-eval.js';
import { ensureAgendaFilesLoaded } from './agenda-files.js';
import { S } from './app-state.js';
import { WEATHER_CACHE_KEY } from './constants.js';
import { setStatus } from './editing.js';
import { fetchWeatherData } from './render-helpers.js';
import { render } from './render.js';
import { commitGlobalVariableChange, renderSettingsView } from './settings-view.js';
import { agendaFilesCache, kv } from './singletons.js';

/** Loads whatever weather snapshot was cached from a previous
 *  session, if any, into the top-level weatherData/weatherLastRefreshed
 *  state -- called once at startup, so %%(org-weather) has something
 *  to show immediately rather than staying blank until the person
 *  explicitly refreshes again after every reload. */
export async function loadCachedWeatherData() {
  try {
    const cached = await kv.get(WEATHER_CACHE_KEY);
    const value = cached && typeof cached === 'object' && 'value' in cached ? cached.value : cached;
    if (!value) return;
    const parsed = JSON.parse(value);
    S.weatherData = parsed.data;
    S.weatherLastRefreshed = parsed.fetchedAt;
  } catch {
    // A corrupted or missing cache entry just means "nothing cached
    // yet" -- not a startup failure.
  }
}

/** Fetches fresh weather data using the currently-configured
 *  calendar-latitude/calendar-longitude, updates the top-level
 *  weatherData/weatherLastRefreshed state, persists it to IndexedDB
 *  for the next session, and re-renders. weatherLastRefreshed is the
 *  API's own reported current.time -- the underlying data's own "as
 *  of" timestamp, which is what actually reflects its staleness, not
 *  when the client happened to make the request (network latency,
 *  API server lag, etc. can make the two differ). A failed fetch
 *  (offline, the API unreachable, a malformed response) leaves
 *  whatever was already cached in place -- refreshing is never
 *  destructive, a stale-but-present snapshot is strictly more useful
 *  than none at all. */
export async function refreshWeather() {
  const latitude = getCalendarLatitude(S.state.localVariables);
  const longitude = getCalendarLongitude(S.state.localVariables);
  setStatus('Refreshing weather\u2026');
  render();
  try {
    const data = await fetchWeatherData(latitude, longitude);
    S.weatherData = data;
    S.weatherLastRefreshed = data.currentTime;
    await kv.set(WEATHER_CACHE_KEY, JSON.stringify({ data, fetchedAt: S.weatherLastRefreshed }));
    setStatus('Weather refreshed.');
  } catch (err) {
    setStatus(`Couldn't refresh weather: ${err.message}`);
  }
  render();
}

/** Where (if anywhere) %%(org-weather) is actually in use right now
 *  -- 'current' (the currently open document itself), 'agenda' (not
 *  the open document, but at least one configured agenda file), or
 *  null (neither). Weather integration isn't necessarily tied to
 *  whatever document happens to be open -- it's just as commonly used
 *  from within an org-agenda-files entry instead, since the Agenda
 *  view is where the weather line typically actually shows up. */
export function whereOrgWeatherIsUsed() {
  if (documentUsesOrgWeather(S.state.doc)) return 'current';
  ensureAgendaFilesLoaded();
  for (const entry of agendaFilesCache.values()) {
    if (entry.doc && documentUsesOrgWeather(entry.doc)) return 'agenda';
  }
  return null;
}

/** Checks whether weather is due for an automatic refresh per
 *  org-weather-refresh-interval, and refreshes it if so. Called from
 *  the modeline's own 30-second timer (see that timer's own site) and
 *  once at startup (see bootstrap's own resume path) -- the timer
 *  keeps running regardless of whether the clock display itself
 *  (display-time-mode) is on, so this stays correct either way, not
 *  coupled to that unrelated setting. Gated on org-weather actually
 *  being in use somewhere relevant, and on the interval itself
 *  ('never' by default) -- never does this unprompted network work
 *  otherwise. */
export async function checkWeatherAutoRefresh() {
  if (!whereOrgWeatherIsUsed()) return;
  const interval = getWeatherRefreshInterval(S.state.localVariables);
  if (interval === 'never') return;
  const hours = Number(interval);
  const elapsedMs = S.weatherLastRefreshed ? Date.now() - new Date(S.weatherLastRefreshed).getTime() : Infinity;
  if (elapsedMs < hours * 3600000) return;
  await refreshWeather();
  if (S.settingsOpen) renderSettingsView();
}

/** Fetches the device's own current latitude/longitude via the
 *  browser's Geolocation API and commits both to calendar-latitude/
 *  calendar-longitude -- the "Use device location" button next to
 *  those two fields in Quick Settings. Any failure (permission
 *  denied, no fix available, the API missing entirely in this
 *  browser/context) leaves both fields exactly as they already were. */
export async function refreshLocationFromDevice() {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not available in this browser.');
    return;
  }
  setStatus('Getting device location\u2026');
  render();
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: false });
    });
    const latitude = Math.round(position.coords.latitude * 10000) / 10000;
    const longitude = Math.round(position.coords.longitude * 10000) / 10000;
    await commitGlobalVariableChange('calendar-latitude', String(latitude));
    await commitGlobalVariableChange('calendar-longitude', String(longitude));
    setStatus(`Location updated: ${latitude}, ${longitude}.`);
  } catch (err) {
    const message =
      err.code === 1
        ? 'Location permission denied.'
        : err.code === 2
          ? 'Location unavailable.'
          : err.code === 3
            ? 'Location request timed out.'
            : `Could not get device location: ${err.message || err}`;
    setStatus(message);
  }
  renderSettingsView();
  render();
}
