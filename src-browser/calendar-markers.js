// @ts-check
// Which days of a month have something on them, for the calendar panel and the calendar of the date prompt: the agenda's own items (the same
// pipeline as the Agenda view, so a day's colour here is what Agenda shows for it).
import { buildAgendaItems, itemsInRange } from '../src/agenda.js';
import { buildDayMarkers } from '../src/calendar-grid.js';
import { getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees } from '../src/local-variables.js';
import { dateKey } from '../src/org-timestamp.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { agendaFileDocs, contactsDocsForAgenda } from './agenda-files.js';
import { S } from './app-state.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';

/** The markers of the days of `month` (0-11) of `year`: birthdays and anniversaries (hasBirthday) and any other event (hasOther), keyed by `dateKey`.
 *  "Other event" leaves out the diary-sexp kinds that fall on almost every day (sunrise, sunset, day length, weather) and logbook entries.
 *  @param {number} year @param {number} month */
export function monthDayMarkers(year, month) {
  // One agenda computation for the whole visible month, reusing the
  // exact same pipeline the main Agenda view uses (buildAgendaItems
  // over agendaFileDocs' own cross-file doc list, the same
  // done/commented/archived filtering) so a day's own color here
  // always matches what Agenda would actually show for it -- not a
  // separate, potentially-drifting computation. "Other event" here
  // deliberately excludes the ambient, every-day diary-sexp kinds
  // (sunrise/sunset/civil-*/day-length/weather) and logbook entries:
  // those would color almost every day if configured, making the
  // green/blue/orange distinction meaningless.
  const monthRangeStart = new Date(year, month, 1);
  const monthRangeEnd = new Date(year, month + 1, 0);
  const monthTodoSequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const monthAgendaDocs = agendaFileDocs();
  const monthItems = buildAgendaItems(monthAgendaDocs, {
    contactsDocs: contactsDocsForAgenda(monthAgendaDocs),
    todoFilter: (/** @type {string} */ todo) => !monthTodoSequence.doneKeywords.includes(todo),
    includeCommented: !getAgendaSkipCommentTrees(S.state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(S.state.localVariables),
    rangeStart: monthRangeStart,
    rangeEnd: monthRangeEnd,
    isDone: (/** @type {string} */ todo) => monthTodoSequence.doneKeywords.includes(todo),
  });
  return buildDayMarkers(itemsInRange(monthItems, monthRangeStart, monthRangeEnd));
}

/** The markers of the month as a lookup by day, for the calendar of the date prompt. @param {number} year @param {number} month @returns {(date: Date) => { hasBirthday?: boolean, hasOther?: boolean } | undefined} */
export function dayMarkerLookup(year, month) {
  const markers = monthDayMarkers(year, month);
  return (date) => markers.get(dateKey(date));
}
