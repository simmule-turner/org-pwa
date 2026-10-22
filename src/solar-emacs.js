// A port of the sunrise and sunset computation in Emacs's solar.el (Emacs 29.3), so that the times agree with Emacs to the minute.

import { absoluteFromGregorian } from './calendar-conv.js';

const RAD = Math.PI / 180;
const SOLAR_ERROR = 0.5; // solar-error, in minutes

/** @param {number} x */
const mod = (x, y = 360) => x - y * Math.floor(x / y);
/** @param {number} x */
const sinD = (x) => Math.sin(mod(x) * RAD);
/** @param {number} x */
const cosD = (x) => Math.cos(mod(x) * RAD);
/** @param {number} x */
const tanD = (x) => Math.tan(mod(x) * RAD);
/** @param {number} angle */
const quadrantOfAngle = (angle) => 1 + Math.floor(mod(angle) / 90);
/** @param {number} x @param {number} y */
const quadrantOfXY = (x, y) => (x > 0 ? (y > 0 ? 1 : 4) : y > 0 ? 2 : 3);
/** @param {number} x @param {number} quad */
function arctan(x, quad) {
  const deg = Math.atan(x) / RAD;
  if (quad === 2 || quad === 3) return deg + 180;
  if (quad === 4) return deg + 360;
  return deg;
}
/** @param {number} x @param {number} y */
function atn2(x, y) {
  if (x === 0) return y > 0 ? 90 : 270;
  return arctan(y / x, quadrantOfXY(x, y));
}
/** @param {number} y */
function arcsin(y) {
  return atn2(Math.sqrt(1 - y * y), y);
}

/** @param {number} abs */
const astroFromAbsolute = (abs) => abs + 1721424.5;

/** Ephemeris time minus universal time during Gregorian `year`, in days.
 * @param {number} year */
function ephemerisCorrection(year) {
  /** @param {number} y */
  const theta = (y) => (astroFromAbsolute(absoluteFromGregorian([7, 1, y])) - astroFromAbsolute(absoluteFromGregorian([1, 1, 1900]))) / 36525;
  if (year >= 1988 && year < 2020) return (year - 2000 + 67) / 60 / 60 / 24;
  if (year >= 1900 && year < 1988) {
    const t = theta(year), t2 = t * t, t3 = t2 * t, t4 = t2 * t2, t5 = t3 * t2;
    return -0.00002 + 0.000297 * t + 0.025184 * t2 - 0.181133 * t3 + 0.55304 * t4 - 0.861938 * t5 + 0.677066 * t3 * t3 - 0.212591 * t4 * t3;
  }
  if (year >= 1800 && year < 1900) {
    const t = theta(year), t2 = t * t, t3 = t2 * t, t4 = t2 * t2, t5 = t3 * t2;
    return -0.000009 + 0.003844 * t + 0.083563 * t2 + 0.865736 * t3 + 4.867575 * t4 + 15.845535 * t5 + 31.332267 * t3 * t3
      + 38.291999 * t4 * t3 + 28.316289 * t4 * t4 + 11.636204 * t4 * t5 + 2.043794 * t5 * t5;
  }
  if (year >= 1620 && year < 1800) {
    const x = (year - 1600) / 10;
    return (2.19167 * x * x - 40.675 * x + 196.58333) / 60 / 60 / 24;
  }
  const tmp = astroFromAbsolute(absoluteFromGregorian([1, 1, year])) - 2382148;
  return ((tmp * tmp) / 41048480 - 15) / 60 / 60 / 24;
}

/** @param {number} t0 @param {number} ut */
function ephemerisTime(t0, ut) {
  const t1 = t0 + ut / 24 / 36525;
  const y = 2000 + 100 * t1;
  const dt = 86400 * ephemerisCorrection(Math.floor(y));
  return t1 + dt / 86400 / 36525;
}

/** [apparent longitude, inclination, equation of time (hours), nutation (seconds)].
 * @param {number} time @param {boolean} sunriseFlag
 * @returns {[number, number, number, number]} */
function eclipticCoordinates(time, sunriseFlag) {
  const l = 280.46645 + 36000.76983 * time + 0.0003032 * time * time;
  const ml = 218.3165 + 481267.8813 * time;
  const m = 357.5291 + 35999.0503 * time - 0.0001559 * time * time - 0.00000048 * time * time * time;
  const i = 23.43929111 - 0.013004167 * time - 0.00000016389 * time * time + 0.0000005036 * time * time * time;
  const c = (1.9146 - 0.004817 * time - 0.000014 * time * time) * sinD(m) + (0.019993 - 0.000101 * time) * sinD(2 * m) + 0.00029 * sinD(3 * m);
  const L = l + c;
  const omega = 125.04 - 1934.136 * time;
  const nut = sunriseFlag ? 0 : -17.2 * sinD(omega) - 1.32 * sinD(2 * l) - 0.23 * sinD(2 * ml) + 0.21 * sinD(2 * omega);
  const ecc = sunriseFlag ? 0 : 0.016708617 - 0.000042037 * time - 0.0000001236 * time * time;
  const app = L - 0.00569 - 0.00478 * sinD(omega);
  const y = sunriseFlag ? 0 : tanD(i / 2) * tanD(i / 2);
  const timeEq = sunriseFlag ? 0
    : (12 * (y * sinD(2 * l) - 2 * ecc * sinD(m) + 4 * ecc * y * sinD(m) * cosD(2 * l) - 0.5 * y * y * sinD(4 * l) - 1.25 * ecc * ecc * sinD(2 * m))) / Math.PI;
  return [app, i, timeEq, nut];
}

