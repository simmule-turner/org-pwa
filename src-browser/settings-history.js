// @ts-check
// Undo and redo for settings. Every write to a followed setting is noticed (settings.js tells us), and a moment later the whole set of
// followed settings is kept as one step, named by what changed. Going to a step writes back only what differs, then re-applies it.
// The history lives in memory for the session; logins, their passphrase, and what was open last are not part of it (src/settings-history.js).
import { mergeGlobalAndLocalVariables, parseGlobalVariables } from '../src/global-variables.js';
import { parseLocalVariables } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { changedNames, labelForChange, planRestore, pushCapped, snapshotText } from '../src/settings-history.js';
import { canRedo, canUndo, createHistory, currentEntry, jumpTo, redo, undo } from '../src/undo-history.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { getApptSettings } from './settings.js';
import { S } from './app-state.js';
import { applyFontFamily, applyFontSize, applyMenuSize, applyParagraphSpacing, applyReadingWidth, applyTablesFontSize, applyTablesSpacing } from './appearance.js';
import { setStatus } from './editing.js';
import { syncExtraMenuButtonVisibility } from './menus.js';
import { applySidePanelWidth, applyTheme } from './settings-theme.js';
import { exportAllSettings, getCustomThemeColors, getFontFamily, getFontSize, getGlobalVariables, getMenuSize, getParagraphSpacing, getReadingWidth, getSidePanelWidth, getTablesFontSize, getTablesSpacing, getTheme, importAllSettings, onSettingsWrite, removeSettings } from './settings.js';
import { kv } from './singletons.js';
import { menuButton } from './ui-widgets.js';

/** @type {{ h: import('../src/undo-history.js').UndoHistory | null, timer: number, busy: boolean, redraw: (() => void) | null }} */
const hist = { h: null, timer: 0, busy: false, redraw: null };

async function liveText() {
  const bundle = await exportAllSettings(kv);
  return snapshotText(/** @type {Record<string, unknown>} */ (bundle.settings));
}

/** Starts the history for this session with the settings as they are, and follows every later change. */
export async function startSettingsHistory() {
  hist.h = createHistory(await liveText());
  onSettingsWrite(() => {
    if (hist.busy) return;
    clearTimeout(hist.timer);
    hist.timer = Number(setTimeout(recordNow, 400));
  });
}

async function recordNow() {
  if (!hist.h || hist.busy) return;
  const text = await liveText();
  const before = currentEntry(hist.h).text;
  if (text === before) return;
  hist.h = pushCapped(hist.h, text, labelForChange(changedNames(before, text)));
  if (hist.redraw) hist.redraw();
}

/** Re-applies settings that take effect at once, after they were imported or restored.
 * @param {string[]} names */
export async function reapplySettings(names) {
  if (names.includes('theme')) applyTheme(await getTheme(kv));
  if (names.includes('customThemeColors')) {
    S.customThemeColors = await getCustomThemeColors(kv);
    applyTheme(await getTheme(kv));
  }
  if (names.includes('fontFamily')) applyFontFamily(await getFontFamily(kv));
  if (names.includes('menuSize')) applyMenuSize(await getMenuSize(kv));
  if (names.includes('paragraphSpacing')) applyParagraphSpacing(await getParagraphSpacing(kv));
  if (names.includes('tablesSpacing')) applyTablesSpacing(await getTablesSpacing(kv));
  if (names.includes('fontSize')) applyFontSize(await getFontSize(kv));
  if (names.includes('tablesFontSize')) applyTablesFontSize(await getTablesFontSize(kv));
  if (names.includes('readingWidth')) applyReadingWidth(await getReadingWidth(kv));
  if (names.includes('sidePanelWidth')) applySidePanelWidth(await getSidePanelWidth(kv));
  if (names.includes('appt')) S.apptSettings = await getApptSettings(kv);
  if (names.includes('globalVariables')) {
    S.globalVariablesText = await getGlobalVariables(kv);
    S.globalVariables = parseGlobalVariables(S.globalVariablesText);
    if (S.state.doc) {
      S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, parseLocalVariables(serializeOrg(S.state.doc)));
    }
    syncAgendaFilesConfig();
    syncContactsFilesConfig();
    syncExtraMenuButtonVisibility();
  }
}

