// Extracted from app.js: field groups. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { parseRepeater } from '../src/agenda.js';
import { formatOrgTimestamp, parseDelay, parseOrgTimestamp } from '../src/org-timestamp.js';
import { fieldRow, textInputStyle, wizardButton } from './ui-widgets.js';

// Contextual action row shown below a heading/list-item when its text has
// been tapped. `actions` is [{ icon, label, onClick }]. Icons are the only
// differentiator between actions — deliberately no color coding (e.g. no
// "delete is red"), since the request was specifically for icon-based
// distinction, not color-based.
export const TIME_UNIT_OPTIONS = [
  ['h', 'Hour(s)'],
  ['d', 'Day(s)'],
  ['w', 'Week(s)'],
  ['m', 'Month(s)'],
  ['y', 'Year(s)'],
];

export const REPEATER_MARK_OPTIONS = [
  ['', 'No repeat'],
  ['+', 'Every'],
  ['++', 'Every (catch-up)'],
  ['.+', 'Every (from completion)'],
];

/**
 * A structured SCHEDULED/DEADLINE editor: real date/time pickers, a
 * repeater (mark + amount + unit), and a delay/warning period — instead
 * of a plain text box the user has to know org's raw timestamp syntax
 * to use correctly. Shared by both SCHEDULED and DEADLINE editing (see
 * the heading action menu's Timestamp action), since they're
 * structurally identical fields with only the label differing.
 *
 * Returns { container, getRawValue() } — getRawValue() returns null if
 * the group's checkbox is unchecked or its date is empty (meaning "clear
 * this timestamp"), otherwise a valid org timestamp string built via
 * formatOrgTimestamp from whatever the fields currently hold.
 */
