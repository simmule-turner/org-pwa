import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupWeatherCode, convertTemperature, convertSpeed, formatWeatherLine, buildWeatherApiUrl } from '../src/org-weather.js';

// ---- lookupWeatherCode ------------------------------------------------------

test('lookupWeatherCode returns the exact text/icon pair for every code in the request\u2019s own provided table', () => {
  assert.deepEqual(lookupWeatherCode(0), { text: 'Clear sky', icon: '\u2600\ufe0f' });
  assert.deepEqual(lookupWeatherCode(3), { text: 'Overcast', icon: '\u2601\ufe0f' });
  assert.deepEqual(lookupWeatherCode(61), { text: 'Slight rain', icon: '\ud83c\udf27\ufe0f' });
  assert.deepEqual(lookupWeatherCode(95), { text: 'Thunderstorm', icon: '\u26c8\ufe0f' });
  assert.deepEqual(lookupWeatherCode(99), { text: 'Thunderstorm with heavy hail', icon: '\u26c8\ufe0f' });
});

test('THE FIX: an unrecognized WMO code falls back to a clear, distinct "Unknown weather" pair rather than silently showing nothing', () => {
  assert.deepEqual(lookupWeatherCode(12345), { text: 'Unknown weather', icon: '\u2753' });
});

// ---- convertTemperature ------------------------------------------------------

test('convertTemperature leaves the value unchanged when the target unit is already Fahrenheit -- matching what this app always fetches in', () => {
  assert.equal(convertTemperature(86.3, '\u00b0F'), 86.3);
});

test('THE FIX: convertTemperature to Celsius matches hand-computed expected values, not just round-tripped through the same formula', () => {
  assert.equal(convertTemperature(86.3, '\u00b0C'), 30.2); // (86.3-32)*5/9 = 30.166... -> 30.2
  assert.equal(convertTemperature(75.5, '\u00b0C'), 24.2); // (75.5-32)*5/9 = 24.166... -> 24.2
  assert.equal(convertTemperature(32, '\u00b0C'), 0); // freezing point
  assert.equal(convertTemperature(212, '\u00b0C'), 100); // boiling point
});

// ---- convertSpeed -------------------------------------------------------------

test('convertSpeed leaves the value unchanged when the target unit is already mph', () => {
  assert.equal(convertSpeed(5.1, 'mph'), 5.1);
});

test('THE FIX: convertSpeed to km/h, m/s, and Knots each match hand-computed expected values, via the confirmed exact conversion factors (1 mph = 0.44704 m/s, 1 knot = 0.514444 m/s exactly)', () => {
  assert.equal(convertSpeed(5.1, 'km/h'), 8.2); // 5.1 * 1.60934 = 8.2076... -> 8.2
  assert.equal(convertSpeed(5.1, 'm/s'), 2.3); // 5.1 * 0.44704 = 2.2799... -> 2.3
  assert.equal(convertSpeed(10, 'Knots'), 8.7); // 10 * 0.44704 / 0.514444 = 8.689... -> 8.7
});

// ---- formatWeatherLine --------------------------------------------------------

const SAMPLE_DATA = {
  weatherCode: 3,
  humidity: 49,
  humidityUnit: '%',
  pressure: 1002.8,
  pressureUnit: 'hPa',
  temperatureCurrent: 86.3,
  temperatureMin: 75.5,
  temperatureMax: 91.8,
  apparentTemperatureMin: 84.3,
  apparentTemperatureMax: 103.5,
  windSpeed: 5.1,
};

test('THE EXACT REQUEST: the default org-weather-format value, against the exact sample data provided, in the default units', () => {
  const result = formatWeatherLine('Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su', SAMPLE_DATA, '\u00b0F', 'mph');
  assert.equal(result, 'Weather: Overcast, 86.3(75.5-91.8)\u00b0F, 1002.8hPa, 49%, 5.1mph');
});

test('THE FIX: the same format, converted to \u00b0C and km/h, correctly converts every temperature placeholder and the speed placeholder, leaving humidity/pressure (which have no configurable unit) untouched', () => {
  const result = formatWeatherLine('Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su', SAMPLE_DATA, '\u00b0C', 'km/h');
  assert.equal(result, 'Weather: Overcast, 30.2(24.2-33.2)\u00b0C, 1002.8hPa, 49%, 8.2km/h');
});

test('%icon renders the weather-code icon directly', () => {
  assert.equal(formatWeatherLine('%icon', SAMPLE_DATA, '\u00b0F', 'mph'), '\u2601\ufe0f');
});

test('%tamin/%tamax (apparent temperature) are also correctly converted, distinct from %tmin/%tmax', () => {
  const result = formatWeatherLine('%tamin to %tamax', SAMPLE_DATA, '\u00b0C', 'mph');
  assert.equal(result, '29.1 to 39.7'); // (84.3-32)*5/9=29.055..->29.1, (103.5-32)*5/9=39.722..->39.7
});

test('THE FIX: %h and %hu (shorter keys) don\u2019t get partially matched by %s/%p/%t-prefixed placeholders, and vice versa -- every placeholder resolves to its own exact, distinct value', () => {
  const result = formatWeatherLine('%h|%hu|%p|%pu|%s|%su|%tcur|%tu', SAMPLE_DATA, '\u00b0F', 'mph');
  assert.equal(result, '49|%|1002.8|hPa|5.1|mph|86.3|\u00b0F');
});

test('an unrecognized %-sequence is left completely untouched, not silently dropped or guessed at', () => {
  const result = formatWeatherLine('%unknown and %desc', SAMPLE_DATA, '\u00b0F', 'mph');
  assert.equal(result, '%unknown and Overcast');
});

test('a template with no placeholders at all passes through unchanged', () => {
  assert.equal(formatWeatherLine('just plain text', SAMPLE_DATA, '\u00b0F', 'mph'), 'just plain text');
});

// ---- buildWeatherApiUrl --------------------------------------------------

test('THE EXACT REQUEST: buildWeatherApiUrl matches the exact URL structure and query parameters given in the original request', () => {
  const url = new URL(buildWeatherApiUrl(35.95, -78.86));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '35.95');
  assert.equal(url.searchParams.get('longitude'), '-78.86');
  assert.equal(url.searchParams.get('daily'), 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min');
  assert.equal(url.searchParams.get('current'), 'temperature_2m,weather_code,relative_humidity_2m,surface_pressure,wind_speed_10m');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.equal(url.searchParams.get('forecast_days'), '1');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(url.searchParams.get('precipitation_unit'), 'inch');
});

test('buildWeatherApiUrl reflects whatever latitude/longitude it\u2019s given, not hardcoded values', () => {
  const url = new URL(buildWeatherApiUrl(51.5, -0.13));
  assert.equal(url.searchParams.get('latitude'), '51.5');
  assert.equal(url.searchParams.get('longitude'), '-0.13');
});
