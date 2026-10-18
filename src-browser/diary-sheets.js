// @ts-check
// The diary's sheets: Add entry, Check this line and the date picker, and the row of diary tools above the Text view of the diary.
import { buildAgendaItems } from '../src/agenda.js';
import { checkDiaryLine } from '../src/agenda-diary.js';
import { ENTRY_KINDS, dateOrderHint, dateText, entryLine, formatEntryDate, parseEntryDate } from '../src/diary-entry.js';
import { diaryOptionsFromVars } from '../src/diary-file.js';
import { lineBounds } from '../src/text-edit.js';
import { agendaSexpOptions } from './agenda-settings.js';
import { S } from './app-state.js';
import { buildSheet, cancelButton } from './bottom-sheet.js';
import { applyTextEdit } from './text-view.js';

/** The diary's settings in force now. */
function options() {
  return diaryOptionsFromVars(/** @type {Record<string, string>} */ (S.state.localVariables || S.globalVariables || {}));
}

/** @param {string} css @param {string} [text] */
function div(css, text) {
  const el = document.createElement('div');
  el.style.cssText = css;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @param {string} label @param {HTMLElement} control */
function labeled(label, control) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:1;min-width:0;flex:1;';
  const text = document.createElement('span');
  text.textContent = label;
  text.style.opacity = '0.65';
  wrap.append(text, control);
  return wrap;
}

/** @param {string} value @param {string} [type] */
function input(value, type = 'text') {
  const el = document.createElement('input');
  el.type = type;
  el.value = value;
  el.style.cssText = 'width:100%;min-height:var(--target);font-size:16px;padding:0 12px;border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--bg);color:var(--fg);';
  return el;
}

/** @param {string} label @param {() => void} onClick @param {boolean} [primary] */
function button(label, onClick, primary = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = `min-height:var(--target);padding:0 20px;font-size:15px;border-radius:var(--radius-control);border:1px solid ${primary ? 'var(--accent)' : 'var(--border-strong)'};background:${primary ? 'var(--accent)' : 'var(--bg)'};color:${primary ? 'var(--bg)' : 'var(--fg)'};${primary ? 'font-weight:600;' : ''}`;
  btn.onclick = onClick;
  return btn;
}

/**
 * The Add entry sheet: a kind, a date, a time and the text; the line that will be written is shown before it is.
 * @param {{ date: Date, fileName: string, onAdd: (line: string) => void }} o
 */