export function buildTimestampFieldGroup(label, currentRaw) {
  const parsed = currentRaw ? parseOrgTimestamp(currentRaw) : null;
  const repeaterParsed = parsed && parsed.repeater ? parseRepeater(parsed.repeater) : null;
  const repeaterMarkParsed = parsed && parsed.repeater ? parsed.repeater.match(/^[.+]+/)[0] : '';
  const delayParsed = parsed && parsed.delay ? parseDelay(parsed.delay) : null;

  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '8px';

  const checkboxLabel = document.createElement('label');
  checkboxLabel.style.display = 'flex';
  checkboxLabel.style.alignItems = 'center';
  checkboxLabel.style.gap = '8px';
  checkboxLabel.style.fontWeight = '600';
  checkboxLabel.style.fontSize = '14px';
  checkboxLabel.style.cursor = 'pointer';
  const enabledCheckbox = document.createElement('input');
  enabledCheckbox.type = 'checkbox';
  enabledCheckbox.checked = !!parsed;
  enabledCheckbox.style.width = '20px';
  enabledCheckbox.style.height = '20px';
  checkboxLabel.appendChild(enabledCheckbox);
  checkboxLabel.appendChild(document.createTextNode(label));
  headerRow.appendChild(checkboxLabel);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.fontSize = '13px';
  clearBtn.style.padding = '6px 10px';
  clearBtn.style.flexShrink = '0';
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const fields = document.createElement('div');
  fields.style.marginTop = '10px';
  fields.style.display = enabledCheckbox.checked ? 'block' : 'none';
  fields.style.boxSizing = 'border-box';
  fields.style.width = '100%';
  fields.style.maxWidth = '100%';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  textInputStyle(dateInput);
  // iOS Safari specifically: the native date-picker control has its own
  // internal rendering that doesn't fully respect max-width/box-sizing
  // the way Chrome's does, which is why this overflowed on iOS but not
  // Chrome despite already being constrained at every container level.
  // -webkit-appearance: none is the standard, documented fix — it drops
  // iOS's native chrome for the inline (non-active) display, forcing it
  // to actually honor normal CSS box sizing; tapping still opens the
  // native date-wheel picker as usual.
  dateInput.style.webkitAppearance = 'none';
  dateInput.style.appearance = 'none';
  if (parsed) {
    const y = parsed.date.getFullYear();
    const m = String(parsed.date.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.date.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
  }
  fields.appendChild(fieldRow('Date', dateInput));

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  textInputStyle(timeInput);
  timeInput.style.webkitAppearance = 'none'; // same iOS fix as dateInput above
  timeInput.style.appearance = 'none';
  if (parsed && parsed.hasTime) {
    const h = String(parsed.date.getHours()).padStart(2, '0');
    const min = String(parsed.date.getMinutes()).padStart(2, '0');
    timeInput.value = `${h}:${min}`;
  }
  fields.appendChild(fieldRow('Start time (optional)', timeInput));

  const repeaterRow = document.createElement('div');
  repeaterRow.style.display = 'flex';
  repeaterRow.style.gap = '6px';
  const repeaterMarkSelect = document.createElement('select');
  textInputStyle(repeaterMarkSelect);
  repeaterMarkSelect.style.flex = '1 1 auto';
  for (const [val, text] of REPEATER_MARK_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    repeaterMarkSelect.appendChild(opt);
  }
  repeaterMarkSelect.value = repeaterMarkParsed;
  const repeaterAmountInput = document.createElement('input');
  repeaterAmountInput.type = 'number';
  repeaterAmountInput.min = '1';
  textInputStyle(repeaterAmountInput);
  repeaterAmountInput.style.width = '60px';
  repeaterAmountInput.style.flex = '0 0 60px';
  if (repeaterParsed) repeaterAmountInput.value = String(repeaterParsed.amount);
  const repeaterUnitSelect = document.createElement('select');
  textInputStyle(repeaterUnitSelect);
  repeaterUnitSelect.style.flex = '1 1 auto';
  for (const [val, text] of TIME_UNIT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    repeaterUnitSelect.appendChild(opt);
  }
  if (repeaterParsed) repeaterUnitSelect.value = repeaterParsed.unit;
  repeaterRow.appendChild(repeaterMarkSelect);
  repeaterRow.appendChild(repeaterAmountInput);
  repeaterRow.appendChild(repeaterUnitSelect);
  fields.appendChild(fieldRow('Repeat', repeaterRow));

  const delayRow = document.createElement('div');
  delayRow.style.display = 'flex';
  delayRow.style.gap = '6px';
  const delayAmountInput = document.createElement('input');
  delayAmountInput.type = 'number';
  delayAmountInput.min = '1';
  textInputStyle(delayAmountInput);
  delayAmountInput.style.width = '60px';
  delayAmountInput.style.flex = '0 0 60px';
  if (delayParsed) delayAmountInput.value = String(delayParsed.amount);
  const delayUnitSelect = document.createElement('select');
  textInputStyle(delayUnitSelect);
  delayUnitSelect.style.flex = '1 1 auto';
  const blankUnitOpt = document.createElement('option');
  blankUnitOpt.value = '';
  blankUnitOpt.textContent = '\u2014';
  delayUnitSelect.appendChild(blankUnitOpt);
  for (const [val, text] of TIME_UNIT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    delayUnitSelect.appendChild(opt);
  }
  if (delayParsed) delayUnitSelect.value = delayParsed.unit;
  delayRow.appendChild(delayAmountInput);
  delayRow.appendChild(delayUnitSelect);
  fields.appendChild(fieldRow('Warn ahead by (optional \u2014 e.g. see a deadline coming a few days early)', delayRow));

  wrap.appendChild(fields);

  enabledCheckbox.addEventListener('change', () => {
    fields.style.display = enabledCheckbox.checked ? 'block' : 'none';
  });

  clearBtn.onclick = () => {
    enabledCheckbox.checked = false;
    fields.style.display = 'none';
    dateInput.value = '';
    timeInput.value = '';
    repeaterMarkSelect.value = '';
    repeaterAmountInput.value = '';
    repeaterUnitSelect.value = 'd';
    delayAmountInput.value = '';
    delayUnitSelect.value = '';
  };

  function getRawValue() {
    if (!enabledCheckbox.checked || !dateInput.value) return null;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const time = timeInput.value || null;
    const repeaterMark = repeaterMarkSelect.value || null;
    const repeaterValue =
      repeaterMark && repeaterAmountInput.value ? `${repeaterAmountInput.value}${repeaterUnitSelect.value}` : null;
    const delayValue = delayUnitSelect.value && delayAmountInput.value ? `${delayAmountInput.value}${delayUnitSelect.value}` : null;
    return formatOrgTimestamp({ date, time, repeaterMark, repeaterValue, delayValue });
  }

  return { container: wrap, getRawValue };
}

/** Structured priority editor: a row of buttons (A/B/C/None), the
 *  active one highlighted. A/B/C are real org's own conventional
 *  default range (org-priority-highest/-lowest, both configurable in
 *  Emacs but A-C out of the box) -- covers the common case directly
 *  with one tap; anything outside that range isn't reachable from this
 *  UI, a stated scope limit rather than trying to build a full A-Z
 *  picker for a rarely-used case. */
export const PRIORITY_LEVELS = ['A', 'B', 'C'];

export function buildPriorityFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Priority';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  let currentPriority = heading.priority;

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '6px';
  wrap.appendChild(btnRow);

  function renderButtons() {
    btnRow.innerHTML = '';
    for (const level of [...PRIORITY_LEVELS, 'None']) {
      const btn = wizardButton(level, () => {
        currentPriority = level === 'None' ? null : level;
        renderButtons();
      });
      const isActive = level === 'None' ? !currentPriority : level === currentPriority;
      btn.style.background = isActive ? 'var(--accent)' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'var(--fg)';
      btn.style.border = '1px solid var(--border-strong)';
      btnRow.appendChild(btn);
    }
  }
  renderButtons();

  return { container: wrap, getPriority: () => currentPriority };
}

/** "YYYY-MM-DD" for a date-picker's own value attribute, local time
 *  (not UTC -- toISOString would shift the date near a timezone
 *  boundary, exactly the kind of off-by-one a date range picker can't
 *  afford). */
export function dateInputValue(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}
