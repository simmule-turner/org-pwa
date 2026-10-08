// Extracted from app.js: calendar panel.
import { buildAgendaItems, itemsInRange } from '../src/agenda.js';
import { MONTH_NAMES, buildDayMarkers, buildMonthGrid, stepMonth, stepYear } from '../src/calendar-grid.js';
import { getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees } from '../src/local-variables.js';
import { dateKey } from '../src/org-timestamp.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { aggregateAgendaDocs, contactsDocsForAgenda } from './agenda-files.js';
import { S } from './app-state.js';
import { closeAllOverlayPanels } from './chrome.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { showModalOverlay } from './dialogs.js';
import { refilePanel, refilePanelBox } from './dom.js';
import { render } from './render.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { switchToView } from './views.js';

/** The palette's Calendar command (its real Emacs name is `calendar`, which is
 *  also what an Extras-menu entry names it: 'calendar) --
 *  opens the single-month calendar overview, initializing the
 *  displayed month/year to today's own if this is the first time it's
 *  been opened this session (a later re-open remembers wherever it
 *  was last left, see calendarViewYear/Month's own docs above). */
export function openCalendarPanel() {
  const today = new Date();
  if (S.calendarViewYear === null) {
    S.calendarViewYear = today.getFullYear();
    S.calendarViewMonth = today.getMonth();
  }
  closeAllOverlayPanels();
  S.calendarOpen = true;
  render();
  renderCalendarPanel();
}

/** Renders the single-month calendar into refilePanel -- year nav
 *  («/»), month nav (‹/›), a Today jump, a Sunday-first weekday
 *  header, and the day grid itself (buildMonthGrid's own output, laid
 *  out as a 7-column CSS grid). Tapping a real day closes the
 *  calendar and jumps straight to Agenda's own Day view, anchored on
 *  that date -- see this function's own call to switchToView('agenda')
 *  below for the full reasoning already discussed: this is always
 *  mechanically possible regardless of backend or what's currently
 *  open, unlike several of this app's other cross-file features, so
 *  there's no gating/fallback needed the way Attachments or cross-
 *  file Archive/Refile have. */