/** Goes to a step: writes what differs from now, re-applies it, and moves the history there.
 * @param {number} index */
export async function goToSettingsStep(index) {
  if (!hist.h) return;
  const target = jumpTo(hist.h, index);
  if (target === hist.h) return;
  hist.busy = true;
  try {
    clearTimeout(hist.timer);
    await recordNow2();
    const live = JSON.parse(await liveText());
    const plan = planRestore(live, target.entries[index].text);
    await importAllSettings(kv, { settings: plan.set });
    await removeSettings(kv, plan.remove);
    await reapplySettings(plan.names);
    hist.h = target;
  } finally {
    hist.busy = false;
  }
  if (hist.redraw) hist.redraw();
}

// A change made a moment ago, not yet recorded, becomes a step first so that going back can come forward again.
async function recordNow2() {
  if (!hist.h) return;
  const text = await liveText();
  const before = currentEntry(hist.h).text;
  if (text !== before) hist.h = pushCapped(hist.h, text, labelForChange(changedNames(before, text)));
}

export async function undoSettings() {
  await settleThen(() => (hist.h && canUndo(hist.h) ? goToSettingsStep(undo(hist.h).index) : undefined), 'Nothing to undo in the settings.');
}

export async function redoSettings() {
  await settleThen(() => (hist.h && canRedo(hist.h) ? goToSettingsStep(redo(hist.h).index) : undefined), 'Nothing to redo in the settings.');
}

/** @param {() => Promise<void> | undefined} step
 * @param {string} none */
async function settleThen(step, none) {
  if (hist.h) {
    clearTimeout(hist.timer);
    await recordNow();
  }
  const done = step();
  if (!done) {
    setStatus(none);
    return;
  }
  await done;
  if (hist.h) setStatus(`Settings: ${currentEntry(hist.h).label}.`);
}

/** The "Settings history" card for the Advanced page: Undo and Redo (naming the step), and the list of changes to jump to.
 * @returns {HTMLElement} */
export function buildHistoryCard() {
  const card = document.createElement('div');
  card.className = 'settings-section';
  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'Settings history';
  card.appendChild(title);
  const body = document.createElement('div');
  card.appendChild(body);
  const draw = () => {
    body.replaceChildren();
    const h = hist.h;
    if (!h) return;
    const row = document.createElement('div');
    row.className = 'panel-row';
    const undoLabel = canUndo(h) ? `Undo: ${currentEntry(h).label}` : 'Undo';
    const redoLabel = canRedo(h) ? `Redo: ${h.entries[h.index + 1].label}` : 'Redo';
    const undoBtn = menuButton(undoLabel, () => undoSettings());
    const redoBtn = menuButton(redoLabel, () => redoSettings());
    undoBtn.disabled = !canUndo(h);
    redoBtn.disabled = !canRedo(h);
    row.append(undoBtn, redoBtn, menuButton('Restore from start of session', () => goToSettingsStep(0)));
    body.appendChild(row);
    const list = document.createElement('div');
    list.style.cssText = 'max-height:240px;overflow:auto;margin:6px 0;';
    for (let i = h.entries.length - 1; i >= 0; i--) {
      const e = h.entries[i];
      const item = menuButton(`${i === h.index ? '▶ ' : ''}${e.label} — ${e.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, () => goToSettingsStep(i));
      item.style.display = 'block';
      item.style.textAlign = 'left';
      item.style.width = '100%';
      list.appendChild(item);
    }
    body.appendChild(list);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;opacity:.6;margin:2px 0 6px;';
    hint.textContent =
      'Follows the settings of this session (up to 100 changes). Connection logins, the passphrase, and what was open last are not part of it, and Sync, Export, Rebuild and the like cannot be undone. Document undo does not touch settings.';
    body.appendChild(hint);
  };
  hist.redraw = draw;
  draw();
  return card;
}
