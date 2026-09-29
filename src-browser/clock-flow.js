// Extracted from app.js: clock flow.
import { clockCancel, clockIn, clockInSwitchingTasks, clockOut, findHeadingWithRunningClock, findMostRecentlyClockedHeading } from '../src/clock.js';
import { saveDocument } from '../src/document-store.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { S } from './app-state.js';
import { commitAndRender, setStatus } from './editing.js';
import { navigateToHeading } from './navigation.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { switchToTab } from './tabs.js';

/** The human-readable "where this would go" label for confirming an
 *  archive. */
/** org-clock-in: starts the clock on `heading`. If a DIFFERENT
 *  heading already has a clock running, it's auto-clocked-out first
 *  (at the exact same moment the new one starts, no gap) -- real
 *  org's own actual org-clock-in behavior, confirmed directly from
 *  its own docstring ("If necessary, clock-out of the currently
 *  active clock"), not a silent second, simultaneous clock left
 *  running elsewhere. A no-op (with a status message, not silent) if
 *  a clock is already running on THIS SAME heading -- real org
 *  doesn't let you double-start the same clock either, it just
 *  continues the existing session. */
/** Whether ANY currently open document has a running clock -- real
 *  org's own genuinely singular org-clock-marker model, scanning
 *  across every open tab (the active one plus every inactive tab's
 *  own snapshotted state in documentSessions), not just whichever one
 *  happens to be active right now. Confirmed via direct testing that
 *  this app's own prior behavior allowed an independent, simultaneous
 *  clock per open tab -- a real gap from real org's own actual
 *  behavior, not a deliberate design choice; there is genuinely only
 *  ever supposed to be one. Returns { heading, tabId, isActive, doc }
 *  for whichever tab has one running, or null if none does. */
export function findRunningClockAcrossSessions() {
  if (S.state.doc) {
    const heading = findHeadingWithRunningClock(S.state.doc);
    if (heading) return { heading, tabId: S.activeTabId, isActive: true, doc: S.state.doc };
  }
  for (const session of S.documentSessions) {
    if (session.tabId === S.activeTabId || !session.state.doc) continue; // the active tab's own live state was already checked above
    const heading = findHeadingWithRunningClock(session.state.doc);
    if (heading) return { heading, tabId: session.tabId, isActive: false, doc: session.state.doc };
  }
  return null;
}

export function clockInHeading(heading) {
  const now = new Date();
  const timestamp = formatOrgTimestamp({ date: now, time: now.toTimeString().slice(0, 5), active: false });

  // Real org's own singular org-clock-marker model: only one clock can
  // ever be running at a time, across every open tab, not just within
  // whichever document happens to be active right now. If it's running
  // in a DIFFERENT, currently-inactive tab, clock it out there directly
  // before starting the new one -- clockInSwitchingTasks below already
  // correctly handles the same-document case on its own.
  let crossTabSwitchedFrom = null;
  const running = findRunningClockAcrossSessions();
  if (running && !running.isActive) {
    if (clockOut(running.heading, timestamp, now)) {
      crossTabSwitchedFrom = running.heading;
      const session = S.documentSessions.find((s) => s.tabId === running.tabId);
      if (session) {
        session.isDirty = true;
        saveDocument({ documentId: session.state.documentId, doc: session.state.doc, kvAdapter: kv }).catch((err) => setStatus('Save failed: ' + err.message));
      }
    }
  }

  const { started, switchedFrom } = clockInSwitchingTasks(S.state.doc, heading, timestamp, now);
  if (!started) {
    setStatus('A clock is already running on this heading.');
    render();
    return;
  }
  const finalSwitchedFrom = switchedFrom || crossTabSwitchedFrom;
  commitAndRender(finalSwitchedFrom ? `Clocked in (stopped the clock on "${finalSwitchedFrom.title}")` : 'Clocked in');
}

/** org-clock-continue: resumes clocking on whichever heading was most
 *  recently clocked, without needing to navigate back to find it
 *  first. A no-op (with a status message) if a clock is already
 *  running anywhere -- "continue the last one" doesn't have a
 *  sensible meaning while one is already active, real org itself
 *  wouldn't let you double-clock either -- or if nothing in the
 *  document has ever been clocked at all. */
export function clockContinue() {
  if (!S.state.doc) return;
  if (findRunningClockAcrossSessions()) {
    setStatus('A clock is already running.');
    render();
    return;
  }
  const target = findMostRecentlyClockedHeading(S.state.doc);
  if (!target) {
    setStatus('Nothing has been clocked yet in this document.');
    render();
    return;
  }
  const now = new Date();
  const timestamp = formatOrgTimestamp({ date: now, time: now.toTimeString().slice(0, 5), active: false });
  clockIn(target, timestamp);
  commitAndRender(`Resumed clock on "${target.title}"`);
}

/** org-clock-goto (C-c C-x C-j): jumps to the headline of the currently
 *  clocked-in task -- in whichever open tab it is running, since there is
 *  only ever one clock across all of them (see findRunningClockAcrossSessions).
 *  Real org also offers, with C-u, a list of recently clocked tasks to pick
 *  from; that variant isn't implemented here. */
export function clockGoto() {
  const running = findRunningClockAcrossSessions();
  if (!running) {
    setStatus('No clock is currently running.');
    render();
    return;
  }
  if (!running.isActive) {
    switchToTab(running.tabId);
    // the switch restores that tab's own session state, so find the clock
    // again in it rather than trust a heading from before the switch
    const restored = findRunningClockAcrossSessions();
    if (!restored || !restored.isActive) return;
    navigateToHeading(restored.heading);
    return;
  }
  navigateToHeading(running.heading);
}

/** org-clock-out: stops whatever clock is currently running on
 *  `heading`. A no-op (with a status message) if nothing is running --
 *  matches clockInHeading's own "surface it, don't silently do
 *  nothing" treatment of the equivalent already-in-that-state case. */
export function clockOutHeading(heading) {
  const end = new Date();
  const timestamp = formatOrgTimestamp({ date: end, time: end.toTimeString().slice(0, 5), active: false });
  if (!clockOut(heading, timestamp, end)) {
    setStatus('No clock is currently running on this heading.');
    render();
    return;
  }
  commitAndRender('Clocked out');
}

/** org-clock-cancel: stops whatever clock is currently running on
 *  `heading` and discards its accumulated time entirely -- no
 *  duration ever gets recorded, unlike clockOutHeading. A no-op (with
 *  a status message) if nothing is running, matching clockOutHeading's
 *  own treatment of the equivalent already-in-that-state case. */
export function clockCancelHeading(heading) {
  if (!clockCancel(heading)) {
    setStatus('No clock is currently running on this heading.');
    render();
    return;
  }
  commitAndRender('Clock cancelled \u2014 time discarded');
}


