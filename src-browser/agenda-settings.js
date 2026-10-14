// @ts-check
// The settings the agenda evaluates its sexp lines with (sun times, weather): where you are, how times are written, the weather
// last fetched and how it is shown. The Agenda, the calendar export and the CalDAV sync all take them from here, so a
// <%%(…)> line reads the same in all three.
import { getCalendarLatitude, getCalendarLongitude, getOrgWeatherFormat, getOrgWeatherSpeedUnit, getOrgWeatherTemperatureUnit, getSolarAmpm, getSolarHideLabel } from '../src/local-variables.js';
import { S } from './app-state.js';

export function agendaSexpOptions() {
  const vars = S.state.localVariables;
  return {
    calendarLatitude: getCalendarLatitude(vars),
    calendarLongitude: getCalendarLongitude(vars),
    solarAmpm: getSolarAmpm(vars),
    solarHideLabel: getSolarHideLabel(vars),
    weatherData: S.weatherData,
    orgWeatherFormat: getOrgWeatherFormat(vars),
    orgWeatherTemperatureUnit: getOrgWeatherTemperatureUnit(vars),
    orgWeatherSpeedUnit: getOrgWeatherSpeedUnit(vars),
  };
}