export function openAddEntrySheet({ date, fileName, onAdd }) {
  const opts = options();
  const style = opts.dateStyle;
  const { panel, close } = buildSheet('Add diary entry', undefined);
  /** @type {{ kind: import('../src/diary-entry.js').EntryKind }} */
  const chosen = { kind: 'date' };

  const chips = div('display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;');
  /** @type {Map<string, HTMLButtonElement>} */ const chipEls = new Map();
  for (const { kind, label } of ENTRY_KINDS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = label;
    chip.style.cssText = 'min-height:36px;padding:0 14px;border-radius:18px;font-size:13px;border:1px solid var(--border-strong);';
    chip.onclick = () => {
      chosen.kind = kind;
      update();
    };
    chipEls.set(kind, chip);
    chips.appendChild(chip);
  }

  const dateIn = input(formatEntryDate(date, style));
  const dateLabel = labeled(`Date (${dateOrderHint(style)})`, dateIn);
  const endIn = input(formatEntryDate(date, style));
  const endLabel = labeled(`Until (${dateOrderHint(style)})`, endIn);
  const everyIn = input('7', 'number');
  everyIn.min = '1';
  const everyLabel = labeled('Repeat every (days)', everyIn);
  const timeIn = input('');
  timeIn.placeholder = 'optional, such as 10:00am';
  const textIn = input('');
  const nonmarking = document.createElement('input');
  nonmarking.type = 'checkbox';
  nonmarking.style.cssText = 'width:20px;height:20px;';
  const nonmarkingRow = document.createElement('label');
  nonmarkingRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:14px;min-height:var(--target);';
  nonmarkingRow.append(nonmarking, document.createTextNode(`Non-marking (starts with ${opts.nonmarkingSymbol ?? '&'})`));

  const preview = div('border:1px solid var(--border);background:var(--surface);border-radius:var(--radius-control);padding:10px 12px;font:13px/20px ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap;');
  const note = div('font-size:12px;opacity:0.65;margin-top:6px;line-height:1.4;');
  const add = button('Add entry', () => {
    const line = currentLine();
    if (!line) return;
    close();
    onAdd(line);
  }, true);

  /** @returns {string | null} */
  function currentLine() {
    const d = parseEntryDate(dateIn.value, style);
    const end = chosen.kind === 'block' ? parseEntryDate(endIn.value, style) : d;
    if (!d || !end || !textIn.value.trim()) return null;
    return entryLine(chosen.kind, { date: d, endDate: end, interval: Number(everyIn.value) || 1, time: timeIn.value, text: textIn.value, nonmarking: nonmarking.checked }, opts);
  }

  function update() {
    for (const [kind, chip] of chipEls) {
      const on = kind === chosen.kind;
      chip.style.background = on ? 'var(--accent)' : 'var(--bg)';
      chip.style.color = on ? 'var(--bg)' : 'var(--fg)';
      chip.style.borderColor = on ? 'var(--accent)' : 'var(--border-strong)';
    }
    endLabel.style.display = chosen.kind === 'block' ? 'flex' : 'none';
    everyLabel.style.display = chosen.kind === 'cyclic' ? 'flex' : 'none';
    const line = currentLine();
    const d = parseEntryDate(dateIn.value, style);
    preview.textContent = line ?? (d ? 'Type the entry’s text.' : `Type the date as ${dateOrderHint(style)}.`);
    preview.style.opacity = line ? '1' : '0.6';
    note.textContent = line ? `Added at the end of ${fileName} and saved.` : '';
    add.disabled = !line;
    add.style.opacity = line ? '1' : '0.4';
  }
  for (const el of [dateIn, endIn, everyIn, timeIn, textIn, nonmarking]) el.addEventListener('input', update);

  const dates = div('display:flex;gap:10px;margin:0 0 10px;');
  dates.append(dateLabel, labeled('Time', timeIn));
  const more = div('display:flex;gap:10px;margin:0 0 10px;');
  more.append(endLabel, everyLabel);
  const previewBox = div('margin:6px 0 10px;');
  previewBox.append(div('font-size:12px;opacity:0.65;margin-bottom:4px;', 'The line that will be added'), preview, note);
  const buttons = div('display:flex;justify-content:flex-end;gap:10px;margin-top:6px;');
  buttons.append(button('Cancel', close), add);
  panel.append(div('font-size:12px;opacity:0.65;', 'Kind'), chips, dates, more, labeled('Entry', textIn), nonmarkingRow, previewBox, buttons);
  update();
  textIn.focus();
}

