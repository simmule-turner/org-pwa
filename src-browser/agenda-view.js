// Extracted from app.js: agenda view.
import { applyAgendaEffortView, buildAgendaItems, buildTaskList, dayView, endOfDay, itemEffortText, monthView, startOfDay, startOfWeek, weekView } from '../src/agenda.js';
import { formatClockDuration, totalClockedMinutes } from '../src/clock.js';
import { computeClocktable, renderClocktable } from '../src/clocktable.js';
import { DEFAULT_EFFORT_FILTER_VALUES, getAllowedEffortValues } from '../src/effort-values.js';
import { getAgendaShowAllDates, getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getAgendaStartOnWeekday, getCalendarLatitude, getCalendarLongitude, getContactsBirthdayProperty, getDeadlineWarningDays, getGlobalProperties, getOrgWeatherFormat, getOrgWeatherSpeedUnit, getOrgWeatherTemperatureUnit, getScheduledDelayDays, getSolarAmpm, getSolarHideLabel } from '../src/local-variables.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { aggregateAgendaDocs, contactsDocsForAgenda, ensureAgendaFilesLoaded, refreshAgendaFiles } from './agenda-files.js';
import { extensionAgendaItems, extensionAgendaLines } from './extension-flow.js';
import { agendaItemKindLabel, agendaStepAnchor, buildDayHeaderRow, formatAgendaItemTimeText, formatAgendaRangeLabel } from './agenda-format.js';
import { S } from './app-state.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { contentAreaEl, outlineEl } from './dom.js';
import { setStatus } from './editing.js';
import { dateInputValue } from './field-groups.js';
import { attachAgendaSwipeNav } from './gestures-structure.js';
import { navigateToHeadingByPath, outlinePathForHeadingInDocument } from './navigation.js';
import { render } from './render.js';
import { agendaFilesCache } from './singletons.js';
import { menuButton, textInputStyle } from './ui-widgets.js';
import { platform } from './platform.js';

export function agendaRangeFor(viewType, anchorDate) {
  if (viewType === 'day') {
    return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) };
  }
  if (viewType === 'week') {
    const startOnWeekday = getAgendaStartOnWeekday(S.state.localVariables);
    const start = startOfWeek(anchorDate, startOnWeekday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end: endOfDay(end) };
  }
  // month
  const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const end = endOfDay(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0));
  return { start, end };
}

/** The Agenda's effort view, or null when nothing is set. */
export function currentAgendaEffortView() {
  if (!S.agendaEffortSort && !S.agendaEffortFilter && !S.agendaEffortMax) return null;
  return { sort: S.agendaEffortSort, filter: S.agendaEffortFilter, maxMinutes: S.agendaEffortMax ? S.agendaEffortMax.minutes : null };
}

/** Sort / filter / per-day limit by effort -- org's `effort-up` and
 *  `effort-down` sorting, its `_` filter and org-agenda-max-effort, in one
 *  small panel behind the toolbar's clock button. The rules (inclusive < and
 *  >, the limit keeping a prefix, no-effort counting as high effort) live in
 *  src/agenda.js. The filter's values are the Effort_ALL list when one is
 *  defined, else the set org-agenda-filter-by-effort itself falls back on. */
