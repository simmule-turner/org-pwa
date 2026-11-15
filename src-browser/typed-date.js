// @ts-check
// "Or type a date" for the date pickers: the answer of Emacs's date prompt (`+1w`, `fri`, `12`, `2025-12-24 14:30-15:30`) sets the picker's fields.
import { typedDateFields } from '../src/typed-date-fields.js';
import { S } from './app-state.js';
import { fieldRow, textInputStyle } from './ui-widgets.js';

/**
 * A text row that fills `dateInput` (and the time fields, when the answer has times) from what is typed, on Enter or when the box is left.
 * @param {HTMLInputElement} dateInput
 * @param {HTMLInputElement | null} timeInput
 * @param {HTMLInputElement | null} endInput
 * @param {string} [label]
 * @returns {HTMLElement}
 */
export function typedDateRow(dateInput, timeInput, endInput, label = 'Or type a date') {
  const typed = document.createElement('input');
  typed.type = 'text';
  typed.placeholder = '+1w, fri, 12, 3 2 14:30 …';
  typed.setAttribute('autocapitalize', 'none');
  typed.setAttribute('autocomplete', 'off');
  typed.setAttribute('spellcheck', 'false');
  textInputStyle(typed);
  const apply = () => {
    const text = typed.value.trim();
    if (!text) return;
    const defaultTime = dateInput.value ? new Date(`${dateInput.value}T${timeInput && timeInput.value ? timeInput.value : '00:00'}:00`) : null;
    const r = typedDateFields(text, { vars: { ...S.globalVariables, ...S.state.localVariables }, defaultTime: defaultTime && !isNaN(defaultTime.getTime()) ? defaultTime : null });
    if ('error' in r) return;
    dateInput.value = r.date;
    if (timeInput && r.time) timeInput.value = r.time;
    if (endInput && r.endTime) endInput.value = r.endTime;
    for (const el of [dateInput, timeInput, endInput]) if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    typed.value = '';
  };
  typed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      apply();
    }
  });
  typed.addEventListener('blur', apply);
  return fieldRow(label, typed);
}