/** @param {number} days */
function inDays(days) {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** The Check this line sheet for the line the cursor is on.
 * @param {HTMLTextAreaElement} textarea */
export function openCheckLineSheet(textarea) {
  const [start, end] = lineBounds(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const opts = options();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const result = line.trim() ? checkDiaryLine(line, opts, today, { ...agendaSexpOptions(), today: now, diary: null }, buildAgendaItems) : null;
  const { panel, close } = buildSheet('Check this line', undefined);
  panel.appendChild(div('border:1px solid var(--border);background:var(--surface);border-radius:var(--radius-control);padding:10px 12px;margin:8px 0 12px;font:13px/20px ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap;', line || '(an empty line)'));
  let title;
  let why;
  if (!result) {
    title = 'This line is empty';
    why = 'Move the cursor to a line of the diary and check it again.';
  } else if (result.kind === 'sexp') {
    title = 'This line is a sexp entry';
    why = result.dates.length ? 'It applies on the days below.' : 'The sexp does not apply on any day in the next four years. Check its arguments.';
  } else if (result.kind === 'dated') {
    title = 'This line is a diary entry';
    why = `It matches by the ${result.form} form. The entry text is “${result.text}”.`;
  } else if (/^[ \t]/.test(line)) {
    title = 'This line continues the entry above';
    why = 'An indented line belongs to the entry before it.';
  } else {
    title = 'Emacs ignores this line';
    why = `It does not start with a date, a weekday or ${opts.sexpSymbol ?? '%%'}(, so it is a note. If it is meant as an entry, the date must come first (${dateOrderHint(opts.dateStyle)}) and be followed by the text on the same line.`;
  }
  panel.appendChild(div('font-size:15px;font-weight:600;margin-bottom:6px;', (result && result.kind !== 'none' ? '✓ ' : '') + title));
  panel.appendChild(div('font-size:14px;line-height:1.45;opacity:0.85;margin-bottom:10px;', why));
  if (result && result.dates.length) {
    panel.appendChild(div('font-size:12px;opacity:0.65;margin-bottom:2px;', 'Next dates'));
    for (const d of result.dates) {
      const row = div('display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:15px;');
      row.append(div('', d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })), div('opacity:0.65;', inDays(Math.round((+d - +today) / 86400000))));
      panel.appendChild(row);
    }
    panel.appendChild(div('font-size:12px;opacity:0.65;margin-top:10px;line-height:1.4;', `Date order: ${dateOrderHint(opts.dateStyle)} (calendar-date-style is ${opts.dateStyle || 'american'}).`));
  }
  panel.appendChild(cancelButton('Close', close));
}

/** The Date… sheet: pick a day and its text is put at the cursor, written as the diary expects it.
 * @param {HTMLTextAreaElement} textarea */
export function openDatePickerSheet(textarea) {
  const opts = options();
  const { panel, close } = buildSheet('Insert a date', `Written as ${dateOrderHint(opts.dateStyle)} would read it`);
  const pick = input(new Date().toISOString().slice(0, 10), 'date');
  panel.appendChild(div('margin:10px 0;', '')).appendChild(pick);
  const buttons = div('display:flex;justify-content:flex-end;gap:10px;margin-top:10px;');
  buttons.append(
    button('Cancel', close),
    button('Insert', () => {
      const [y, m, d] = pick.value.split('-').map(Number);
      if (!y) return;
      close();
      const text = `${dateText(new Date(y, m - 1, d), opts.dateStyle)} `;
      const { selectionStart: a, selectionEnd: b } = textarea;
      applyTextEdit(textarea, { from: a, to: b, insert: text, selStart: a + text.length, selEnd: a + text.length });
    }, true)
  );
  panel.appendChild(buttons);
}

/** The row of tools for the diary's Text view.
 * @param {HTMLTextAreaElement} textarea
 * @param {() => void} addEntry  opens the Add entry sheet */
export function buildDiaryToolsRow(textarea, addEntry) {
  const row = document.createElement('div');
  row.className = 'te-row';
  row.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) e.preventDefault();
  });
  /** @param {string} label @param {() => void} onClick @param {boolean} [accent] */
  const btn = (label, onClick, accent = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'te-btn';
    b.textContent = label;
    if (accent) b.style.cssText = 'color:var(--accent);border-color:var(--accent);';
    b.onclick = onClick;
    return b;
  };
  const insert = btn('Insert entry ▾', addEntry, true);
  insert.disabled = textarea.readOnly;
  row.append(insert, btn('Check this line', () => openCheckLineSheet(textarea)));
  const date = btn('Date…', () => openDatePickerSheet(textarea));
  date.disabled = textarea.readOnly;
  row.appendChild(date);
  return row;
}