export function buildAgendaEffortPanel() {
  const panel = document.createElement('div');
  panel.setAttribute('data-agenda-effort-panel', '');
  panel.style.border = '1px solid var(--border-strong)';
  panel.style.borderRadius = '8px';
  panel.style.padding = '8px 10px';
  panel.style.marginBottom = '8px';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '8px';
  panel.style.fontSize = '13px';

  const styleControl = (el) => {
    el.style.font = 'inherit';
    el.style.fontSize = '14px';
    el.style.padding = '6px 8px';
    el.style.border = '1px solid var(--border-strong)';
    el.style.borderRadius = '6px';
    el.style.background = 'var(--bg)';
    el.style.color = 'var(--fg)';
  };
  const row = (labelText, ...controls) => {
    const r = document.createElement('div');
    r.style.display = 'flex';
    r.style.flexWrap = 'wrap';
    r.style.alignItems = 'center';
    r.style.gap = '6px';
    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.minWidth = '64px';
    label.style.opacity = '0.75';
    r.appendChild(label);
    for (const c of controls) r.appendChild(c);
    panel.appendChild(r);
  };
  const select = (options, current, onChange) => {
    const el = document.createElement('select');
    for (const [value, text] of options) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      el.appendChild(o);
    }
    el.value = current;
    styleControl(el);
    el.onchange = () => onChange(el.value);
    return el;
  };

  const sortSelect = select(
    [['', 'Off'], ['up', 'Least effort first'], ['down', 'Most effort first']],
    S.agendaEffortSort || '',
    (v) => {
      S.agendaEffortSort = v || null;
      render();
    }
  );
  sortSelect.setAttribute('data-effort-sort', '');
  row('Sort', sortSelect);

  const allowed = getAllowedEffortValues({ doc: S.state.doc, globalProperties: getGlobalProperties(S.state.localVariables) });
  const values = allowed.length > 0 ? allowed : DEFAULT_EFFORT_FILTER_VALUES;
  const applyFilter = (op, text) => {
    S.agendaEffortFilter = op && text ? { op, minutes: parseOrgDuration(text), text } : null;
    render();
  };
  const filterOp = select(
    [['', 'Off'], ['<', 'At most'], ['>', 'At least'], ['=', 'Exactly']],
    S.agendaEffortFilter ? S.agendaEffortFilter.op : '',
    (op) => applyFilter(op, valueSelect.value)
  );
  filterOp.setAttribute('data-effort-filter-op', '');
  const valueSelect = select(
    values.map((v) => [v, v]),
    S.agendaEffortFilter && values.includes(S.agendaEffortFilter.text) ? S.agendaEffortFilter.text : values[0],
    (text) => applyFilter(filterOp.value, text)
  );
  valueSelect.setAttribute('data-effort-filter-value', '');
  row('Filter', filterOp, valueSelect);

  const maxInput = document.createElement('input');
  maxInput.type = 'text';
  maxInput.placeholder = 'e.g. 4:00';
  maxInput.value = S.agendaEffortMax ? S.agendaEffortMax.text : '';
  maxInput.setAttribute('data-effort-max', '');
  maxInput.setAttribute('autocapitalize', 'off');
  maxInput.style.width = '96px';
  styleControl(maxInput);
  maxInput.onchange = () => {
    const text = maxInput.value.trim();
    if (text === '') {
      S.agendaEffortMax = null;
    } else if (parseOrgDuration(text) !== null) {
      S.agendaEffortMax = { minutes: parseOrgDuration(text), text };
    } else {
      setStatus('Not a valid duration (try 4:00, 90min, or 3h) \u2014 limit not changed.');
      maxInput.value = S.agendaEffortMax ? S.agendaEffortMax.text : '';
      return;
    }
    render();
  };
  const perDay = document.createElement('span');
  perDay.textContent = 'per day';
  perDay.style.opacity = '0.6';
  row('Max', maxInput, perDay);

  const note = document.createElement('div');
  note.textContent = 'A task with no effort counts as high effort. The limit keeps tasks until the running total passes the maximum.';
  note.style.fontSize = '11px';
  note.style.opacity = '0.6';
  panel.appendChild(note);

  if (currentAgendaEffortView()) {
    const resetRow = document.createElement('div');
    resetRow.appendChild(
      menuButton('Reset', () => {
        S.agendaEffortSort = null;
        S.agendaEffortFilter = null;
        S.agendaEffortMax = null;
        render();
      })
    );
    panel.appendChild(resetRow);
  }
  return panel;
}

