// @ts-check
// The settings the agenda evaluates its sexp lines with (sun times, weather): where you are, how times are written, the weather
// last fetched and how it is shown. The Agenda, the calendar export and the CalDAV sync all take them from here, so a
// <%%(…)> line reads the same in all three.
import { getTimeDisplayForm, getCalendarLatitude, getCalendarLongitude, getOrgWeatherFormat, getOrgWeatherSpeedUnit, getOrgWeatherTemperatureUnit, getCalendarDateStyle } from '../src/local-variables.js';
import { S } from './app-state.js';
import { diarySource } from './diary-file-load.js';

/** Minutes before a timed event that its calendar alarm goes off: appt-message-warning-time, the same lead time as the app's own
 * agenda notifications (12 as in Emacs until the settings load). */
export function calendarAlarmMinutes() {
  const n = /** @type {number} */ (S.apptSettings && S.apptSettings['appt-message-warning-time']);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export function agendaSexpOptions() {
  const vars = S.state.localVariables;
  return {
    calendarLatitude: getCalendarLatitude(vars),
    calendarLongitude: getCalendarLongitude(vars),
    calendarDateStyle: getCalendarDateStyle(vars),
    calendarTimeDisplayForm: getTimeDisplayForm(vars),
    diary: diarySource(), // org-agenda-include-diary: the diary file's entries and the day's holidays, once the file is read
    weatherData: S.weatherData,
    orgWeatherFormat: getOrgWeatherFormat(vars),
    orgWeatherTemperatureUnit: getOrgWeatherTemperatureUnit(vars),
    orgWeatherSpeedUnit: getOrgWeatherSpeedUnit(vars),
  };
}
