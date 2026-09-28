// Extracted from app.js: clock flow.
import { clockCancel, clockIn, clockInSwitchingTasks, clockOut, findHeadingWithRunningClock, findMostRecentlyClockedHeading } from '../src/clock.js';
import { saveDocument } from '../src/document-store.js';
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { S } from './app-state.js';
import { morePanel } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { extraMenuTargetHeading } from './gestures-structure.js';
import { openEffortEditor } from './heading-commands.js';
import { renderMoreMenu } from './menus.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, menuButton } from './ui-widgets.js';

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

/** The More menu's own entry point for every org-clock action in one
 *  place, structured exactly like Export's own sub-flow (renderExportFlow
 *  above): a step within this same panel, not a separate overlay.
 *  Clock-in resolves its own target heading dynamically, the same way
 *  org-cut-subtree/org-paste-subtree already do from this same kind of
 *  not-heading-specific menu context: whichever heading's own action
 *  menu is currently open, falling back to whichever is
 *  keyboard-focused. Clock-out/clock-cancel act on whichever clock is
 *  actually running anywhere in the document, matching real org's own
 *  actual "only one clock is ever the current one" semantics. */
export function renderClockOptionsFlow() {
  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = 'Clocking:';
  morePanel.appendChild(label);

  const finish = () => {
    S.moreOpen = false;
    S.moreMenuStep = null;
    renderMoreMenu();
  };

  const runningClockAction = (action) => {
    const running = findHeadingWithRunningClock(S.state.doc);
    finish();
    if (!running) {
      setStatus('No clock is currently running.');
      render();
      return;
    }
    action(running);
  };

  const clockingMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).clocking;
  const cancelBtn = aliasedMenuDivItem(clockingMenuAliases, 'Clock-cancel', () => runningClockAction(clockCancelHeading));
  const continueBtn = aliasedMenuDivItem(clockingMenuAliases, 'Clock-continue', () => {
    finish();
    clockContinue();
  });
  const inBtn = aliasedMenuDivItem(clockingMenuAliases, 'Clock-in', () => {
    const target = extraMenuTargetHeading();
    finish();
    if (!target) {
      setStatus('No heading to clock in on -- tap a heading first.');
      render();
      return;
    }
    clockInHeading(target);
  });
  const outBtn = aliasedMenuDivItem(clockingMenuAliases, 'Clock-out', () => runningClockAction(clockOutHeading));
  const effortBtn = aliasedMenuDivItem(clockingMenuAliases, 'Effort', () => {
    const target = extraMenuTargetHeading();
    finish();
    if (!target) {
      setStatus('No heading to set an effort estimate on -- tap a heading first.');
      render();
      return;
    }
    openEffortEditor(target);
  });

  appendMenuButtonsInOrder(morePanel, clockingMenuAliases, [
    { label: 'Clock-cancel', btn: cancelBtn },
    { label: 'Clock-continue', btn: continueBtn },
    { label: 'Clock-in', btn: inBtn },
    { label: 'Clock-out', btn: outBtn },
    { label: 'Effort', btn: effortBtn },
  ]);

  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Back', () => {
      S.moreMenuStep = null;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(backRow);
}