export function renderAgendaView() {
  ensureAgendaFilesLoaded();
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';
  // Extends the swipe-capture area (attachAgendaSwipeNav, below) across
  // the full visible viewport, not just this container's own content --
  // otherwise a swipe below the last agenda entry lands on the parent
  // instead, which has no swipe listener at all. contentAreaEl (this
  // app's own actual scroll/sizing wrapper, in both narrow and wide
  // layout) has a real, JS-computed pixel height; a CSS percentage here
  // doesn't work, since #outline itself (this container's own direct
  // parent) has no defined height in narrow layout at all.
  container.style.minHeight = contentAreaEl.clientHeight + 'px';

  const effectiveShowAllDates = S.agendaShowAllDatesOverride !== null ? S.agendaShowAllDatesOverride : getAgendaShowAllDates(S.state.localVariables);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '6px';
  controls.style.alignItems = 'center';
  controls.style.marginBottom = '10px';
  controls.style.flexWrap = 'wrap';

  function agendaControlBtn(label, onClick, isActive, ariaLabel) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.style.fontSize = '15px';
    btn.style.padding = '10px 14px';
    btn.style.minHeight = '44px';
    btn.style.fontWeight = isActive ? '700' : '400';
    btn.onclick = onClick;
    return btn;
  }

  const AGENDA_VIEW_CYCLE = ['day', 'week', 'month'];
  const AGENDA_VIEW_LABELS = { day: 'Day', week: 'Week', month: 'Month' };
  const viewToggleBtn = agendaControlBtn(AGENDA_VIEW_LABELS[S.agendaViewType], () => {
    const nextIndex = (AGENDA_VIEW_CYCLE.indexOf(S.agendaViewType) + 1) % AGENDA_VIEW_CYCLE.length;
    S.agendaViewType = AGENDA_VIEW_CYCLE[nextIndex];
    render();
  });
  viewToggleBtn.style.width = '64px'; // fixed -- fits "Month", the longest label, without the button's own size shifting as the label cycles
  viewToggleBtn.style.textAlign = 'center';
  viewToggleBtn.setAttribute('aria-label', 'Switch agenda view (currently ' + AGENDA_VIEW_LABELS[S.agendaViewType] + ')');
  controls.appendChild(viewToggleBtn);

  controls.appendChild(
    agendaControlBtn(
      '\u2039',
      () => {
        S.agendaAnchorDate = agendaStepAnchor(S.agendaViewType, S.agendaAnchorDate, -1);
        render();
      },
      false,
      'Previous ' + S.agendaViewType
    )
  );

  controls.appendChild(
    agendaControlBtn('Today', () => {
      S.agendaAnchorDate = new Date();
      render();
    })
  );

  controls.appendChild(
    agendaControlBtn(
      '\u203a',
      () => {
        S.agendaAnchorDate = agendaStepAnchor(S.agendaViewType, S.agendaAnchorDate, 1);
        render();
      },
      false,
      'Next ' + S.agendaViewType
    )
  );

  if (S.agendaFilesConfig.length > 0) {
    controls.appendChild(
      agendaControlBtn(
        '\u21bb',
        () => refreshAgendaFiles(),
        false,
        'Refresh agenda files (re-fetch every configured file from its own source)'
      )
    );
  }

  controls.appendChild(
    agendaControlBtn(
      'g',
      () => {
        S.agendaShowAllDatesOverride = !effectiveShowAllDates;
        render();
      },
      !effectiveShowAllDates,
      effectiveShowAllDates
        ? 'Hide empty days (toggle org-agenda-show-all-dates)'
        : 'Show empty days (toggle org-agenda-show-all-dates)'
    )
  );

  controls.appendChild(
    agendaControlBtn(
      '\u23f1',
      () => {
        S.agendaEffortPanelOpen = !S.agendaEffortPanelOpen;
        render();
      },
      currentAgendaEffortView() !== null || S.agendaEffortPanelOpen,
      'Sort, filter and limit the agenda by effort'
    )
  );

  container.appendChild(controls);

  const { start, end } = agendaRangeFor(S.agendaViewType, S.agendaAnchorDate);
  const rangeRow = document.createElement('div');
  rangeRow.style.display = 'flex';
  rangeRow.style.alignItems = 'center';
  rangeRow.style.justifyContent = 'space-between';
  rangeRow.style.gap = '8px';
  rangeRow.style.marginBottom = '8px';

  const rangeLabel = document.createElement('div');
  rangeLabel.style.fontSize = '12px';
  rangeLabel.style.opacity = '0.65';
  rangeLabel.textContent = formatAgendaRangeLabel(S.agendaViewType, start, end);
  rangeRow.appendChild(rangeLabel);

  const logToggle = document.createElement('label');
  logToggle.style.display = 'flex';
  logToggle.style.alignItems = 'center';
  logToggle.style.gap = '4px';
  logToggle.style.fontSize = '12px';
  logToggle.style.opacity = '0.8';
  logToggle.style.cursor = 'pointer';
  logToggle.style.flexShrink = '0';
  const logCheckbox = document.createElement('input');
  logCheckbox.type = 'checkbox';
  logCheckbox.checked = S.agendaLogMode;
  logCheckbox.onchange = () => {
    S.agendaLogMode = logCheckbox.checked;
    render();
  };
  logToggle.appendChild(logCheckbox);
  logToggle.appendChild(document.createTextNode('Log'));
  rangeRow.appendChild(logToggle);

  container.appendChild(rangeRow);
  for (const text of extensionAgendaLines()) {
    const line = document.createElement('div');
    line.style.fontSize = '12px';
    line.style.opacity = '0.85';
    line.style.marginBottom = '6px';
    line.textContent = text;
    container.appendChild(line);
  }
  if (S.agendaEffortPanelOpen) container.appendChild(buildAgendaEffortPanel());

  if (S.agendaFilesConfig.length > 0) {
    const entries = S.agendaFilesConfig.map((f) => agendaFilesCache.get(f));
    const loadingCount = entries.filter((e) => e && e.loading).length;
    const errored = S.agendaFilesConfig
      .map((f, i) => ({ f, entry: entries[i] }))
      .filter(({ entry }) => entry && entry.error);
    if (loadingCount > 0 || errored.length > 0) {
      const agendaFilesStatus = document.createElement('div');
      agendaFilesStatus.style.fontSize = '11px';
      agendaFilesStatus.style.marginBottom = '8px';
      const parts = [];
      if (loadingCount > 0) parts.push(`Loading ${loadingCount} agenda file${loadingCount === 1 ? '' : 's'}\u2026`);
      if (errored.length > 0) {
        agendaFilesStatus.style.color = '#c0392b';
        parts.push(errored.map(({ f, entry }) => `"${f}": ${entry.error}`).join('; '));
      }
      agendaFilesStatus.textContent = parts.join(' ');
      container.appendChild(agendaFilesStatus);
    }
  }

  // Completed items excluded, using this file's own #+TODO: sequence
  // (not a hardcoded "DONE" check) — and the range is passed through so
  // any repeating SCHEDULED/DEADLINE timestamp expands into every
  // occurrence that actually falls within what's being displayed.
  const todoSequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const agendaDocs = aggregateAgendaDocs();
  const items = buildAgendaItems(agendaDocs, {
    contactsDocs: contactsDocsForAgenda(agendaDocs), // org-contacts-files, as in Emacs (null: scan the agenda's own documents)
    includeLogbook: S.agendaLogMode,
    todoFilter: (todo) => !todoSequence.doneKeywords.includes(todo),
    // Real org's default is to skip both commented headings (title
    // starts with "# ") and archived ones (:ARCHIVE: tag) in agenda
    // views — org-agenda-skip-comment-trees / org-agenda-skip-archived-
    // trees, both t by default. Overridable per-file via a Local
    // Variables block (set either to nil to include them after all).
    includeCommented: !getAgendaSkipCommentTrees(S.state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(S.state.localVariables),
    rangeStart: start,
    rangeEnd: end,
    // Carry-forward: an incomplete SCHEDULED/DEADLINE keeps appearing on
    // every day from its date through today, matching real org-mode's
    // actual behavior (a plain title timestamp never does this, by
    // design — see agenda.js). `today` is the real current date, not
    // agendaAnchorDate, which is just whatever date the user is
    // currently navigating to look at.
    isDone: (todo) => todoSequence.doneKeywords.includes(todo),
    today: new Date(),
    birthdayProperty: getContactsBirthdayProperty(S.state.localVariables),
    deadlineWarningDays: getDeadlineWarningDays(S.state.localVariables),
    scheduledDelayDays: getScheduledDelayDays(S.state.localVariables),
    calendarLatitude: getCalendarLatitude(S.state.localVariables),
    calendarLongitude: getCalendarLongitude(S.state.localVariables),
    solarAmpm: getSolarAmpm(S.state.localVariables),
    solarHideLabel: getSolarHideLabel(S.state.localVariables),
    weatherData: S.weatherData,
    orgWeatherFormat: getOrgWeatherFormat(S.state.localVariables),
    orgWeatherTemperatureUnit: getOrgWeatherTemperatureUnit(S.state.localVariables),
    orgWeatherSpeedUnit: getOrgWeatherSpeedUnit(S.state.localVariables),
  });
  items.push(...extensionAgendaItems(start, end));
  items.sort((a, b) => a.date - b.date);

  const groupedByDay =
    S.agendaViewType === 'day'
      ? dayView(items, S.agendaAnchorDate)
      : S.agendaViewType === 'week'
        ? weekView(items, S.agendaAnchorDate, getAgendaStartOnWeekday(S.state.localVariables))
        : monthView(items, S.agendaAnchorDate);
  // The effort view is applied here, once, so the rows, the empty-day
  // hiding below and each day's total all describe the same items.
  const effortView = currentAgendaEffortView();
  const grouped = effortView ? groupedByDay.map((day) => ({ ...day, items: applyAgendaEffortView(day.items, effortView) })) : groupedByDay;
  const visibleDays = effectiveShowAllDates ? grouped : grouped.filter((day) => day.items.length > 0);

  if (visibleDays.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '14px';
    empty.style.padding = '20px 0';
    empty.textContent = 'Nothing scheduled in this range.';
    container.appendChild(empty);
  }

  function buildAgendaItemRow(item) {
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.cursor = 'pointer';

    const categoryLabel = document.createElement('span');
    categoryLabel.textContent = item.category + ':';
    categoryLabel.style.flexShrink = '0';
    categoryLabel.style.opacity = '0.55';
    categoryLabel.style.fontSize = '12px';
    categoryLabel.style.minWidth = '52px';
    row.appendChild(categoryLabel);

    const kindIcon = document.createElement('span');
    // diary-sexp/sexp-timestamp gets no leading icon at all -- an
    // entry's own title is free-form (it's the sexp's own return
    // value, or the heading's own title), so a generic "this is a
    // repeating diary expression" icon in front of it just adds
    // visual noise without conveying anything the entry's own title
    // doesn't already.
    const isDiarySexpKind = item.kind === 'diary-sexp' || item.kind === 'sexp-timestamp';
    const kindIconText = isDiarySexpKind
      ? null
      : item.kind === 'deadline'
        ? '\u26a0'
        : item.kind === 'timestamp'
          ? '\ud83d\udcc5'
          : item.kind === 'anniversary'
            ? '\ud83c\udf82'
            : item.kind === 'logbook'
              ? '\ud83d\udcdd'
              : item.kind === 'sunrise' || item.kind === 'sunset' || item.kind === 'civil-dawn' || item.kind === 'civil-dusk' || item.kind === 'nautical-dawn' || item.kind === 'nautical-dusk' || item.kind === 'astronomical-dawn' || item.kind === 'astronomical-dusk' || item.kind === 'day-length' || item.kind === 'weather'
                ? '\u2600\ufe0f'
                : '\u23f0';
    kindIcon.textContent = kindIconText || '';
    kindIcon.style.flexShrink = '0';
    kindIcon.style.opacity = '0.6';
    kindIcon.style.fontSize = '1.3em';
    if (kindIconText) row.appendChild(kindIcon); // suppressed entirely (not just left empty) so the row's own gap spacing doesn't leave an awkward blank slot where the icon would have been

    const text = document.createElement('div');
    text.style.flex = '1 1 auto';
    text.style.minWidth = '0';
    if (item.todo && item.kind !== 'logbook') {
      const badge = document.createElement('span');
      badge.textContent = item.todo + ' ';
      badge.style.fontWeight = '700';
      badge.style.fontSize = '12px';
      text.appendChild(badge);
    }
    text.appendChild(document.createTextNode(item.title));
    if (item.logNote) {
      const noteLine = document.createElement('div');
      noteLine.style.fontSize = '12px';
      noteLine.style.opacity = '0.65';
      noteLine.style.fontStyle = 'italic';
      noteLine.textContent = item.logNote;
      text.appendChild(noteLine);
    }
    if (item.repeater) {
      const rep = document.createElement('span');
      rep.textContent = ' \u21bb';
      rep.style.opacity = '0.5';
      rep.style.fontSize = '12px';
      text.appendChild(rep);
    }
    const rowEffort = item.kind === 'scheduled' || item.kind === 'deadline' || item.kind === 'timestamp' ? itemEffortText(item) : null;
    if (rowEffort) {
      const effortBadge = document.createElement('span');
      effortBadge.setAttribute('data-item-effort', '');
      effortBadge.textContent = ` \u23f1 ${rowEffort}`;
      effortBadge.style.opacity = '0.6';
      effortBadge.style.fontSize = '12px';
      effortBadge.style.whiteSpace = 'nowrap';
      text.appendChild(effortBadge);
    }
    if (item.daysOverdue) {
      const overdue = document.createElement('span');
      overdue.style.fontSize = '12px';
      overdue.style.marginLeft = '6px';
      if (item.daysOverdue > 0) {
        overdue.style.color = '#c0392b';
        overdue.textContent = item.daysOverdue === 1 ? '1 day overdue' : item.daysOverdue + ' days overdue';
      } else {
        overdue.style.opacity = '0.6';
        const daysUntil = -item.daysOverdue;
        overdue.textContent = daysUntil === 1 ? 'due tomorrow' : 'due in ' + daysUntil + ' days';
      }
      text.appendChild(overdue);
    }
    row.appendChild(text);

    const kindLabel = agendaItemKindLabel(item);
    const timeText = formatAgendaItemTimeText(item);
    if (kindLabel || timeText) {
      const trailing = document.createElement('span');
      trailing.style.fontSize = '12px';
      trailing.style.opacity = '0.6';
      trailing.style.flexShrink = '0';
      trailing.textContent = kindLabel || timeText;
      row.appendChild(trailing);
    }

    row.onclick = () => {
      const outlinePath = outlinePathForHeadingInDocument(item.documentId, item.heading);
      if (outlinePath) navigateToHeadingByPath(item.documentId, outlinePath);
    };
    return row;
  }

  const AGENDA_GRID_HOURS = [8, 10, 12, 14, 16, 18, 20]; // real org's own documented org-agenda-time-grid default

  function buildAgendaGridLineRow(hour) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    row.style.padding = '4px 2px';
    row.style.opacity = '0.4';

    const label = document.createElement('span');
    label.textContent = String(hour).padStart(2, '0') + ':00';
    label.style.flexShrink = '0';
    label.style.minWidth = '40px';
    label.style.fontSize = '11px';
    row.appendChild(label);

    const line = document.createElement('div');
    line.style.flex = '1 1 auto';
    line.style.borderBottom = '1px dashed var(--border-strong)';
    row.appendChild(line);

    return row;
  }

  function renderDayViewTimeline(dayItems) {
    const untimed = dayItems.filter((i) => !i.hasTime);
    const timed = dayItems.filter((i) => i.hasTime).sort((a, b) => a.date - b.date);

    for (const item of untimed) {
      container.appendChild(buildAgendaItemRow(item));
    }

    let timedIdx = 0;
    for (const hour of AGENDA_GRID_HOURS) {
      while (timedIdx < timed.length && timed[timedIdx].date.getHours() < hour) {
        container.appendChild(buildAgendaItemRow(timed[timedIdx]));
        timedIdx++;
      }
      container.appendChild(buildAgendaGridLineRow(hour));
    }
    while (timedIdx < timed.length) {
      container.appendChild(buildAgendaItemRow(timed[timedIdx]));
      timedIdx++;
    }
  }

  for (const day of visibleDays) {
    const [wy, wm, wd] = day.date.split('-').map(Number);
    const dayDate = new Date(wy, wm - 1, wd);
    const isStartOfWeek = dayDate.getDay() === getAgendaStartOnWeekday(S.state.localVariables);
    const showWeekNumber = S.agendaViewType === 'day' || isStartOfWeek;
    container.appendChild(buildDayHeaderRow(day.date, showWeekNumber, day.items));

    if (S.agendaViewType === 'day') {
      renderDayViewTimeline(day.items);
    } else {
      for (const item of day.items) {
        container.appendChild(buildAgendaItemRow(item));
      }
    }
  }

  container.style.touchAction = 'pan-y';
  attachAgendaSwipeNav(container);
  outlineEl.appendChild(container);
}

