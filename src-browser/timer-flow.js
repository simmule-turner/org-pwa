// @ts-check
// Org Timer: a relative timer that counts up (org-timer-start), a countdown (org-timer-set-timer), their pause, continue and stop,
// the H:MM:SS they insert (org-timer, org-timer-item) and the shifting of such stamps (org-timer-change-times-in-region). The
// arithmetic is src/org-timer.js. While one runs, <H:MM:SS> shows in the modeline (org-timer-display).
import { getHeadingText, setHeadingText } from '../src/body-edit.js';
import { getProperty } from '../src/archive-model.js';
import { lispStringValue } from '../src/export-defaults.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { appendTimerItem, changeTimes, fixIncomplete, hmsToSecs, remainingMessage, secondsLeft, secsToHms, timerValueString } from '../src/org-timer.js';
import { S } from './app-state.js';
import { notify } from './clock-watch.js';
import { confirmDialog, openTextFieldPopup, promptText } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { renderModeline } from './chrome.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** What the settings say: `org-timer-format`, `org-timer-default-timer` and `org-timer-display`. */
function timerSettings() {
  const vars = S.state.localVariables || S.globalVariables || {};
  const display = (vars['org-timer-display'] ?? 'mode-line').trim().replace(/^'/, '');
  return {
    format: lispStringValue(vars['org-timer-format']) ?? '%s ',
    defaultTimer: lispStringValue(vars['org-timer-default-timer']) ?? (/^[0-9]+$/.test((vars['org-timer-default-timer'] || '').trim()) ? vars['org-timer-default-timer'].trim() : '0'),
    display,
  };
}

/** The timer's value as `org-timer-value-string` gives it. @returns {string} */
function valueString() {
  return timerValueString(/** @type {import('../src/org-timer.js').TimerState} */ (S.timer), Date.now(), timerSettings().format);
}

/** `org-timer-update-mode-line`: the timer in the modeline and, as asked, in the title of the page. */
function updateModeLine() {
  if (!S.timer) return;
  if (S.timer.pause === null) S.timerValue = ' <' + valueString().slice(0, -1) + '>';
  showTimer();
}

function showTimer() {
  const { display } = timerSettings();
  const inTitle = display === 'frame-title' || display === 'both';
  if (S.timerTitleBase === null || S.timerTitleBase === undefined) S.timerTitleBase = document.title;
  document.title = inTitle && S.timerValue ? S.timerValue.trim() + ' ' + S.timerTitleBase : S.timerTitleBase;
  S.timerModeLine = S.timerValue && (display === 'mode-line' || display === 'both') ? S.timerValue.trim() : null;
  if (S.state.doc) renderModeline();
}

/** `org-timer-set-mode-line`. @param {'on' | 'off' | 'paused'} value */
function setModeLine(value) {
  if (S.timerTick !== null && S.timerTick !== undefined) {
    clearInterval(S.timerTick);
    S.timerTick = null;
  }
  if (value === 'off') {
    S.timerValue = null;
    showTimer();
    return;
  }
  if (value === 'on') {
    updateModeLine();
    if (timerSettings().display !== 'nil') S.timerTick = window.setInterval(updateModeLine, 1000);
  }
}

/** Cancels the countdown's alarm. */
function cancelAlarm() {
  if (S.timerAlarm !== null && S.timerAlarm !== undefined) clearTimeout(S.timerAlarm);
  S.timerAlarm = null;
}

/** `org-timer--run-countdown-timer`: at zero, the reminder `org-timer-done-hook` follows in Emacs. @param {number} secs @param {string} title */
function runCountdown(secs, title) {
  cancelAlarm();
  S.timerAlarm = window.setTimeout(() => {
    S.timer = null;
    S.timerAlarm = null;
    setModeLine('off');
    void notify(`${title}: time out`, 'Timer', 'org-timer');
  }, secs * 1000);
}

/** The title of the countdown: the focused heading, or the buffer's name (`org-timer--get-timer-title`). */
function timerTitle() {
  const h = S.keyboardFocusedHeading;
  if (h) return h.title;
  return String(S.state.documentId || '').split('/').pop() || 'Timer';
}

/** `org-timer-start`: the relative timer starts now, or `offset` seconds ago. @param {number} [offset] */
export function timerStart(offset) {
  if (S.timer && S.timer.countdown) {
    setStatus('Countdown timer is running. Cancel first');
    return;
  }
  const now = Date.now();
  S.timer = { start: offset === undefined ? now : now - offset * 1000, pause: null, countdown: null };
  setModeLine('on');
  const at = new Date(S.timer.start);
  setStatus(`Timer start time set to ${at.toTimeString().slice(0, 8)}, current value is ${secsToHms(offset ?? 0)}`);
}

/** `org-timer-start` with an offset: asks for it, with the stamp the focused text has as the default ("0:00:00"). */
export async function timerStartWithOffset() {
  if (S.timer && S.timer.countdown) {
    setStatus('Countdown timer is running. Cancel first');
    return;
  }
  const def = '0:00:00';
  const answer = await promptText(`Restart timer with offset [${def}]: `, '');
  if (answer === null) return;
  try {
    timerStart(hmsToSecs(fixIncomplete(/\S/.test(answer) ? answer : def)));
  } catch (err) {
    setStatus(/** @type {Error} */ (err).message);
  }
}

/** `org-timer-pause-or-continue`. */
export function timerPauseOrContinue() {
  const t = S.timer;
  if (!t) {
    setStatus('No timer is running');
    return;
  }
  const now = Date.now();
  if (t.pause !== null) {
    if (t.countdown) {
      const left = Math.max(0, (t.start - t.pause) / 1000);
      runCountdown(left, t.title ?? timerTitle());
      S.timer = { ...t, start: now + left * 1000, pause: null, countdown: 'running' };
    } else {
      S.timer = { ...t, start: now - (t.pause - t.start), pause: null };
    }
    setModeLine('on');
    setStatus(`Timer continues at ${valueString()}`);
    return;
  }
  if (t.countdown) {
    cancelAlarm();
    S.timer = { ...t, countdown: 'paused', pause: now };
  } else S.timer = { ...t, pause: now };
  setModeLine('paused');
  setStatus(`Timer paused at ${valueString()}`);
}

/** `org-timer-stop`. */
export function timerStop() {
  if (!S.timer) {
    setStatus('No timer running');
    return;
  }
  cancelAlarm();
  S.timer = null;
  setModeLine('off');
  setStatus('Timer stopped');
}

/** `org-timer`: the stamp to insert at the cursor; the timer starts if none runs. @returns {string} */
export function timerStamp() {
  if (!S.timer) timerStart();
  return valueString();
}

/** The Timer button of the text editors: `org-timer` inserts the stamp at the cursor. @returns {{ text: string, title: string, id: string, onClick: (textarea: HTMLTextAreaElement) => void }} */
export function timerEditorTool() {
  return {
    text: 'Timer',
    title: 'Insert the timer at the cursor',
    id: 'timer',
    onClick: (textarea) => {
      const stamp = timerStamp();
      const { selectionStart: a, selectionEnd: b } = textarea;
      textarea.setRangeText(stamp, a, b, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    },
  };
}

/** `org-timer-item`: a timer list item at the end of the text of the focused heading. */
export function timerItem() {
  const h = S.keyboardFocusedHeading;
  if (!h) {
    setStatus('Before first headline');
    return;
  }
  try {
    const stamp = timerStamp();
    setHeadingText(h, appendTimerItem(getHeadingText(h), stamp));
    commitAndRender('Timer item');
  } catch (err) {
    setStatus(/** @type {Error} */ (err).message);
  }
}

/** `org-timer-show-remaining-time`. */
export function timerShowRemaining() {
  const left = secondsLeft(S.timer ?? null, Date.now());
  setStatus(left === null ? 'No timer set' : remainingMessage(left));
}

/**
 * `org-timer-set-timer`: a countdown of the focused heading's effort, or of what is asked for (minutes or h:mm:ss).
 * @param {{ ignoreEffort?: boolean }} [options] `ignoreEffort`: ask even when the heading has an effort
 */
export async function timerSetTimer({ ignoreEffort = false } = {}) {
  if (S.timer && !S.timer.countdown) {
    setStatus('Relative timer is running. Stop first');
    return;
  }
  const { defaultTimer } = timerSettings();
  const h = S.keyboardFocusedHeading;
  const effort = h && !ignoreEffort ? getProperty(h, 'EFFORT') : null;
  const effortMinutes = effort && /\S/.test(effort) ? Math.floor(parseOrgDuration(effort) || 0) : null;
  /** @type {string | null} */
  let minutes = effortMinutes !== null ? String(effortMinutes) : null;
  if (minutes === null) minutes = await promptText('How much time left? (minutes or h:mm:ss) ', defaultTimer === '0' ? '' : defaultTimer);
  if (minutes === null) return;
  if (/^[0-9]+$/.test(minutes)) minutes += ':00';
  if (!/[0-9]+/.test(minutes)) {
    timerShowRemaining();
    return;
  }
  let secs;
  try {
    secs = hmsToSecs(fixIncomplete(minutes));
  } catch (err) {
    setStatus(/** @type {Error} */ (err).message);
    return;
  }
  if (S.timer && !(await confirmDialog('Replace current timer?', { confirmLabel: 'Yes', cancelLabel: 'No', danger: false }))) {
    setStatus('No timer set');
    return;
  }
  const title = timerTitle();
  runCountdown(secs, title);
  S.timer = { start: Date.now() + secs * 1000, pause: null, countdown: 'running', title };
  setModeLine('on');
}

/** `org-timer-change-times-in-region`: the stamps in the text of the focused heading move by what is asked ("-1:08:26"; nothing: the first becomes zero). */
export function timerChangeTimes() {
  const h = S.keyboardFocusedHeading;
  if (!h) {
    setStatus('Before first headline');
    return;
  }
  openTextFieldPopup({
    label: 'Enter time difference like "-1:08:26". Default is first time to zero:',
    value: '',
    onSave: (/** @type {string} */ delta) => {
      try {
        const before = getHeadingText(h);
        const after = changeTimes(before, delta);
        if (after !== before) {
          setHeadingText(h, after);
          commitAndRender('Shifted timer stamps');
        }
      } catch (err) {
        setStatus(/** @type {Error} */ (err).message);
      }
    },
  });
}
