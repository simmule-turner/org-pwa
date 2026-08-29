/**
 * %%(org-weather) -- this app's own extension, not a real elisp/org
 * function, built against the Open-Meteo forecast API
 * (https://open-meteo.com/). Deliberately split into two halves: this
 * module (pure, no network, no DOM) handles everything about
 * INTERPRETING already-fetched weather data -- the WMO weather-code
 * lookup table, temperature/speed unit conversion, and
 * org-weather-format's own placeholder substitution -- while the
 * actual network fetch and IndexedDB caching live in app.js, since
 * those genuinely need the real browser fetch() and can't be
 * meaningfully unit-tested the same way this module's own pure
 * functions can.
 */

/** WMO weather-code -> { text, icon }, the exact mapping the request
 *  itself specified (a direct transcription of the provided Python
 *  lookup table, not independently re-derived) -- codes not in this
 *  table (Open-Meteo's own documented set is larger than what was
 *  given here) fall back to a clear "Unknown weather" / "\u2753" pair
 *  rather than guessing at a description this app was never actually
 *  given. */
const WEATHER_CODE_MAP = {
  0: { text: 'Clear sky', icon: '\u2600\ufe0f' },
  1: { text: 'Mainly clear', icon: '\ud83c\udf24\ufe0f' },
  2: { text: 'Partly cloudy', icon: '\u26c5' },
  3: { text: 'Overcast', icon: '\u2601\ufe0f' },
  45: { text: 'Fog', icon: '\ud83c\udf2b\ufe0f' },
  48: { text: 'Depositing rime fog', icon: '\ud83c\udf2b\ufe0f' },
  51: { text: 'Light drizzle', icon: '\ud83c\udf27\ufe0f' },
  53: { text: 'Moderate drizzle', icon: '\ud83c\udf27\ufe0f' },
  55: { text: 'Dense drizzle', icon: '\ud83c\udf27\ufe0f' },
  61: { text: 'Slight rain', icon: '\ud83c\udf27\ufe0f' },
  63: { text: 'Moderate rain', icon: '\ud83c\udf27\ufe0f' },
  65: { text: 'Heavy rain', icon: '\ud83c\udf27\ufe0f' },
  71: { text: 'Slight snow fall', icon: '\ud83c\udf28\ufe0f' },
  73: { text: 'Moderate snow fall', icon: '\ud83c\udf28\ufe0f' },
  75: { text: 'Heavy snow fall', icon: '\ud83c\udf28\ufe0f' },
  77: { text: 'Snow grains', icon: '\ud83c\udf28\ufe0f' },
  80: { text: 'Slight rain showers', icon: '\ud83c\udf26\ufe0f' },
  81: { text: 'Moderate rain showers', icon: '\ud83c\udf26\ufe0f' },
  82: { text: 'Violent rain showers', icon: '\u26c8\ufe0f' },
  85: { text: 'Slight snow showers', icon: '\ud83c\udf28\ufe0f' },
  86: { text: 'Heavy snow showers', icon: '\ud83c\udf28\ufe0f' },
  95: { text: 'Thunderstorm', icon: '\u26c8\ufe0f' },
  96: { text: 'Thunderstorm with slight hail', icon: '\u26c8\ufe0f' },
  99: { text: 'Thunderstorm with heavy hail', icon: '\u26c8\ufe0f' },
};

/** Looks up a WMO weather code -- returns a clear, distinct fallback
 *  for a code outside the table given (rather than silently showing
 *  nothing, or guessing), so an unrecognized code is still visibly
 *  informative rather than a blank spot in the formatted output. */
function lookupWeatherCode(code) {
  return WEATHER_CODE_MAP[code] || { text: 'Unknown weather', icon: '\u2753' };
}

/** This app always fetches in a fixed, known pair of units --
 *  Fahrenheit and mph, matching the request's own exact example URL
 *  -- specifically so conversion only ever needs to go FROM these two
 *  fixed units TO whatever org-weather-temperature-unit /
 *  org-weather-speed-unit are configured to display, never needing to
 *  compare against the API's own returned unit-label strings (which
 *  use a different, slightly inconsistent format -- "mp/h", not
 *  "mph" -- than this app's own configuration values do). */
/** The single source of truth for org-weather-format's own default
 *  value -- previously duplicated by hand in local-variables.js (its
 *  own getter fallback), agenda.js (its own function-parameter
 *  default), and app.js (the Quick Settings UI default), a real drift
 *  risk every one of those needed remembering to update in lockstep.
 *  Defined here since this is the module that actually owns
 *  interpreting org-weather-format in the first place. */
const DEFAULT_ORG_WEATHER_FORMAT = 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au';

const FETCH_TEMPERATURE_UNIT = '\u00b0F';
const FETCH_SPEED_UNIT = 'mph';

/** Fahrenheit -> Celsius, or the value unchanged if the target unit
 *  is already Fahrenheit (real org-weather-temperature-unit's own
 *  default, matching what's actually fetched, so no conversion
 *  happens for the common case at all). Rounded to 1 decimal place,
 *  matching the Open-Meteo API's own typical precision for these
 *  values -- converting without rounding would otherwise produce
 *  long, uninformative floating-point tails. */
function convertTemperature(fahrenheit, targetUnit) {
  const value = targetUnit === '\u00b0C' ? ((fahrenheit - 32) * 5) / 9 : fahrenheit;
  return Math.round(value * 10) / 10;
}