export function buildClocktableSection() {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '10px';

  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = '0.5px solid var(--border-strong)';
  hr.style.margin = '2px 0 8px';
  wrap.appendChild(hr);

  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'panel-section-title';
  sectionTitle.textContent = '\u23f1\ufe0f Clocking';
  sectionTitle.style.marginBottom = '4px';
  wrap.appendChild(sectionTitle);

  const checkboxRow = document.createElement('div');
  checkboxRow.style.display = 'flex';
  checkboxRow.style.alignItems = 'center';
  checkboxRow.style.gap = '14px';

  const clockToggle = document.createElement('label');
  clockToggle.style.display = 'flex';
  clockToggle.style.alignItems = 'center';
  clockToggle.style.gap = '4px';
  clockToggle.style.fontSize = '13px';
  clockToggle.style.cursor = 'pointer';
  const clockCheckbox = document.createElement('input');
  clockCheckbox.type = 'checkbox';
  clockCheckbox.checked = S.showClockDisplay;
  clockCheckbox.onchange = () => {
    S.showClockDisplay = clockCheckbox.checked;
    render();
  };
  clockToggle.appendChild(clockCheckbox);
  clockToggle.appendChild(document.createTextNode('Per-item totals'));
  checkboxRow.appendChild(clockToggle);

  const reportToggle = document.createElement('label');
  reportToggle.style.display = 'flex';
  reportToggle.style.alignItems = 'center';
  reportToggle.style.gap = '6px';
  reportToggle.style.fontSize = '13px';
  reportToggle.style.cursor = 'pointer';
  const reportCheckbox = document.createElement('input');
  reportCheckbox.type = 'checkbox';
  reportCheckbox.checked = S.showClocktable;
  reportCheckbox.onchange = () => {
    S.showClocktable = reportCheckbox.checked;
    // Default to the last 7 days (including today) the FIRST time this
    // is checked with nothing picked yet -- shows something useful
    // immediately rather than an empty picker needing two taps before
    // any report appears at all. Once set, whatever's actually picked
    // is remembered rather than reset on every toggle.
    if (S.showClocktable && !S.clocktableStart && !S.clocktableEnd) {
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      S.clocktableStart = dateInputValue(weekAgo);
      S.clocktableEnd = dateInputValue(now);
    }
    render();
  };
  reportToggle.appendChild(reportCheckbox);
  reportToggle.appendChild(document.createTextNode('Report'));
  checkboxRow.appendChild(reportToggle);

  let rendered = null;
  if (S.showClocktable) {
    const result = computeClocktable(S.state.doc, S.clocktableStart, S.clocktableEnd, S.clocktableMaxlevel);
    rendered = renderClocktable(result, S.clocktableStart, S.clocktableEnd, new Date(), S.clocktableMaxlevel);

    const copyBtn = menuButton('\ud83d\udccb Copy', async () => {
      try {
        await platform.clipboard.writeText(rendered);
        setStatus('Clocktable copied to clipboard.');
      } catch {
        setStatus("Couldn't copy \u2014 your browser may not allow clipboard access here.");
      }
      render();
    });
    copyBtn.style.marginLeft = 'auto';
    checkboxRow.appendChild(copyBtn);
  }

  wrap.appendChild(checkboxRow);

  if (!S.showClocktable) return wrap;

  const reportNest = document.createElement('div');
  reportNest.style.marginTop = '4px';
  reportNest.style.paddingLeft = '10px';
  reportNest.style.borderLeft = '2px solid var(--border-strong)';
  wrap.appendChild(reportNest);

  const rangeRow = document.createElement('div');
  rangeRow.style.display = 'flex';
  rangeRow.style.gap = '8px';
  rangeRow.style.alignItems = 'center';
  rangeRow.style.marginTop = '6px';
  rangeRow.style.flexWrap = 'wrap';

  const startInput = document.createElement('input');
  startInput.type = 'date';
  textInputStyle(startInput);
  startInput.style.width = 'auto';
  startInput.style.webkitAppearance = 'none';
  startInput.style.appearance = 'none';
  startInput.value = S.clocktableStart;
  startInput.onchange = () => {
    S.clocktableStart = startInput.value;
    render();
  };
  rangeRow.appendChild(startInput);

  const toLabel = document.createElement('span');
  toLabel.textContent = '\u2013';
  toLabel.style.opacity = '0.6';
  rangeRow.appendChild(toLabel);

  const endInput = document.createElement('input');
  endInput.type = 'date';
  textInputStyle(endInput);
  endInput.style.width = 'auto';
  endInput.style.webkitAppearance = 'none';
  endInput.style.appearance = 'none';
  endInput.value = S.clocktableEnd;
  endInput.onchange = () => {
    S.clocktableEnd = endInput.value;
    render();
  };
  rangeRow.appendChild(endInput);

  // No visible text label -- just the bare select, so it fits on the
  // same line as the date pickers without extra width; still
  // identifiable via aria-label for accessibility.
  const maxlevelSelect = document.createElement('select');
  textInputStyle(maxlevelSelect);
  maxlevelSelect.style.width = 'auto';
  maxlevelSelect.style.marginLeft = '6px';
  maxlevelSelect.setAttribute('aria-label', 'maxlevel');
  for (let n = 1; n <= 10; n++) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = String(n);
    if (n === S.clocktableMaxlevel) option.selected = true;
    maxlevelSelect.appendChild(option);
  }
  maxlevelSelect.onchange = () => {
    S.clocktableMaxlevel = Number(maxlevelSelect.value);
    render();
  };
  rangeRow.appendChild(maxlevelSelect);

  reportNest.appendChild(rangeRow);

  const pre = document.createElement('pre');
  pre.style.marginTop = '8px';
  pre.style.padding = '10px';
  pre.style.border = '0.5px solid var(--border-strong)';
  pre.style.borderRadius = '8px';
  pre.style.fontSize = '12px';
  pre.style.fontFamily = 'monospace';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';
  pre.style.userSelect = 'text';
  pre.style.overflowX = 'auto';
  pre.textContent = rendered;
  reportNest.appendChild(pre);

  return wrap;
}

