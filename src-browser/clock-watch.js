// @ts-check
// Watches the running clock every 30 seconds (from the same timer that redraws the modeline): once when the clocked time reaches the
// effort, a reminder (org-clock-notify-once-if-expired, with org-clock-sound), and, with org-clock-idle-time set, a question after
// the person has been away that long (org-resolve-clocks-if-idle): keep the time, take the idle time off and go on, or take it
// off and clock out. "Away" is no tap, key or scroll in the app; the clock of a device that slept counts the sleep as idle.
import { clockCancel, clockInSwitchingTasks, currentClockSessionMinutes, runningClockStartMs } from '../src/clock.js';
import { getProperty } from '../src/archive-model.js';
import { effortReached, idleLimitMinutes, idlePrompt, reminderText, resolveIdleClock, soundFileName, soundKind } from '../src/clock-reminder.js';
import { guessAudioMimeType } from '../src/link-resolve.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { S } from './app-state.js';
import { clockSettingsFor } from './clock-options.js';
import { clockGoto, clockInHeading, clockOutAndSwitch, findRunningClockAcrossSessions } from './clock-flow.js';
import { openGridChoiceModal, promptText } from './dialogs.js';
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

/**
 * org-clock-sound: `t` beeps; a file name is played from the org-pwa folder where the platform has one (the Android app), and
 * beeps where there is none, or the file is missing or will not play, as Emacs beeps when it cannot play the file.
 * @param {string | undefined} raw
 */
export async function playClockSound(raw) {
  const kind = soundKind(raw);
  if (kind === 'none') return;
  const name = soundFileName(raw);
  if (name !== null && platform.attachments.supported() && platform.attachments.adapter) {
    try {
      const file = await platform.attachments.adapter.readBinary(name);
      if (file && file.base64) {
        await new Audio(`data:${guessAudioMimeType(name)};base64,${file.base64}`).play();
        return;
      }
    } catch {
      /* missing, unreadable or blocked: fall back to the beep */
    }
  }
  beep();
}

/** @param {string} text */
async function notify(text) {
  setStatus(text);
  await playClockSound(S.globalVariables['org-clock-sound']);
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

/** Org's question after idle time (`org-clock-resolve`): the same keys and the same results. @param {RunningClock} running @param {number} idleStart */
function askIdle(running, idleStart) {
  const idleMinutes = (Date.now() - idleStart) / 60000;
  const defaultMinutes = Math.floor(idleMinutes);
  const clockStart = runningClockStartMs(running.heading) ?? idleStart;

  /** @param {string} key @param {{ keepMinutes?: number | null, gotBackMinutes?: number | null }} [extra] */
  const apply = (key, extra = {}) => {
    const now = Date.now();
    const plan = resolveIdleClock({ key, idleStart, now, clockStart, ...extra });
    watch.lastActive = now;
    if (plan.type === 'none') return;
    if (!running.isActive) switchToTab(running.tabId ?? undefined);
    const heading = running.heading;
    if (plan.type === 'jump') {
      if (plan.clockOutNow) clockOutAndSwitch(heading, stamp(now), new Date(now));
      clockGoto();
      return;
    }
    if (plan.type === 'cancel') {
      clockCancel(heading);
      if (plan.clockInNow) clockInHeading(heading);
      else commitAndRender('Clock cancelled — time discarded');
      return;
    }
    if (plan.type === 'now') {
      if (plan.clockOut && clockOutAndSwitch(heading, stamp(now), new Date(now))) commitAndRender('Clocked out');
      return;
    }
    if (clockOutAndSwitch(heading, stamp(plan.clockOutAt), new Date(plan.clockOutAt))) {
      if (plan.clockInAt !== null && S.state.doc) {
        clockInSwitchingTasks(S.state.doc, heading, stamp(plan.clockInAt), new Date(plan.clockInAt), clockSettingsFor(heading));
        commitAndRender('Idle time resolved — clocking on');
      } else commitAndRender('Idle time resolved — clocked out');
    }
  };

  /** Asks for a number of minutes. @param {string} question */
  const askMinutes = async (question) => {
    const text = await promptText(question, String(defaultMinutes));
    const n = text === null ? NaN : Number(text.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  /** @param {string} key */
  const keep = (key) => async () => {
    const minutes = await askMinutes('Keep how many minutes: ');
    if (minutes !== null) apply(key, { keepMinutes: minutes });
  };
  /** @param {string} key */
  const keepUntil = (key) => async () => {
    const text = await promptText('Keep the idle time until (HH:MM today): ', '');
    const m = text === null ? null : /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return;
    const at = new Date();
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (at.getTime() <= idleStart || at.getTime() > Date.now()) {
      setStatus('That time is outside the idle period');
      return;
    }
    apply(key, { keepMinutes: Math.floor((at.getTime() - idleStart) / 60000) });
  };
  /** @param {string} key */
  const gotBack = (key) => async () => {
    const minutes = await askMinutes('Got back how many minutes ago: ');
    if (minutes !== null) apply(key, { gotBackMinutes: minutes });
  };

  watch.dialog = openGridChoiceModal({
    label: idlePrompt(idleMinutes),
    showKeys: true,
    buttons: [
      { key: 'i', text: 'Ignore this question (keep all the idle time)', onClick: () => apply('i') },
      { key: 'k', text: 'Keep some of the idle time…', onClick: keep('k') },
      { key: 'K', text: 'Keep some, and clock out…', onClick: keep('K') },
      { key: 't', text: 'Keep until a time…', onClick: keepUntil('t') },
      { key: 'T', text: 'Keep until a time, and clock out…', onClick: keepUntil('T') },
      { key: 'g', text: 'I got back some minutes ago…', onClick: gotBack('g') },
      { key: 'G', text: 'Got back, and clock out…', onClick: gotBack('G') },
      { key: 's', text: 'Subtract the idle time and keep clocking', onClick: () => apply('s') },
      { key: 'S', text: 'Subtract the idle time and clock out', onClick: () => apply('S') },
      { key: 'C', text: 'Cancel the clock', onClick: () => apply('C') },
      { key: 'j', text: 'Jump to the clock', onClick: () => apply('j') },
      { key: 'J', text: 'Clock out, then jump to it', onClick: () => apply('J') },
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
  window.addEventListener('org-clock-started', () => setTimeout(tickClockWatch, 0));
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) window.addEventListener(type, activity, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activity();
  });
}