/** @param {number} t0 */
function siderealTime(t0) {
  const mean = 6.6973746 + 2400.051337 * t0 + 0.0000258622 * t0 * t0 - 0.0000000017222 * t0 * t0 * t0;
  const [, i, , nut] = eclipticCoordinates(ephemerisTime(t0, 0), false);
  return mod(mod(mean + (nut * cosD(i)) / 15 / 3600, 24) + 24, 24);
}

/** Height of the sun, in degrees.
 * @param {number} t0 @param {number} ut @param {number} latitude @param {number} longitude @param {number} sidereal */
function sunHeight(t0, ut, latitude, longitude, sidereal) {
  const [lon, incl] = eclipticCoordinates(ephemerisTime(t0, ut), true);
  const quad = quadrantOfAngle(lon);
  const rightAscension = arctan(cosD(incl) * tanD(lon), quad) / 15;
  const de = arcsin(sinD(incl) * sinD(lon));
  const st = sidereal + ut * 1.00273790935;
  const ah = st * 15 - 15 * rightAscension + longitude;
  let height = arcsin(sinD(latitude) * sinD(de) + cosD(latitude) * cosD(de) * cosD(ah));
  if (height > 180) height -= 360;
  return height;
}

/** @param {number} direction @param {number} latitude @param {number} longitude @param {number} t0 @param {number} ut @param {number} height @param {number} sidereal
 * @returns {number | null} */
function moment(direction, latitude, longitude, t0, ut, height, sidereal) {
  let utmin = ut + direction * 12;
  let utmax = ut;
  let old = utmin;
  let cur = utmax;
  const hmin = sunHeight(t0, utmin, latitude, longitude, sidereal);
  const hmax = sunHeight(t0, utmax, latitude, longitude, sidereal);
  if (!(hmin < height && hmax > height)) return null;
  while (Math.abs(cur - old) >= SOLAR_ERROR / 60) {
    old = cur;
    cur = (utmin + utmax) / 2;
    const hut = sunHeight(t0, cur, latitude, longitude, sidereal);
    if (hut < height) utmin = cur;
    if (hut > height) utmax = cur;
  }
  return cur;
}

/** Sunrise, sunset and daylight length by solar.el's search, for the Gregorian date (`month`, `day`, `year`) at the given place.
 *  `zoneMinutes` is the standard time zone in minutes east of UTC. The results are in standard local time (hours, not yet rounded
 *  and not adjusted for daylight saving time), taken as hours of that date, as solar.el does; `null` for an event that does not happen.
 * @param {number} month @param {number} day @param {number} year @param {number} latitude @param {number} longitude @param {number} zoneMinutes @param {number} [height]
 * @returns {{ rise: number | null, set: number | null, length: number }} */
function emacsSunriseSunset(month, day, year, latitude, longitude, zoneMinutes, height = -0.61) {
  // Exact local noon: universal time of noon at the longitude, less the equation of time.
  const abs = absoluteFromGregorian([month, day, year]);
  const t = (abs - (absoluteFromGregorian([1, 1, 2000]) + 0.5)) / 36525;
  let ut = 12 - longitude / 15;
  ut -= eclipticCoordinates(ephemerisTime(t, ut), false)[2];
  let noonAbs = abs;
  if (ut >= 24) { noonAbs += 1; ut -= 24; }
  if (ut < 0) { noonAbs -= 1; ut += 24; }
  const t0 = (noonAbs - (absoluteFromGregorian([1, 1, 2000]) + 0.5)) / 36525;
  const sidereal = siderealTime(t0);

  /** @param {number} lat @param {number} h @param {boolean} summer */
  const riseAndSet = (lat, h, summer) => {
    const rise = moment(-1, lat, longitude, t0, ut, h, sidereal);
    const set = moment(1, lat, longitude, t0, ut, h, sidereal);
    let length;
    if (rise === null || set === null) length = (lat > 0 && summer) || (lat < 0 && !summer) ? 24 : 0;
    else length = set - rise;
    return { rise, set, length };
  };
  const equator = riseAndSet(1, 0, false);
  const summer = equator.length > 12;
  const r = riseAndSet(latitude, height, summer);
  /** @param {number | null} u */
  const local = (u) => (u === null ? null : u + zoneMinutes / 60);
  return { rise: local(r.rise), set: local(r.set), length: r.length };
}

export { emacsSunriseSunset };
