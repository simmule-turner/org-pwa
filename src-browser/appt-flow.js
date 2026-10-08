// Agenda notifications (appt): runs the pure logic in src/appt.js. A scan lists the coming appointments (the open document plus the
// agenda files); a once-a-minute-or-so tick announces the ones that have come within the warning time and keeps the mode-line
// countdown; on a platform that can hold notifications for later (the Android shell) the scan also hands it the whole list, so
// reminders arrive with the app closed. Everything is off until appt-activate is on.
import { getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getContactsBirthdayProperty } from '../src/local-variables.js';
import { dueReminders, modeLineText, plannedNotifications, pruneFired, reminderBody, reminderSlot, reminderText, upcomingAppointments } from '../src/appt.js';
import { aggregateAgendaDocs, ensureAgendaFilesLoadedAndWait, syncAgendaFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { renderModeline } from './chrome.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';
import { render } from './render.js';
import { getApptSettings, setApptSettings } from './settings.js';
import { kv } from './singletons.js';
import { menuButton } from './ui-widgets.js';
import { switchToView } from './views.js';

const SCAN_HOURS = 6; // how far ahead the app watches by itself
const SCHEDULE_HOURS = 24; // and how far a platform that can hold reminders is told about

// Runtime state, not a setting. `fired` is what has been announced, so a rescan does not announce it again.
const runtime = { appointments: [], held: new Set(), listeningForTaps: false, fired: new Set(), lastScan: 0, scanning: false };

/** The settings in force (loaded once at start, replaced by saveSettings). */
export function apptSettings() {
  return S.apptSettings;
}

export async function loadApptSettings() {
  S.apptSettings = await getApptSettings(kv);
  S.apptModeLine = null;
  listenForTaps();
  if (S.apptSettings['appt-activate']) requestApptScan();
}

/** Stores new settings and applies them: turning it off cancels what is pending and clears the countdown; turning it on (or changing
 *  the warning time) scans again at once. */
export async function saveApptSettings(next) {
  const was = S.apptSettings;
  S.apptSettings = await setApptSettings(kv, { ...was, ...next });
  if (!S.apptSettings['appt-activate']) {
    runtime.appointments = [];
    runtime.fired = new Set();
    runtime.held = new Set();
    S.apptModeLine = null;
    hideBanner();
    try {
      await platform.notifications.cancelAll();
    } catch {
      // nothing was held, or the platform could not say; there is nothing more to do
    }
    refreshModeLine();
    return S.apptSettings;
  }
  if (!S.apptSettings['appt-display-mode-line']) S.apptModeLine = null;
  runtime.fired = new Set(); // a new warning time can put an appointment back inside its window
  await scanAppointments();
  return S.apptSettings;
}

function currentVars() {
  return S.state.doc ? S.state.localVariables : S.globalVariables;
}

/** Looks at the agenda again: on launch, on resume, after a save, and every scan interval. Calls close together become one run. */
export function requestApptScan() {
  if (!S.apptSettings || !S.apptSettings['appt-activate']) return;
  clearTimeout(runtime.scanTimer);
  runtime.scanTimer = setTimeout(() => scanAppointments().catch(() => {}), 1500);
}

export async function scanAppointments(now = new Date()) {
  const settings = S.apptSettings;
  if (!settings || !settings['appt-activate'] || runtime.scanning) return;
  runtime.scanning = true;
  try {
    syncAgendaFilesConfig();
    await ensureAgendaFilesLoadedAndWait().catch(() => {});
    const vars = currentVars();
    const options = { birthdayProperty: getContactsBirthdayProperty(vars), includeArchived: !getAgendaSkipArchivedTrees(vars), includeCommented: !getAgendaSkipCommentTrees(vars) };
    const docs = aggregateAgendaDocs();
    const horizon = platform.notifications.scheduled ? SCHEDULE_HOURS : SCAN_HOURS;
    const all = upcomingAppointments(docs, now, { ...options, hours: horizon });
    runtime.appointments = all;
    runtime.lastScan = now.getTime();
    runtime.fired = pruneFired(runtime.fired, all, now);
    await holdPlatformNotifications(all, now);
    tick(now);
  } finally {
    runtime.scanning = false;
  }
}

/** On a platform that holds notifications for later, replace what it holds with the whole coming list. Only for window mode with
 *  permission: echo mode is the status line only, with no system notification. */
async function holdPlatformNotifications(appointments, now) {
  const n = platform.notifications;
  if (!n.scheduled) return;
  const settings = S.apptSettings;
  try {
    if (settings['appt-display-format'] !== 'window' || (await n.permission()) !== 'granted') {
      runtime.held = new Set();
      await n.cancelAll();
      return;
    }
    const planned = plannedNotifications(appointments, now, settings['appt-message-warning-time'], settings['appt-display-interval']);
    await n.schedule(planned);
    runtime.held = new Set(planned.map((p) => p.slot));
  } catch {
    // a failure to schedule leaves the in-app reminders working; it is not worth interrupting anything for
  }
}

/** The once-in-a-while check (the app's existing 30-second timer calls it): rescan if it is time, announce what has come due, and
 *  keep the countdown. */
export function apptTick(now = new Date()) {
  const settings = S.apptSettings;
  if (!settings || !settings['appt-activate']) return;
  if (now.getTime() - runtime.lastScan >= settings['appt-agenda-scan-interval'] * 60000) requestApptScan();
  tick(now);
}

function tick(now) {
  const settings = S.apptSettings;
  if (!settings['appt-activate']) return;
  const warning = settings['appt-message-warning-time'];
  for (const { appt, offset, minutes } of dueReminders(runtime.appointments, now, warning, runtime.fired, settings['appt-display-interval'])) {
    runtime.fired.add(reminderSlot(appt, offset));
    announce(appt, offset, minutes);
  }
  S.apptModeLine = settings['appt-display-mode-line'] ? modeLineText(runtime.appointments, now, warning) : null;
  refreshModeLine();
}

function refreshModeLine() {
  if (S.state.doc) renderModeline();
}

/** One reminder, the way appt-display-format says. window: a system notification when permitted (a platform that holds them for later
 *  has already got this one), plus a banner in the app when it is visible or when notifications are blocked. echo: the status line
 *  only. */
function announce(appt, offset, minutes) {
  const text = reminderText(appt, minutes);
  const settings = S.apptSettings;
  if (settings['appt-display-format'] === 'echo') {
    setStatus(text);
    return;
  }
  const n = platform.notifications;
  const visible = typeof document === 'undefined' || !document.hidden;
  const day = dayOf(appt);
  Promise.resolve(n.supported() ? n.permission() : 'denied')
    .then(async (permission) => {
      const allowed = permission === 'granted';
      if (allowed && !(n.scheduled && runtime.held.has(reminderSlot(appt, offset)))) {
        await n.show({ id: appt.id, title: appt.title, body: reminderBody(appt, minutes), detail: appt.detail, day }).catch(() => {});
      }
      if (visible || !allowed) showBanner(appt.title, reminderBody(appt, minutes), appt.detail, day);
    })
    .catch(() => showBanner(appt.title, reminderBody(appt, minutes), appt.detail, day));
}

const dayOf = (appt) => new Date(appt.start.getFullYear(), appt.start.getMonth(), appt.start.getDate()).getTime();

/** Opens that day in the Agenda (what tapping a reminder does). */
export function openApptDay(dayMs) {
  const date = new Date(Number(dayMs));
  if (Number.isNaN(date.getTime())) return;
  S.agendaViewType = 'day';
  S.agendaAnchorDate = date;
  switchToView('agenda');
  render();
}

function listenForTaps() {
  if (runtime.listeningForTaps) return;
  runtime.listeningForTaps = true;
  try {
    platform.notifications.onTap((day) => openApptDay(day));
  } catch {
    // no way to hear taps here; the reminders still arrive
  }
}

// ---- the in-app banner: a toast over the page, so nothing in the layout moves. It stays until it is answered (Open day, or Dismiss),
// and the next reminder for the same appointment replaces it rather than stacking.

function showBanner(title, body, detail, dayMs) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('apptBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'apptBanner';
    el.setAttribute('role', 'alert');
    el.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);top:12px;width:min(94vw,560px);box-sizing:border-box;z-index:10001;padding:16px 18px;border-radius:12px;' +
      'background:var(--bg);color:var(--fg,inherit);border:2px solid #d9822b;box-shadow:0 8px 28px rgba(0,0,0,.45);';
    document.body.appendChild(el);
  }
  el.textContent = '';
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-size:20px;font-weight:700;line-height:1.25;overflow-wrap:anywhere;';
  const when = document.createElement('div');
  when.textContent = body;
  when.style.cssText = 'font-size:17px;margin-top:4px;';
  const text = document.createElement('div');
  text.textContent = detail || '';
  text.style.cssText = 'font-size:15px;margin-top:8px;opacity:.85;white-space:pre-wrap;overflow-wrap:anywhere;max-height:30vh;overflow:auto;';
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:10px;margin-top:12px;';
  const open = menuButton('Open day', () => {
    hideBanner();
    openApptDay(dayMs);
  });
  const dismiss = menuButton('Dismiss', hideBanner);
  buttons.appendChild(open);
  buttons.appendChild(dismiss);
  el.appendChild(heading);
  el.appendChild(when);
  if (detail) el.appendChild(text);
  el.appendChild(buttons);
  el.style.display = 'block';
}

function hideBanner() {
  const el = typeof document === 'undefined' ? null : document.getElementById('apptBanner');
  if (el) el.style.display = 'none';
}

// ---- permission ------------------------------------------------------------------------------------------------------

/** 'allowed' | 'blocked' | 'not asked yet' | 'not available', for the settings line. */
export async function notificationPermissionLabel() {
  const n = platform.notifications;
  if (!n.supported()) return 'not available';
  const permission = await n.permission();
  return permission === 'granted' ? 'allowed' : permission === 'denied' ? 'blocked' : 'not asked yet';
}

/** Asks for permission (it has to come from a tap), then scans again so a platform that holds reminders gets them. */
export async function requestNotificationPermission() {
  const n = platform.notifications;
  if (!n.supported()) return 'denied';
  const permission = await n.request();
  if (S.apptSettings && S.apptSettings['appt-activate']) await scanAppointments().catch(() => {});
  return permission;
}

/** For tests and diagnostics. */
export function apptRuntime() {
  return runtime;
}
