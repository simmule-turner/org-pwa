// @ts-check
// Watches the running clock every 30 seconds (from the same timer that redraws the modeline): once when the clocked time reaches the
// effort, a reminder (org-clock-notify-once-if-expired, with org-clock-sound), and, with org-clock-idle-time set, a question after
// the person has been away that long (org-resolve-clocks-if-idle): keep the time, take the idle time off and go on, or take it
// off and clock out. "Away" is no tap, key or scroll in the app; the clock of a device that slept counts the sleep as idle.
import { clockOut, currentClockSessionMinutes } from '../src/clock.js';
import { getProperty } from '../src/archive-model.js';
import { effortReached, idleLimitMinutes, idlePrompt, reminderText, soundKind } from '../src/clock-reminder.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { S } from './app-state.js';
import { clockInHeading, findRunningClockAcrossSessions } from './clock-flow.js';
import { openButtonChoiceModal } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { platform } from './platform.js';
import { switchToTab } from './tabs.js';

/** @type {{ key: string, shown: boolean, lastActive: number, dialog: HTMLElement | null }} */
const watch = { key: '', shown: false, lastActive: Date.now(), dialog: null };

/** A short beep (Emacs's `t`); a failure to make sound is not worth a message. */
function beep() {
  try {
    const Context = window.AudioContext || /** @type {Record<string, typeof AudioContext>} */ (/** @type {unknown} */ (window)).webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch {
    /* no sound available */
  }
}

/** @param {string} text */
async function notify(text) {
  setStatus(text);
  if (soundKind(S.globalVariables['org-clock-sound']) !== 'none') beep();
  const n = platform.notifications;
  try {
    if (n.supported() && (await n.permission()) === 'granted') {
      const today = new Date();
      await n.show({ id: 'clock-effort', title: 'Clock', body: text, detail: null, day: new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() });
    }
  } catch {
    /* the status line already said it */
  }
}

/** @typedef {{ heading: import('../src/types.js').Heading & { id?: string }, isActive?: boolean, tabId?: number | null, doc?: import('../src/types.js').Doc }} RunningClock */
/** @param {RunningClock} running */
function remindIfReached(running) {
  const effortRaw = getProperty(running.heading, 'EFFORT');
  const effort = Math.round(effortRaw ? parseOrgDuration(effortRaw) || 0 : 0);
  const key = `${running.heading.id || running.heading.title}|${(running.heading.logbookLines || []).find((/** @type {string} */ l) => /^CLOCK: \[[^\]]*\]\s*$/.test(l)) || ''}`;
  if (key !== watch.key) {
    watch.key = key;
    watch.shown = false;
  }
  if (effortReached(effort, currentClockSessionMinutes(running.heading))) {
    if (!watch.shown) {
      watch.shown = true;
      notify(reminderText(running.heading.title, effortRaw || ''));
    }
  } else {
    watch.shown = false; // the effort was raised or the clock restarted: it can speak again
  }
}

/** @param {Date | number} when */
const stamp = (when) => {
  const d = new Date(when);
  return formatOrgTimestamp({ date: d, time: d.toTimeString().slice(0, 5), active: false });
};

/** Asks what to do with the idle time. @param {RunningClock} running @param {number} idleStart */
function askIdle(running, idleStart) {
  const idleMinutes = (Date.now() - idleStart) / 60000;
  const keepAll = () => {
    watch.lastActive = Date.now();
  };
  const stop = async (/** @type {boolean} */ resume) => {
    if (!running.isActive) switchToTab(running.tabId ?? undefined);
    const heading = running.heading;
    if (clockOut(heading, stamp(idleStart), new Date(idleStart))) {
      commitAndRender(resume ? 'Idle time subtracted — clocking on' : 'Idle time subtracted — clocked out');
      if (resume) clockInHeading(heading);
    }
    watch.lastActive = Date.now();
  };
  watch.dialog = openButtonChoiceModal({
    label: idlePrompt(idleMinutes),
    buttons: [
      { text: 'Keep the idle time', onClick: keepAll },
      { text: 'Subtract it and keep clocking', onClick: () => stop(true) },
      { text: 'Subtract it and clock out', onClick: () => stop(false) },
    ],
  });
}

/** Runs from the 30-second timer. */
export function tickClockWatch() {
  const running = findRunningClockAcrossSessions();
  if (!running) {
    watch.key = '';
    watch.shown = false;
    return;
  }
  remindIfReached(running);
  if (watch.dialog) {
    if (watch.dialog.isConnected) return;
    watch.dialog = null; // dismissed without a choice: keep everything
    watch.lastActive = Date.now();
    return;
  }
  const limit = idleLimitMinutes(S.globalVariables['org-clock-idle-time']);
  if (limit && Date.now() - watch.lastActive > limit * 60000) askIdle(running, watch.lastActive);
}

/** Notes that the person is here; after a long absence (the device slept, so no timer ran) this is also where the idle question comes up. */
function activity() {
  const now = Date.now();
  const limit = idleLimitMinutes(S.globalVariables['org-clock-idle-time']);
  const gap = now - watch.lastActive;
  const before = watch.lastActive;
  watch.lastActive = now;
  if (!limit || gap <= limit * 60000 || watch.dialog) return;
  const running = findRunningClockAcrossSessions();
  if (running) askIdle(running, before);
}

export function startClockWatch() {
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) window.addEventListener(type, activity, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activity();
  });
}
