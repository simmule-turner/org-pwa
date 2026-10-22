// @ts-check
/**
 * The sun-related holidays of Emacs's `holiday-solar-holidays` (solar.el): the equinoxes and solstices, and the days daylight saving
 * time starts and ends. The equinoxes follow `solar-equinoxes/solstices` (Meeus, accurate to a minute from 1951 to 2050). Time zone
 * and daylight saving rules come from the zone given, as the zone database knows them: Emacs reads them once from the system.
 */

/** @typedef {[number, number, number]} CalDate */
/** @typedef {{ date: CalDate, name: string, hours: number }} LocalMoment */

// Data for solar equinox/solstice calculations (solar-seasons-data).
const SEASONS_DATA = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112], [156, 73.14, 45036.886],
  [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513], [58, 119.81, 33718.147],
  [52, 297.17, 150.678], [50, 21.02, 2281.226], [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417],
  [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];

export const NORTH_SEASONS = ['Vernal Equinox', 'Summer Solstice', 'Autumnal Equinox', 'Winter Solstice'];
export const SOUTH_SEASONS = ['Autumnal Equinox', 'Winter Solstice', 'Vernal Equinox', 'Summer Solstice'];

/** @param {number} x */
const cosDeg = (x) => Math.cos((((x % 360) + 360) % 360) * (Math.PI / 180));

/** Julian day of the mean equinox or solstice `k` (0 spring equinox .. 3 winter solstice) of `year` (solar-mean-equinoxes/solstices). @param {number} k @param {number} year */
function meanJulianDay(k, year) {
  const y = year / 1000;
  const z = (year - 2000) / 1000;
  /** @type {number[][]} */
  const early = [
    [1721139.29189, 365242.1374, 0.06134, 0.00111, -0.00071],
    [1721233.25401, 365241.72562, -0.05323, 0.00907, 0.00025],
    [1721325.70455, 365242.49558, -0.11677, -0.00297, 0.00074],
    [1721414.39987, 365242.88257, -0.00769, -0.00933, -0.00006],
  ];
  /** @type {number[][]} */
  const late = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
  ];
  const [a, b, c, d, e] = (year < 1000 ? early : late)[k];
  const v = year < 1000 ? y : z;
  return a + b * v + c * v * v + d * v * v * v + e * v * v * v * v;
}

/** The instant (milliseconds since 1970, UT) of equinox or solstice `k` of `year` (solar-equinoxes/solstices before the time zone is added).
 * @param {number} k @param {number} year */
export function seasonInstant(k, year) {
  const jde0 = meanJulianDay(k, year);
  const t = (jde0 - 2451545.0) / 36525;
  const w = 35999.373 * t - 2.47;
  const deltaLambda = 1 + 0.0334 * cosDeg(w) + 0.0007 * cosDeg(2 * w);
  const s = SEASONS_DATA.reduce((sum, [a, b, c]) => sum + a * cosDeg(c * t + b), 0);
  const jde = jde0 + (0.00001 * s) / deltaLambda;
  const jd = jde - (102.3 + 123.5 * t + 32.5 * t * t) / 86400;
  return (jd - 2440587.5) * 86400000;
}

/** @typedef {{ date: CalDate, hours: number, offset: number, name: string }} Local  `offset` is minutes east of UTC */

/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();
/** @type {Map<string, Intl.DateTimeFormat>} */
const nameFormats = new Map();

/** The zone's abbreviation (EST, CET, AEDT): the first of several English locales that has one rather than "GMT+1", as the system gives Emacs.
 * @param {string} zone @param {number} instant */
function zoneName(zone, instant) {
  let fallback = '';
  for (const locale of ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-IN']) {
    const key = `${locale}|${zone}`;
    let f = nameFormats.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
      nameFormats.set(key, f);
    }
    const name = (f.formatToParts(new Date(instant)).find((x) => x.type === 'timeZoneName') || { value: '' }).value;
    if (!/^(GMT|UTC)[+-]/.test(name)) return name;
    fallback = fallback || name;
  }
  return fallback;
}
/** @type {Map<string, ReturnType<typeof computeDaylightSaving>>} */
const saved = new Map();

/** The wall-clock date and time in `zone` at `instant`.
 * @param {string} zone @param {number} instant @returns {Local} */
export function localAt(zone, instant) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formats.set(zone, f);
  }
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of f.formatToParts(new Date(Math.floor(instant / 1000) * 1000))) p[part.type] = part.value;
  const fraction = (instant - Math.floor(instant / 1000) * 1000) / 1000;
  const hours = Number(p.hour) + Number(p.minute) / 60 + (Number(p.second) + fraction) / 3600;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return { date: [Number(p.month), Number(p.day), Number(p.year)], hours, offset: Math.round((wall - Math.floor(instant / 1000) * 1000) / 60000), name: zoneName(zone, instant) };
}

/** Equinox or solstice `k` of `year` as local date, hours and the zone name in force then.
 * @param {string} zone @param {number} k @param {number} year */
export function seasonLocal(zone, k, year) {
  return localAt(zone, seasonInstant(k, year));
}

/**
 * The daylight saving time of `zone` in `year`: the date and wall-clock minutes it starts and ends, and the zone names. Null dates when the
 * zone has none that year. Start time is in standard time and end time in daylight time, as `calendar-daylight-savings-starts-time` and `-ends-time`.
 * @param {string} zone @param {number} year
 * @returns {{ starts: CalDate | null, startsTime: number, ends: CalDate | null, endsTime: number, standardName: string, daylightName: string }} */
export function daylightSaving(zone, year) {
  const key = `${zone}|${year}`;
  let hit = saved.get(key);
  if (!hit) {
    hit = computeDaylightSaving(zone, year);
    saved.set(key, hit);
  }
  return hit;
}

/** @param {string} zone @param {number} year */
function computeDaylightSaving(zone, year) {
  const start = Date.UTC(year, 0, 1);
  const day = 86400000;
  let previous = localAt(zone, start);
  /** @type {{ at: number, before: Local, after: Local }[]} */
  const changes = [];
  for (let t = start + day; t <= Date.UTC(year + 1, 0, 1); t += day) {
    const now = localAt(zone, t);
    if (now.offset !== previous.offset) {
      let lo = t - day;
      let hi = t;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2000) * 1000;
        if (localAt(zone, mid).offset === previous.offset) lo = mid;
        else hi = mid;
      }
      changes.push({ at: hi, before: localAt(zone, hi - 1000), after: localAt(zone, hi) });
    }
    previous = now;
  }
  const none = { starts: null, startsTime: 0, ends: null, endsTime: 0, standardName: localAt(zone, start).name, daylightName: localAt(zone, start).name };
  if (!changes.length) return none;
  const up = changes.find((c) => c.after.offset > c.before.offset);
  const down = changes.find((c) => c.after.offset < c.before.offset);
  const minutes = (/** @type {Local} */ l) => Math.round(l.hours * 60);
  return {
    starts: up ? up.before.date : null,
    startsTime: up ? minutes(up.before) : 0,
    ends: down ? down.before.date : null,
    endsTime: down ? minutes(down.before) : 0,
    standardName: (up ? up.before : down ? down.after : changes[0].before).name,
    daylightName: (up ? up.after : down ? down.before : changes[0].after).name,
  };
}