export function renderCalendarPanel() {
  refilePanelBox.innerHTML = '';
  if (!S.calendarOpen) {
    hideModalOverlay(refilePanel);
    return;
  }
  showModalOverlay(refilePanel);

  const today = new Date();

  // One agenda computation for the whole visible month, reusing the
  // exact same pipeline the main Agenda view uses (buildAgendaItems
  // over aggregateAgendaDocs' own cross-file doc list, the same
  // done/commented/archived filtering) so a day's own color here
  // always matches what Agenda would actually show for it -- not a
  // separate, potentially-drifting computation. "Other event" here
  // deliberately excludes the ambient, every-day diary-sexp kinds
  // (sunrise/sunset/civil-*/day-length/weather) and logbook entries:
  // those would color almost every day if configured, making the
  // green/blue/orange distinction meaningless.
  const monthRangeStart = new Date(S.calendarViewYear, S.calendarViewMonth, 1);
  const monthRangeEnd = new Date(S.calendarViewYear, S.calendarViewMonth + 1, 0);
  const monthTodoSequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const monthAgendaDocs = aggregateAgendaDocs();
  const monthItems = buildAgendaItems(monthAgendaDocs, {
    contactsDocs: contactsDocsForAgenda(monthAgendaDocs),
    todoFilter: (todo) => !monthTodoSequence.doneKeywords.includes(todo),
    includeCommented: !getAgendaSkipCommentTrees(S.state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(S.state.localVariables),
    rangeStart: monthRangeStart,
    rangeEnd: monthRangeEnd,
    isDone: (todo) => monthTodoSequence.doneKeywords.includes(todo),
  });
  const dayMarkers = buildDayMarkers(itemsInRange(monthItems, monthRangeStart, monthRangeEnd));

  // Row 1: year navigation.
  const yearRow = document.createElement('div');
  yearRow.style.display = 'flex';
  yearRow.style.alignItems = 'center';
  yearRow.style.justifyContent = 'space-between';
  yearRow.style.marginBottom = '4px';
  yearRow.appendChild(
    menuButton('\u00ab', () => {
      ({ year: S.calendarViewYear, month: S.calendarViewMonth } = stepYear(S.calendarViewYear, S.calendarViewMonth, -1));
      renderCalendarPanel();
    })
  );
  const yearLabel = document.createElement('div');
  yearLabel.style.fontWeight = '700';
  yearLabel.textContent = String(S.calendarViewYear);
  yearRow.appendChild(yearLabel);
  yearRow.appendChild(
    menuButton('\u00bb', () => {
      ({ year: S.calendarViewYear, month: S.calendarViewMonth } = stepYear(S.calendarViewYear, S.calendarViewMonth, 1));
      renderCalendarPanel();
    })
  );
  refilePanelBox.appendChild(yearRow);

  // Row 2: month navigation.
  const monthRow = document.createElement('div');
  monthRow.style.display = 'flex';
  monthRow.style.alignItems = 'center';
  monthRow.style.justifyContent = 'space-between';
  monthRow.style.marginBottom = '8px';
  monthRow.appendChild(
    menuButton('\u2039', () => {
      ({ year: S.calendarViewYear, month: S.calendarViewMonth } = stepMonth(S.calendarViewYear, S.calendarViewMonth, -1));
      renderCalendarPanel();
    })
  );
  const monthLabel = document.createElement('div');
  monthLabel.style.fontSize = '13px';
  monthLabel.textContent = MONTH_NAMES[S.calendarViewMonth];
  monthRow.appendChild(monthLabel);
  monthRow.appendChild(
    menuButton('\u203a', () => {
      ({ year: S.calendarViewYear, month: S.calendarViewMonth } = stepMonth(S.calendarViewYear, S.calendarViewMonth, 1));
      renderCalendarPanel();
    })
  );
  refilePanelBox.appendChild(monthRow);

  // Weekday header (Sunday-first, matching buildMonthGrid's own docs).
  const weekdayHeader = document.createElement('div');
  weekdayHeader.style.display = 'grid';
  weekdayHeader.style.gridTemplateColumns = 'repeat(7, 1fr)';
  weekdayHeader.style.fontSize = '11px';
  weekdayHeader.style.opacity = '0.6';
  weekdayHeader.style.textAlign = 'center';
  weekdayHeader.style.marginBottom = '2px';
  for (const label of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
    const cell = document.createElement('div');
    cell.textContent = label;
    weekdayHeader.appendChild(cell);
  }
  refilePanelBox.appendChild(weekdayHeader);

  // The day grid itself.
  const dayGrid = document.createElement('div');
  dayGrid.style.display = 'grid';
  dayGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  dayGrid.style.gap = '2px';
  for (const cellData of buildMonthGrid(S.calendarViewYear, S.calendarViewMonth, today)) {
    const cell = document.createElement('div');
    if (!cellData) {
      dayGrid.appendChild(cell);
      continue;
    }
    cell.style.textAlign = 'center';
    cell.style.padding = '8px 0';
    cell.style.borderRadius = '6px';
    cell.style.cursor = 'pointer';
    const marker = dayMarkers.get(dateKey(cellData.date));
    if (marker && marker.hasBirthday && marker.hasOther) {
      cell.style.background = '#CC5500'; // burnt orange
      cell.style.color = '#fff';
    } else if (marker && marker.hasBirthday) {
      cell.style.background = '#2E8B57'; // green
      cell.style.color = '#fff';
    } else if (marker && marker.hasOther) {
      cell.style.background = '#3B6EA5'; // blue
      cell.style.color = '#fff';
    }
    if (cellData.isToday) {
      cell.style.fontWeight = '700';
      // A two-color "halo" ring (black outer, white inner) via genuine
      // `border` on two real, nested elements -- not box-shadow, which
      // has a known history of rendering quirks on some Android
      // WebView versions, particularly combined with border-radius
      // (reported: this app's own earlier box-shadow-based attempt
      // showed no visible change at all on Android despite working
      // correctly on iOS). `border` is the single most universally,
      // unambiguously supported CSS property there is. Still
      // guaranteed visible against any background -- the plain panel
      // in either theme, or any of the three event colors above --
      // since at least one of white/black always has strong contrast
      // against whatever's beneath it.
      cell.textContent = '';
      cell.style.boxSizing = 'border-box';
      cell.style.border = '2px solid #000';
      cell.style.padding = '4px 0';
      const inner = document.createElement('div');
      inner.textContent = String(cellData.day);
      inner.style.boxSizing = 'border-box';
      inner.style.border = '2px solid #fff';
      inner.style.borderRadius = '4px';
      inner.style.padding = '2px 0';
      cell.appendChild(inner);
    } else {
      cell.textContent = String(cellData.day);
    }
    cell.onclick = () => {
      S.agendaViewType = 'day';
      S.agendaAnchorDate = cellData.date;
      S.calendarOpen = false;
      renderCalendarPanel();
      switchToView('agenda');
      render();
    };
    dayGrid.appendChild(cell);
  }
  refilePanelBox.appendChild(dayGrid);

  // Row 3: Today jump / Close.
  const bottomRow = document.createElement('div');
  bottomRow.className = 'panel-row';
  bottomRow.style.marginTop = '8px';
  bottomRow.appendChild(
    menuButton('Today', () => {
      const now = new Date();
      S.calendarViewYear = now.getFullYear();
      S.calendarViewMonth = now.getMonth();
      renderCalendarPanel();
    })
  );
  bottomRow.appendChild(
    menuButton('Close', () => {
      S.calendarOpen = false;
      renderCalendarPanel();
    })
  );
  refilePanelBox.appendChild(bottomRow);
}