export function renderTaskListView() {
  ensureAgendaFilesLoaded();
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';

  const headingRow = document.createElement('div');
  headingRow.style.display = 'flex';
  headingRow.style.justifyContent = 'space-between';
  headingRow.style.alignItems = 'center';
  headingRow.style.gap = '8px';
  headingRow.style.marginBottom = '10px';

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.textContent = 'Every active TODO in this file, regardless of date — matching real org\u2019s own global TODO list.';
  headingRow.appendChild(heading);

  container.appendChild(headingRow);
  container.appendChild(buildClocktableSection());

  // Same exclusion rules as Agenda (completed items, archived, commented
  // headings), using this file's own #+TODO: sequence — deliberately
  // consistent with Agenda rather than a separate, different notion of
  // "done" or "should this show up at all".
  const todoSequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const items = buildTaskList(aggregateAgendaDocs(), {
    isDone: (todo) => todoSequence.doneKeywords.includes(todo),
    includeCommented: !getAgendaSkipCommentTrees(S.state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(S.state.localVariables),
  });

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '14px';
    empty.style.padding = '20px 0';
    empty.textContent = 'Nothing active \u2014 every TODO is either done or there are none yet.';
    container.appendChild(empty);
    outlineEl.appendChild(container);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.cursor = 'pointer';

    const badge = document.createElement('span');
    badge.textContent = item.todo;
    badge.style.fontWeight = '700';
    badge.style.fontSize = '12px';
    badge.style.flexShrink = '0';
    row.appendChild(badge);

    const text = document.createElement('div');
    text.style.flex = '1 1 auto';
    text.style.minWidth = '0';
    text.style.overflowWrap = 'anywhere';
    text.textContent = item.title;
    const taskEffort = itemEffortText(item);
    if (taskEffort) {
      const effortBadge = document.createElement('span');
      effortBadge.setAttribute('data-item-effort', '');
      effortBadge.textContent = ` \u23f1 ${taskEffort}`;
      effortBadge.style.opacity = '0.6';
      effortBadge.style.fontSize = '12px';
      effortBadge.style.whiteSpace = 'nowrap';
      text.appendChild(effortBadge);
    }
    row.appendChild(text);

    if (S.showClockDisplay) {
      const minutes = totalClockedMinutes(item.heading);
      if (minutes > 0) {
        const clockLabel = document.createElement('span');
        clockLabel.style.fontSize = '12px';
        clockLabel.style.opacity = '0.65';
        clockLabel.style.flexShrink = '0';
        clockLabel.textContent = formatClockDuration(minutes);
        row.appendChild(clockLabel);
      }
    }

    row.onclick = () => {
      const outlinePath = outlinePathForHeadingInDocument(item.documentId, item.heading);
      if (outlinePath) navigateToHeadingByPath(item.documentId, outlinePath);
    };
    container.appendChild(row);
  }

  outlineEl.appendChild(container);
}