/** mph -> the target speed unit (km/h, m/s, or Knots), or unchanged
 *  if the target is already mph -- converts via m/s as a common
 *  intermediate rather than a separate formula for every pairwise
 *  combination. 1 mph = 0.44704 m/s and 1 knot = 0.514444 m/s
 *  exactly (the international definition: 1 nautical mile = 1852m,
 *  1 knot = 1852m / 3600s), not approximations. Rounded to 1 decimal
 *  place, same reasoning as convertTemperature above. */
function convertSpeed(mph, targetUnit) {
  if (targetUnit === 'mph') return Math.round(mph * 10) / 10;
  const metersPerSecond = mph * 0.44704;
  let value;
  if (targetUnit === 'km/h') value = metersPerSecond * 3.6;
  else if (targetUnit === 'm/s') value = metersPerSecond;
  else if (targetUnit === 'Knots') value = metersPerSecond / 0.514444;
  else value = mph; // an unrecognized target unit is left as-is rather than silently dropped
  return Math.round(value * 10) / 10;
}

/** Substitutes every recognized %-placeholder in `template` (real
 *  org-weather-format's own value) against `data` (the normalized
 *  shape fetchWeatherData in app.js produces -- see that function's
 *  own docs for the exact fields expected) and the configured
 *  temperature/speed units. An unrecognized %-sequence (a typo, or a
 *  literal "%" the person actually wanted) is left completely
 *  untouched -- this app's own consistent stance throughout (see
 *  diary-sexp.js's own %s/%d handling) on not guessing at what an
 *  unfamiliar placeholder was supposed to mean. */
/** Age of `dataTime` (the weather data's own reported reading time,
 *  not whenever this happens to be called) relative to `now`, in
 *  org-weather-format's own %a/%au shape: a value plus a unit letter,
 *  m/h/d, switching units at the natural boundary -- 0-59 minutes,
 *  1-23 hours, 1+ days -- rather than showing e.g. "65m" once a full
 *  hour has passed. Floor, not round: age means how much time has
 *  FULLY elapsed, and rounding could also push a value past the
 *  stated bounds (round(59.6)=60, outside "0-59"). Clamped to a
 *  minimum of 0 for a `dataTime` that's at or after `now` (clock
 *  skew, or a data timestamp that isn't strictly in the past) rather
 *  than showing a nonsensical negative age. */
function formatWeatherAge(dataTime, now) {
  const ageMinutesTotal = Math.max(0, Math.floor((now.getTime() - new Date(dataTime).getTime()) / 60000));
  if (ageMinutesTotal < 60) return { value: ageMinutesTotal, unit: 'm' };
  const ageHoursTotal = Math.floor(ageMinutesTotal / 60);
  if (ageHoursTotal < 24) return { value: ageHoursTotal, unit: 'h' };
  return { value: Math.floor(ageHoursTotal / 24), unit: 'd' };
}

function formatWeatherLine(template, data, temperatureUnit, speedUnit, now = new Date()) {
  const { text: desc, icon } = lookupWeatherCode(data.weatherCode);
  const age = formatWeatherAge(data.currentTime, now);
  const values = {
    '%desc': desc,
    '%icon': icon,
    '%h': String(data.humidity),
    '%hu': data.humidityUnit,
    '%p': String(data.pressure),
    '%pu': data.pressureUnit,
    '%tcur': String(convertTemperature(data.temperatureCurrent, temperatureUnit)),
    '%tmin': String(convertTemperature(data.temperatureMin, temperatureUnit)),
    '%tmax': String(convertTemperature(data.temperatureMax, temperatureUnit)),
    '%tamin': String(convertTemperature(data.apparentTemperatureMin, temperatureUnit)),
    '%tamax': String(convertTemperature(data.apparentTemperatureMax, temperatureUnit)),
    '%tu': temperatureUnit,
    '%s': String(convertSpeed(data.windSpeed, speedUnit)),
    '%su': speedUnit,
    '%a': String(age.value),
    '%au': age.unit,
  };
  // Longest keys first, so "%tamin"/"%tamax" match before the
  // shorter "%tmin"-prefix-adjacent "%h"/"%s"/"%p"-style keys could
  // ever partially collide with them.
  const placeholders = Object.keys(values).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(placeholders.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return template.replace(pattern, (match) => values[match]);
}

const ORG_WEATHER_RE = /^%%\(org-weather\)\s*$/;

/** True if `line` is exactly the %%(org-weather) standalone-line
 *  trigger -- same self-contained-line convention as
 *  diary-sexp.js's own isDiaryXxxLine detectors. */
function isOrgWeatherLine(line) {
  return ORG_WEATHER_RE.test(line.trim());
}

/** Builds the actual Open-Meteo forecast API URL -- matches the
 *  original request's own exact query parameters (temperature in
 *  Fahrenheit, wind speed in mph, one day of daily min/max plus
 *  current conditions) so this app always fetches in the same fixed
 *  pair of units convertTemperature/convertSpeed above expect to
 *  convert FROM (FETCH_TEMPERATURE_UNIT / FETCH_SPEED_UNIT below),
 *  never needing to compare against the API's own differently-
 *  formatted unit-label strings at all. */
function buildWeatherApiUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min',
    current: 'temperature_2m,weather_code,relative_humidity_2m,surface_pressure,wind_speed_10m',
    timezone: 'auto',
    forecast_days: '1',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export {
  WEATHER_CODE_MAP,
  lookupWeatherCode,
  convertTemperature,
  convertSpeed,
  formatWeatherLine,
  FETCH_TEMPERATURE_UNIT,
  FETCH_SPEED_UNIT,
  isOrgWeatherLine,
  buildWeatherApiUrl,
  DEFAULT_ORG_WEATHER_FORMAT,
};
