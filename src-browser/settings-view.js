// @ts-check
// Extracted from app.js: settings view (the theme part is in settings-theme.js, Quick Settings in settings-quick.js).
import { mergeGlobalAndLocalVariables, parseGlobalVariables } from '../src/global-variables.js';
import { parseLocalVariables } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { clearPendingChange, getPendingChange } from '../src/outbox.js';
import { findScrollingAncestor } from '../src/scroll-util.js';
import { normalizeSmartQuotes } from '../src/text-normalize.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { applyFontFamily, applyFontSize, applyMenuSize, applyParagraphSpacing, applyReadingWidth, applyTablesFontSize, applyTablesSpacing } from './appearance.js';
import { syncAgendaToCalendar } from './calendar-sync.js';
import { syncContactsToAddressBook } from './contacts-sync.js';
import { syncNow } from './mirror-sync.js';
import { syncCaptureShortcuts } from './capture-shortcuts.js';
import { confirmDialog, openMultiFieldPopup, openTextFieldPopup } from './dialogs.js';
import { approveExtensionScript, extensionInfo, loadExtensions, saveExtensionFile, saveExtensionScript } from './extension-flow.js';
import { validateCaptureTemplates } from './doc-helpers.js';
import { setStatus } from './editing.js';
import { syncExtraMenuButtonVisibility } from './menus.js';
import { getServiceWorkerVersion } from './render-helpers.js';
import { APP_VERSION } from './version.js';
import { render } from './render.js';
import { DEFAULT_CAPTURE_TEMPLATES, DEFAULT_GLOBAL_VARIABLES, MAX_SPACING, MIN_SPACING, exportAllSettings, getCaptureTemplates, getCustomThemeColors, getFontFamily, getFontSize, getGithubConfig, getGlobalVariables, getMenuSize, getParagraphSpacing, getReadingWidth, getTablesFontSize, getTablesSpacing, getTheme, getWebdavConfig, importAllSettings, setCaptureTemplates, setFontFamily, setFontSize, setGithubConfig, setGlobalVariables, setMenuSize, setParagraphSpacing, setReadingWidth, setTablesFontSize, setTablesSpacing, setTheme, setWebdavConfig, getCaldavConfig, setCaldavConfig, getAttachLinkMode, setAttachLinkMode, getSettingsOrder } from './settings.js';
import { APPT_LIMITS, normalizeApptSettings } from '../src/appt.js';
import { notificationPermissionLabel, requestNotificationPermission, saveApptSettings, scanAppointments } from './appt-flow.js';
import { kv } from './singletons.js';
import { formatPendingChangeTimestamp } from './sync-helpers.js';
import { labeledInput, menuButton, pickTextFile } from './ui-widgets.js';
import { openDocsAtHeading } from './views.js';
import { platform } from './platform.js';
import { saveOut } from './save-out.js';
import { applyTheme, buildThemeColorCustomizationSection } from './settings-theme.js';
import { buildExportCards } from './settings-export.js';
import { buildFullyResolvedGlobalVariablesText, renderQuickSettingsGroups } from './settings-quick.js';
import { renderSettingsShell } from './settings-shell.js';
export { applyTheme, persistAndReapplyThemeColors, buildThemeColorCustomizationSection, applySidePanelWidth } from './settings-theme.js';
export { resolveQuickSettingValue, buildFullyResolvedGlobalVariablesText, commitGlobalVariableChange, renderQuickSettingField, renderQuickSettingsGroups } from './settings-quick.js';


/** Finds the nearest ancestor of `el` (inclusive) that is actually
 *  scrolling right now -- has more content than fits
 *  (scrollHeight > clientHeight) and a computed overflow-y that lets
 *  it scroll at all. This app's own layout has TWO different possible
 *  scrolling containers depending on screen width (#contentArea on a
 *  narrow/mobile layout, since #outline's own overflow-y:auto CSS
 *  rule only applies inside the >=900px desktop media query -- #outline
 *  itself never actually overflows on a phone at all; #outline or
 *  #sidePanel directly on a wide/desktop layout instead, where
 *  #contentArea's own overflow-y:auto, while unconditionally present
 *  in the CSS, doesn't actually trigger there -- see index.html's own
 *  comments on both rules). Reading/writing scrollTop on a specific,
 *  hardcoded element is therefore wrong on whichever layout that
 *  element ISN'T actually the scrolling one for -- a real,
 *  platform-independent CSS/layout fact, not an iOS- or
 *  Android-specific quirk. This walks up to find whichever ancestor
 *  actually is scrolling right now, instead of assuming. */
export async function renderSettingsView(target = S.settingsRenderTarget) {
  S.settingsRenderTarget = target;
  const scrollingEl = findScrollingAncestor(target);
  const savedScrollTop = scrollingEl.scrollTop;
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  target.appendChild(container);

  const config = await getGithubConfig(kv);
  const webdavConfigStored = await getWebdavConfig(kv);
  const theme = await getTheme(kv);
  const fontFamily = await getFontFamily(kv);
  const fontSize = await getFontSize(kv);
  const menuSize = await getMenuSize(kv);
  const paragraphSpacing = await getParagraphSpacing(kv);
  const tablesSpacing = await getTablesSpacing(kv);
  const readingWidth = await getReadingWidth(kv);

  /** Every card of the Settings screen by id; renderSettingsShell decides which page each one lands on. @type {Map<string, HTMLElement>} */
  const cards = new Map();
  const newCard = (/** @type {string} */ id) => {
    const card = document.createElement('div');
    card.className = 'settings-section';
    cards.set(id, card);
    return card;
  };

  let appearanceSection = newCard('appearance-theme');

  const themeTitle = document.createElement('div');
  themeTitle.className = 'panel-section-title';
  themeTitle.textContent = 'Appearance';
  appearanceSection.appendChild(themeTitle);

  const themeRow = document.createElement('div');
  themeRow.className = 'panel-row';
  for (const opt of ['system', 'light', 'dark']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setTheme(kv, opt);
      applyTheme(opt);
      renderSettingsView();
    });
    btn.style.flex = '1'; // equal width per button, instead of sizing to each option's own text length
    if (opt === theme) btn.style.fontWeight = '700';
    themeRow.appendChild(btn);
  }
  appearanceSection.appendChild(themeRow);

  for (const themeName of ['light', 'dark']) {
    appearanceSection.appendChild(buildThemeColorCustomizationSection(themeName));
  }

  appearanceSection = newCard('appearance-font');
  const fontTitle = document.createElement('div');
  fontTitle.className = 'panel-section-title';
  fontTitle.textContent = 'Font';
  appearanceSection.appendChild(fontTitle);

  const fontRow = document.createElement('div');
  fontRow.className = 'panel-row';
  for (const opt of ['system', 'serif', 'monospace']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setFontFamily(kv, opt);
      applyFontFamily(opt);
      renderSettingsView();
    });
    btn.style.flex = '1'; // equal width per button, same reasoning as the theme row above
    if (opt === fontFamily) btn.style.fontWeight = '700';
    fontRow.appendChild(btn);
  }
  appearanceSection.appendChild(fontRow);

  appearanceSection = newCard('appearance-size');
  const sizeTitle = document.createElement('div');
  sizeTitle.className = 'panel-section-title';
  sizeTitle.textContent = 'Font Size';
  appearanceSection.appendChild(sizeTitle);

  const tablesFontSize = await getTablesFontSize(kv);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'panel-row';
  sizeRow.style.alignItems = 'center'; // overrides .panel-row's flex-start default -- correct for label-above-field pairs elsewhere, wrong here (no label, just a number between two taller buttons)
  sizeRow.style.flexWrap = 'wrap'; // lets the "Other" group drop to its own line on a narrow phone rather than clipping or forcing horizontal scroll
  sizeRow.appendChild(
    menuButton('\u2212', async () => {
      const next = Math.max(12, fontSize - 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsView();
    })
  );
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = fontSize + 'px';
  sizeLabel.style.fontSize = '14px';
  sizeLabel.style.minWidth = '40px';
  sizeLabel.style.textAlign = 'center';
  sizeRow.appendChild(sizeLabel);
  sizeRow.appendChild(
    menuButton('+', async () => {
      const next = Math.min(40, fontSize + 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsView();
    })
  );

  const otherDivider = document.createElement('span');
  otherDivider.textContent = '\u2502'; // visual separator between the main and "other" groups on the same row
  otherDivider.style.opacity = '0.3';
  otherDivider.style.margin = '0 4px';
  sizeRow.appendChild(otherDivider);

  const tablesLabel = document.createElement('span');
  tablesLabel.textContent = 'Tables:';
  tablesLabel.style.fontSize = '13px';
  tablesLabel.style.opacity = '0.7';
  sizeRow.appendChild(tablesLabel);

  sizeRow.appendChild(
    menuButton('\u2212', async () => {
      const next = Math.max(10, tablesFontSize - 1);
      await setTablesFontSize(kv, next);
      applyTablesFontSize(next);
      renderSettingsView();
    })
  );
  const tablesSizeLabel = document.createElement('span');
  tablesSizeLabel.textContent = tablesFontSize + 'px';
  tablesSizeLabel.style.fontSize = '14px';
  tablesSizeLabel.style.minWidth = '40px';
  tablesSizeLabel.style.textAlign = 'center';
  sizeRow.appendChild(tablesSizeLabel);
  sizeRow.appendChild(
    menuButton('+', async () => {
      const next = Math.min(24, tablesFontSize + 1);
      await setTablesFontSize(kv, next);
      applyTablesFontSize(next);
      renderSettingsView();
    })
  );

  appearanceSection.appendChild(sizeRow);

  const otherFontHint = document.createElement('div');
  otherFontHint.textContent = 'Applies to tables and other secondary UI text, independent of the main font size above.';
  otherFontHint.style.fontSize = '11px';
  otherFontHint.style.opacity = '0.6';
  otherFontHint.style.margin = '4px 0 8px';
  appearanceSection.appendChild(otherFontHint);

  appearanceSection = newCard('appearance-spacing');
  const paragraphSpacingTitle = document.createElement('div');
  paragraphSpacingTitle.className = 'panel-section-title';
  paragraphSpacingTitle.textContent = 'Paragraph Spacing';
  appearanceSection.appendChild(paragraphSpacingTitle);

  // Laid out exactly like Font Size above: the main value, a divider, then "Tables:" and
  // its own value, which applies to tables and the other secondary blocks independently.
  const spacingRow = document.createElement('div');
  spacingRow.className = 'panel-row';
  spacingRow.style.alignItems = 'center'; // same reason as the Font Size row: a number between two taller buttons
  spacingRow.style.flexWrap = 'wrap'; // lets the Tables group drop to its own line on a narrow phone rather than clipping
  /**
   * @param {string} valueId
   * @param {number} current
   * @param {string} lessLabel
   * @param {string} moreLabel
   * @param {any} save
   * @param {(px: number) => void} apply
   */
  const addSpacingStepper = (valueId, current, lessLabel, moreLabel, save, apply) => {
    /** @param {number} delta */
    const step = async (delta) => {
      const next = Math.min(MAX_SPACING, Math.max(MIN_SPACING, current + delta));
      await save(kv, next);
      apply(next);
      renderSettingsView();
    };
    const less = menuButton('\u2212', () => step(-1));
    less.setAttribute('aria-label', lessLabel);
    spacingRow.appendChild(less);
    const value = document.createElement('span');
    value.id = valueId;
    value.textContent = current + 'px';
    value.style.fontSize = '14px';
    value.style.minWidth = '40px';
    value.style.textAlign = 'center';
    spacingRow.appendChild(value);
    const more = menuButton('+', () => step(1));
    more.setAttribute('aria-label', moreLabel);
    spacingRow.appendChild(more);
  };
  addSpacingStepper('paragraph-spacing-value', paragraphSpacing, 'Less paragraph spacing', 'More paragraph spacing', setParagraphSpacing, applyParagraphSpacing);

  const spacingDivider = document.createElement('span');
  spacingDivider.textContent = '\u2502'; // visual separator between the paragraph and Tables groups on the same row
  spacingDivider.style.opacity = '0.3';
  spacingDivider.style.margin = '0 4px';
  spacingRow.appendChild(spacingDivider);

  const tablesSpacingLabel = document.createElement('span');
  tablesSpacingLabel.textContent = 'Tables:';
  tablesSpacingLabel.style.fontSize = '13px';
  tablesSpacingLabel.style.opacity = '0.7';
  spacingRow.appendChild(tablesSpacingLabel);
  addSpacingStepper('tables-spacing-value', tablesSpacing, 'Less table spacing', 'More table spacing', setTablesSpacing, applyTablesSpacing);
  appearanceSection.appendChild(spacingRow);

  const paragraphSpacingHint = document.createElement('div');
  paragraphSpacingHint.textContent = 'The gap between paragraphs, 0 to 32px (default 10px; 0 packs them together). Tables applies to tables and other secondary blocks (source and quote blocks, rules), independent of the paragraph spacing.';
  paragraphSpacingHint.style.fontSize = '11px';
  paragraphSpacingHint.style.opacity = '0.6';
  paragraphSpacingHint.style.margin = '4px 0 8px';
  appearanceSection.appendChild(paragraphSpacingHint);

  appearanceSection = newCard('appearance-width');
  const readingWidthTitle = document.createElement('div');
  readingWidthTitle.className = 'panel-section-title';
  readingWidthTitle.textContent = 'Reading Width';
  appearanceSection.appendChild(readingWidthTitle);

  const readingWidthRow = document.createElement('div');
  readingWidthRow.className = 'panel-row';
  readingWidthRow.style.alignItems = 'center';
  const readingWidthCheckboxLabel = document.createElement('label');
  readingWidthCheckboxLabel.style.display = 'flex';
  readingWidthCheckboxLabel.style.alignItems = 'center';
  readingWidthCheckboxLabel.style.gap = '8px';
  readingWidthCheckboxLabel.style.cursor = 'pointer';
  readingWidthCheckboxLabel.style.flex = '1 1 auto';
  const readingWidthCheckbox = document.createElement('input');
  readingWidthCheckbox.type = 'checkbox';
  readingWidthCheckbox.checked = readingWidth != null;
  readingWidthCheckbox.onchange = async () => {
    const next = readingWidthCheckbox.checked ? 80 : null;
    await setReadingWidth(kv, next);
    applyReadingWidth(next);
    renderSettingsView();
  };
  readingWidthCheckboxLabel.appendChild(readingWidthCheckbox);
  readingWidthCheckboxLabel.appendChild(document.createTextNode('Limit reading width for long lines'));
  readingWidthRow.appendChild(readingWidthCheckboxLabel);
  appearanceSection.appendChild(readingWidthRow);

  if (readingWidth != null) {
    const readingWidthStepperRow = document.createElement('div');
    readingWidthStepperRow.className = 'panel-row';
    readingWidthStepperRow.style.alignItems = 'center';
    readingWidthStepperRow.appendChild(
      menuButton('\u2212', async () => {
        const next = Math.max(40, readingWidth - 5);
        await setReadingWidth(kv, next);
        applyReadingWidth(next);
        renderSettingsView();
      })
    );
    const readingWidthLabel = document.createElement('span');
    readingWidthLabel.textContent = readingWidth + 'ch';
    readingWidthLabel.style.fontSize = '14px';
    readingWidthLabel.style.minWidth = '50px';
    readingWidthLabel.style.textAlign = 'center';
    readingWidthStepperRow.appendChild(readingWidthLabel);
    readingWidthStepperRow.appendChild(
      menuButton('+', async () => {
        const next = Math.min(200, readingWidth + 5);
        await setReadingWidth(kv, next);
        applyReadingWidth(next);
        renderSettingsView();
      })
    );
    appearanceSection.appendChild(readingWidthStepperRow);
  }

  const readingWidthHint = document.createElement('div');
  readingWidthHint.textContent =
    'Off by default -- the outline uses the full available width, same as everything else in the app. When on, ch is a character-count-based unit that scales with the font size above, so the same comfortable line length holds at any size rather than a fixed pixel width fighting a larger font.';
  readingWidthHint.style.fontSize = '11px';
  readingWidthHint.style.opacity = '0.6';
  readingWidthHint.style.margin = '4px 0 8px';
  appearanceSection.appendChild(readingWidthHint);

  appearanceSection = newCard('appearance-menu');
  const menuSizeTitle = document.createElement('div');
  menuSizeTitle.className = 'panel-section-title';
  menuSizeTitle.textContent = 'Menu Size';
  appearanceSection.appendChild(menuSizeTitle);

  const menuSizeRow = document.createElement('div');
  menuSizeRow.className = 'panel-row';
  for (const opt of ['regular', 'small']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setMenuSize(kv, opt);
      applyMenuSize(opt);
      renderSettingsView();
    });
    btn.style.flex = '1'; // equal width per button, same reasoning as the theme/font rows above
    if (opt === menuSize) btn.style.fontWeight = '700';
    menuSizeRow.appendChild(btn);
  }
  appearanceSection.appendChild(menuSizeRow);

  const menuSizeHint = document.createElement('div');
  menuSizeHint.textContent = 'Applies to every popup menu (File, View, More, Export, and Extras) at once.';
  menuSizeHint.style.fontSize = '11px';
  menuSizeHint.style.opacity = '0.6';
  menuSizeHint.style.margin = '4px 0 8px';
  appearanceSection.appendChild(menuSizeHint);

  for (const group of renderQuickSettingsGroups()) cards.set('quick:' + group.name, group.element);
  const exportCards = buildExportCards(() => renderSettingsView());
  cards.set('export-general', exportCards.general);
  cards.set('export-html', exportCards.html);

  const globalVarsSection = document.createElement('div');
  globalVarsSection.className = 'settings-section';
  cards.set('global-vars', globalVarsSection);

  const globalVarsTitle = document.createElement('div');
  globalVarsTitle.className = 'panel-section-title';
  globalVarsTitle.textContent = 'Global Variables';
  globalVarsSection.appendChild(globalVarsTitle);

  const globalVarsHint = document.createElement('div');
  globalVarsHint.style.fontSize = '11px';
  globalVarsHint.style.opacity = '0.6';
  globalVarsHint.style.margin = '2px 0 6px';
  globalVarsHint.textContent =
    'The same kind of variable a file\u2019s own "# Local Variables:" block or #+STARTUP: line can set, but as the app-wide baseline default across every file \u2014 one per line, same "name: value" format. A file-specific #+STARTUP:/Local Variables setting still overrides this; see Configuration in the README for the full precedence order. Example: org-log-done: \'time';
  globalVarsSection.appendChild(globalVarsHint);

  /** @param {string} newText */
  async function saveGlobalVariablesText(newText) {
    const normalizedText = normalizeSmartQuotes(newText);
    await setGlobalVariables(kv, normalizedText);
    S.globalVariablesText = normalizedText;
    S.globalVariables = parseGlobalVariables(S.globalVariablesText);
    // Re-merge immediately so the currently open document (if any)
    // reflects the change right away -- no reload needed, matching
    // how the theme/font settings already apply on save.
    if (S.state.doc) {
      S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, parseLocalVariables(serializeOrg(S.state.doc)));
    }
    syncAgendaFilesConfig();
    syncContactsFilesConfig();
    setStatus('Global variables saved.');
    renderSettingsView();
    render();
  }

  const globalVarsTextarea = document.createElement('textarea');
  globalVarsTextarea.value = S.globalVariablesText;
  globalVarsTextarea.rows = 2;
  globalVarsTextarea.style.fontFamily = 'monospace';
  globalVarsTextarea.style.fontSize = '12px';
  globalVarsTextarea.style.width = '100%';
  globalVarsTextarea.style.maxWidth = '100%';
  globalVarsTextarea.style.boxSizing = 'border-box';
  globalVarsTextarea.style.resize = 'vertical';
  globalVarsTextarea.readOnly = true;
  globalVarsTextarea.onfocus = () => {
    globalVarsTextarea.blur();
    openTextFieldPopup({
      label: 'Global Variables',
      value: S.globalVariablesText,
      defaultValue: DEFAULT_GLOBAL_VARIABLES,
      onSave: saveGlobalVariablesText,
      onReset:
        S.globalVariablesText !== DEFAULT_GLOBAL_VARIABLES
          ? async () => {
              await saveGlobalVariablesText(DEFAULT_GLOBAL_VARIABLES);
              setStatus('Global variables cleared.');
            }
          : null,
    });
  };
  globalVarsSection.appendChild(globalVarsTextarea);


  // ---- Extensions: the init script (kept on this device only) ----
  const extensionSection = document.createElement('div');
  extensionSection.className = 'settings-section';
  cards.set('extensions', extensionSection);

  const extensionTitle = document.createElement('div');
  extensionTitle.className = 'panel-section-title';
  extensionTitle.textContent = 'Extensions';
  extensionSection.appendChild(extensionTitle);

  const ext = extensionInfo();
  const extensionHint = document.createElement('div');
  extensionHint.style.fontSize = '11px';
  extensionHint.style.opacity = '0.6';
  extensionHint.style.margin = '2px 0 6px';
  extensionHint.textContent =
    'A JavaScript init script that can add your own diary functions, org.sexp("my-name", (ctx, ...args) => ...), which make %%(my-name ...) work in agenda files, and palette commands, org.command("id", "Label", (ctx) => ...), which can read the file (org.document) and change it (org.edit), and hooks, org.on("todo-change" | "capture" | "save" | "open", (ctx) => ...). It can also add table functions, link types, export formats, agenda sources and agenda header lines, and ask (with your permission) for the network, your position and a small cache. It runs in a sandbox, only after you turn on org-xx-extensions in Quick Settings and approve this exact text. It stays on this device: it is not synced, exported or read from any file.';
  extensionSection.appendChild(extensionHint);

  const extensionStatusLine = document.createElement('div');
  extensionStatusLine.style.fontSize = '12px';
  extensionStatusLine.style.margin = '0 0 6px';
  extensionStatusLine.textContent =
    {
      off: 'Off. Set "Run extension scripts" to On in Quick Settings.',
      empty: 'On, but there is no script yet.',
      unapproved: 'Not running: this script has not been approved on this device.',
      running: `Running. Diary functions: ${ext.sexps.length ? ext.sexps.join(', ') : 'none'}. Commands: ${ext.commands.length ? /** @type {any[]} */ (ext.commands).map((c) => c.label).join(', ') : 'none'}. Hooks: ${ext.events.length ? ext.events.join(', ') : 'none'}. Other: ${[...ext.tableFunctions.map((n) => n + '()'), ...ext.linkTypes.map((n) => n + ':'), ...ext.exporters.map((x) => 'Export: ' + x.label), ...ext.agendaSources.map((n) => 'agenda ' + n), ...ext.uiLines.map((n) => 'line ' + n)].join(', ') || 'none'}.`,
      failed: `Stopped: ${ext.message}`,
    }[ext.state] || '';
  extensionSection.appendChild(extensionStatusLine);

  const extensionTextarea = document.createElement('textarea');
  extensionTextarea.value = ext.script;
  extensionTextarea.rows = 4;
  extensionTextarea.style.fontFamily = 'monospace';
  extensionTextarea.style.fontSize = '12px';
  extensionTextarea.style.width = '100%';
  extensionTextarea.style.maxWidth = '100%';
  extensionTextarea.style.boxSizing = 'border-box';
  extensionTextarea.style.resize = 'vertical';
  extensionTextarea.readOnly = true;
  extensionTextarea.setAttribute('aria-label', 'Extension script');
  extensionTextarea.onfocus = () => {
    extensionTextarea.blur();
    if (ext.file) return; // the text comes from the file
    openTextFieldPopup({
      label: 'Extension script (JavaScript)',
      value: ext.script,
      defaultValue: '',
      onSave: async (/** @type {string} */ text) => {
        try {
          await saveExtensionScript(text);
          setStatus('Script saved. Approve it to run it.');
        } catch (err) {
          setStatus(err.message);
        }
        renderSettingsView();
        render();
      },
      onReset: ext.script
        ? async () => {
            await saveExtensionScript('');
            setStatus('Script cleared.');
            renderSettingsView();
            render();
          }
        : null,
    });
  };
  extensionSection.appendChild(extensionTextarea);

  const fileNote = document.createElement('div');
  fileNote.style.fontSize = '11px';
  fileNote.style.opacity = '0.7';
  fileNote.textContent = ext.file
    ? `Tangled from ${ext.file}${ext.file.includes('::') ? '' : ' (target init.js)'}. It is read again when the app starts and when you press Restart; if the file changes you approve it again.`
    : 'Or keep the script in an Org file: its source blocks with :tangle init.js are assembled into the script (Noweb works). Only the file you name here is read.';
  extensionSection.appendChild(fileNote);

  const extensionButtons = document.createElement('div');
  extensionButtons.style.display = 'flex';
  extensionButtons.style.gap = '8px';
  extensionButtons.style.margin = '6px 0';
  if (ext.state === 'unapproved') {
    extensionButtons.appendChild(
      menuButton('Approve and run', async () => {
        await approveExtensionScript();
        setStatus('Script approved on this device.');
        renderSettingsView();
        render();
      })
    );
  }
  if (ext.state === 'running' || ext.state === 'failed' || ext.state === 'unapproved') {
    extensionButtons.appendChild(
      menuButton('Restart', async () => {
        await loadExtensions();
        renderSettingsView();
        render();
      })
    );
  }
  extensionButtons.appendChild(
    menuButton(ext.file ? 'Change file\u2026' : 'Use an Org file\u2026', () => {
      openTextFieldPopup({
        label: 'Script file: github:path, webdav:path or local:name, then ::target (default ::init.js)',
        value: ext.file,
        defaultValue: '',
        onSave: async (/** @type {string} */ text) => {
          await saveExtensionFile(text);
          setStatus(text.trim() ? 'File set. Approve the script to run it.' : 'Using the text typed here.');
          renderSettingsView();
          render();
        },
        onReset: ext.file
          ? async () => {
              await saveExtensionFile('');
              setStatus('Using the text typed here.');
              renderSettingsView();
              render();
            }
          : null,
      });
    })
  );
  extensionSection.appendChild(extensionButtons);

  if (ext.log.length) {
    const extensionLog = document.createElement('pre');
    extensionLog.style.fontSize = '11px';
    extensionLog.style.opacity = '0.8';
    extensionLog.style.whiteSpace = 'pre-wrap';
    extensionLog.style.margin = '4px 0 0';
    extensionLog.textContent = ext.log.slice(-10).join('\n');
    extensionSection.appendChild(extensionLog);
  }

  const captureSection = document.createElement('div');
  captureSection.className = 'settings-section';
  cards.set('capture', captureSection);

  const captureTitle = document.createElement('div');
  captureTitle.className = 'panel-section-title';
  captureTitle.textContent = 'Capture Templates';
  captureSection.appendChild(captureTitle);

  const captureHint = document.createElement('div');
  captureHint.style.fontSize = '12px';
  captureHint.style.opacity = '0.75';
  captureHint.style.margin = '2px 0 6px';
  captureHint.textContent = 'Edited as JSON \u2014 an array of template objects. Full schema, every field, and examples are in the help doc:';
  captureSection.appendChild(captureHint);

  const captureHintLinkRow = document.createElement('div');
  captureHintLinkRow.style.marginBottom = '8px';
  captureHintLinkRow.appendChild(
    menuButton('Capture Templates reference \u2192', () => {
      openDocsAtHeading('#capture-templates');
    })
  );
  captureSection.appendChild(captureHintLinkRow);

  const currentTemplates = await getCaptureTemplates(kv);
  const currentTemplatesText = JSON.stringify(currentTemplates, null, 2);
  const defaultTemplatesText = JSON.stringify(DEFAULT_CAPTURE_TEMPLATES, null, 2);
  const captureTextarea = document.createElement('textarea');
  captureTextarea.value = currentTemplatesText;
  captureTextarea.rows = 2;
  captureTextarea.style.fontFamily = 'monospace';
  captureTextarea.style.fontSize = '12px';
  captureTextarea.style.width = '100%';
  captureTextarea.style.maxWidth = '100%';
  captureTextarea.style.boxSizing = 'border-box';
  captureTextarea.style.resize = 'vertical';
  captureTextarea.readOnly = true;
  captureTextarea.onfocus = () => {
    captureTextarea.blur();
    openTextFieldPopup({
      label: 'Capture Templates',
      value: currentTemplatesText,
      defaultValue: defaultTemplatesText,
      onSave: async (/** @type {any} */ newValue) => {
        let parsed;
        try {
          parsed = JSON.parse(normalizeSmartQuotes(newValue));
        } catch (err) {
          setStatus('Capture templates: invalid JSON \u2014 ' + err.message);
          return;
        }
        const problem = validateCaptureTemplates(parsed);
        if (problem) {
          setStatus('Capture templates: ' + problem);
          return;
        }
        await setCaptureTemplates(kv, parsed);
        syncCaptureShortcuts();
        setStatus('Capture templates saved.');
        renderSettingsView();
        render();
      },
      onReset:
        currentTemplatesText !== defaultTemplatesText
          ? async () => {
              await setCaptureTemplates(kv, DEFAULT_CAPTURE_TEMPLATES);
              syncCaptureShortcuts();
              setStatus('Capture templates reset to defaults.');
              renderSettingsView();
            }
          : null,
    });
  };
  captureSection.appendChild(captureTextarea);

  const pendingSection = document.createElement('div');
  pendingSection.className = 'settings-section';
  cards.set('pending', pendingSection);

  const pendingTitle = document.createElement('div');
  pendingTitle.className = 'panel-section-title';
  pendingTitle.textContent = 'Pending Local Changes';
  pendingSection.appendChild(pendingTitle);

  const pendingHint = document.createElement('div');
  pendingHint.style.fontSize = '11px';
  pendingHint.style.opacity = '0.6';
  pendingHint.style.margin = '2px 0 6px';
  pendingHint.textContent =
    'Edits made while offline (or before a save fully synced) that haven\u2019t been written back to disk/GitHub/WebDAV yet -- opening one of these files again prompts to resume or discard them, but they\u2019re also listed here directly so it\u2019s always clear which files, if any, actually have something pending.';
  pendingSection.appendChild(pendingHint);

  const pendingListEl = document.createElement('div');
  pendingSection.appendChild(pendingListEl);

  async function renderPendingList() {
    pendingListEl.innerHTML = '';
    const { keys } = await kv.list('outbox:');
    if (keys.length === 0) {
      const none = document.createElement('div');
      none.style.fontSize = '12px';
      none.style.opacity = '0.6';
      none.style.padding = '4px 0';
      none.textContent = 'No pending local changes.';
      pendingListEl.appendChild(none);
      return;
    }
    for (const key of keys) {
      const documentId = key.slice('outbox:'.length);
      const entry = await getPendingChange(kv, documentId);
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 0';
      row.style.borderBottom = '1px solid var(--border)';

      const label = document.createElement('div');
      label.style.flex = '1 1 auto';
      label.style.minWidth = '0';
      label.style.fontSize = '13px';
      label.style.overflowWrap = 'anywhere';
      const nameEl = document.createElement('div');
      nameEl.textContent = documentId;
      label.appendChild(nameEl);
      const whenEl = document.createElement('div');
      whenEl.style.fontSize = '11px';
      whenEl.style.opacity = '0.6';
      whenEl.textContent = entry ? formatPendingChangeTimestamp(entry.queuedAt) : '';
      label.appendChild(whenEl);
      row.appendChild(label);

      row.appendChild(
        menuButton('Discard', async () => {
          await clearPendingChange(kv, documentId);
          await renderPendingList();
          setStatus(`Discarded pending changes for "${documentId}".`);
        })
      );
      pendingListEl.appendChild(row);
    }

    if (keys.length > 1) {
      const discardAllRow = document.createElement('div');
      discardAllRow.className = 'panel-row';
      discardAllRow.style.marginTop = '6px';
      discardAllRow.appendChild(
        menuButton('Discard all', async () => {
          for (const key of keys) {
            await clearPendingChange(kv, key.slice('outbox:'.length));
          }
          await renderPendingList();
          setStatus('Discarded all pending local changes.');
        })
      );
      pendingListEl.appendChild(discardAllRow);
    }
  }

  await renderPendingList();

  // ---- Agenda notifications (appt): a device setting, stored under the Emacs names ------------------------------------------
  const apptSection = document.createElement('div');
  apptSection.className = 'settings-section';
  cards.set('appt', apptSection);
  const apptTitle = document.createElement('div');
  apptTitle.className = 'panel-section-title';
  apptTitle.textContent = 'Agenda notifications';
  apptSection.appendChild(apptTitle);

  const appt = S.apptSettings || normalizeApptSettings(null);
  /** @param {any} [change] */
  const saveAppt = async (change) => {
    await saveApptSettings(change);
    renderSettingsView();
  };
  /**
   * @param {string} label
   * @param {'appt-activate' | 'appt-display-mode-line'} key
   * @param {string} hint
   */
  const apptCheckbox = (label, key, hint) => {
    const row = document.createElement('div');
    row.className = 'panel-row';
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;flex:1 1 auto;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = appt[key];
    box.onchange = () => saveAppt({ [key]: box.checked });
    wrap.appendChild(box);
    wrap.appendChild(document.createTextNode(label));
    if (hint) {
      const code = document.createElement('span');
      code.textContent = ' ' + hint;
      code.style.cssText = 'font-size:11px;opacity:.55;margin-left:auto;';
      wrap.appendChild(code);
    }
    row.appendChild(wrap);
    return row;
  };
  /**
   * @param {string} label
   * @param {'appt-message-warning-time' | 'appt-display-interval' | 'appt-agenda-scan-interval'} key
   * @param {string} hint
   * @param {number} step
   * @param {string} unit
   */
  const apptStepper = (label, key, hint, /** @type {number[]} */ limits, step, unit) => {
    const [min, max] = limits;
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.style.alignItems = 'center';
    const text = document.createElement('span');
    text.textContent = label;
    text.style.flex = '1 1 auto';
    row.appendChild(text);
    row.appendChild(menuButton('−', () => saveAppt({ [key]: Math.max(min, appt[key] - step) }), !appt['appt-activate']));
    const value = document.createElement('span');
    value.textContent = `${appt[key]} ${unit}`;
    value.style.cssText = 'font-size:14px;min-width:64px;text-align:center;';
    row.appendChild(value);
    row.appendChild(menuButton('+', () => saveAppt({ [key]: Math.min(max, appt[key] + step) }), !appt['appt-activate']));
    const code = document.createElement('span');
    code.textContent = hint;
    code.style.cssText = 'font-size:11px;opacity:.55;flex-basis:100%;';
    row.style.flexWrap = 'wrap';
    row.appendChild(code);
    return row;
  };
  apptSection.appendChild(apptCheckbox('Agenda notifications', 'appt-activate', 'appt-activate'));
  apptSection.appendChild(apptStepper('Warn this many minutes before', 'appt-message-warning-time', 'appt-message-warning-time', APPT_LIMITS.warning, 1, 'min'));
  apptSection.appendChild(apptStepper('Remind again every', 'appt-display-interval', 'appt-display-interval', APPT_LIMITS.interval, 1, 'min'));
  apptSection.appendChild(apptStepper('Scan agenda files every', 'appt-agenda-scan-interval', 'appt-agenda-scan-interval', APPT_LIMITS.scan, 1, 'min'));
  apptSection.appendChild(apptCheckbox('Countdown in the mode line', 'appt-display-mode-line', 'appt-display-mode-line'));
  const formatRow = document.createElement('div');
  formatRow.className = 'panel-row';
  formatRow.style.cssText = 'align-items:center;flex-wrap:wrap;gap:12px;';
  const formatLabel = document.createElement('span');
  formatLabel.textContent = 'Show reminders as';
  formatRow.appendChild(formatLabel);
  for (const [value, label] of [['window', 'window'], ['echo', 'echo']]) {
    const choice = document.createElement('label');
    choice.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'apptDisplayFormat';
    radio.checked = appt['appt-display-format'] === value;
    radio.onchange = () => saveAppt({ 'appt-display-format': value });
    choice.appendChild(radio);
    choice.appendChild(document.createTextNode(label));
    formatRow.appendChild(choice);
  }
  const formatCode = document.createElement('span');
  formatCode.textContent = 'appt-display-format';
  formatCode.style.cssText = 'font-size:11px;opacity:.55;flex-basis:100%;';
  formatRow.appendChild(formatCode);
  apptSection.appendChild(formatRow);

  const permissionRow = document.createElement('div');
  permissionRow.className = 'panel-row';
  permissionRow.style.alignItems = 'center';
  const permissionText = document.createElement('span');
  permissionText.style.flex = '1 1 auto';
  permissionText.textContent = 'Notifications: …';
  permissionRow.appendChild(permissionText);
  const permissionButton = menuButton('Allow notifications', async () => {
    await requestNotificationPermission();
    renderSettingsView();
  });
  permissionButton.style.display = 'none';
  permissionRow.appendChild(permissionButton);
  apptSection.appendChild(permissionRow);
  notificationPermissionLabel().then((label) => {
    permissionText.textContent = `Notifications: ${label}`;
    permissionButton.style.display = label === 'not asked yet' ? '' : 'none';
    if (label === 'blocked') permissionText.textContent += ' (allow them in the system settings for this app; reminders still show in the app)';
  });

  const exactTiming = platform.notifications.exact;
  if (exactTiming) {
    const exactRow = document.createElement('div');
    exactRow.className = 'panel-row';
    exactRow.style.alignItems = 'center';
    const exactText = document.createElement('span');
    exactText.style.flex = '1 1 auto';
    exactText.textContent = 'Exact timing: \u2026';
    exactRow.appendChild(exactText);
    const exactButton = menuButton('Allow exact timing', async () => {
      await exactTiming.request();
      if (S.apptSettings && S.apptSettings['appt-activate']) await scanAppointments();
      renderSettingsView();
    });
    exactButton.style.display = 'none';
    exactRow.appendChild(exactButton);
    apptSection.appendChild(exactRow);
    exactTiming.status().then((/** @type {any} */ status) => {
      exactText.textContent = status === 'granted' ? 'Exact timing: allowed' : 'Exact timing: not allowed (reminders may be a few minutes late)';
      exactButton.style.display = status === 'granted' ? 'none' : '';
    });
  }

  const apptHint = document.createElement('div');
  apptHint.style.cssText = 'font-size:11px;opacity:.6;margin:2px 0 6px;';
  apptHint.textContent =
    'Announces appointments (agenda items with a time of day, from the open file and your agenda files) once, the warning time before they start. ' +
    'window shows a system notification and a banner in the app; echo uses the status line only. In the Android app, reminders arrive even when the app is closed.';
  apptSection.appendChild(apptHint);

  // ---- Attachments: whether attaching a file also writes a link into the heading's body ------------------------------------
  const attachSection = document.createElement('div');
  attachSection.className = 'settings-section';
  cards.set('attach', attachSection);
  const attachTitle = document.createElement('div');
  attachTitle.className = 'panel-section-title';
  attachTitle.textContent = 'Attachments';
  attachSection.appendChild(attachTitle);
  const linkRow = document.createElement('div');
  linkRow.className = 'panel-row';
  linkRow.style.cssText = 'align-items:center;flex-wrap:wrap;gap:12px;';
  const linkLabel = document.createElement('span');
  linkLabel.textContent = 'Add a link to the body';
  linkRow.appendChild(linkLabel);
  const currentLinkMode = await getAttachLinkMode(kv);
  for (const [value, label] of [['media', 'pictures, audio, video'], ['always', 'always'], ['never', 'never']]) {
    const choice = document.createElement('label');
    choice.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'attachLinkMode';
    radio.checked = currentLinkMode === value;
    radio.onchange = () => setAttachLinkMode(kv, value);
    choice.appendChild(radio);
    choice.appendChild(document.createTextNode(label));
    linkRow.appendChild(choice);
  }
  attachSection.appendChild(linkRow);
  const linkHint = document.createElement('div');
  linkHint.style.cssText = 'font-size:11px;opacity:.6;margin:2px 0 6px;';
  linkHint.textContent = 'Org keeps attachments in a folder and writes no link. A link is what shows a picture or a recording inline under the heading; with never, attachments are found through the Attach menu only.';
  attachSection.appendChild(linkHint);

  const githubSection = document.createElement('div');
  githubSection.className = 'settings-section';
  cards.set('github', githubSection);

  const ghTitle = document.createElement('div');
  ghTitle.className = 'panel-section-title';
  ghTitle.textContent = 'GitHub';
  githubSection.appendChild(ghTitle);

  function openGithubFormPopup() {
    openMultiFieldPopup({
      label: 'GitHub',
      fields: [
        { key: 'token', label: 'Personal access token', type: 'password', value: S.githubConfig.token },
        { key: 'owner', label: 'Owner', type: 'text', value: S.githubConfig.owner, placeholder: 'e.g. octocat' },
        { key: 'repo', label: 'Repo', type: 'text', value: S.githubConfig.repo, placeholder: 'e.g. my-notes' },
        { key: 'branch', label: 'Branch', type: 'text', value: S.githubConfig.branch, placeholder: 'main' },
      ],
      onSave: async (/** @type {any} */ values) => {
        S.githubConfig = await setGithubConfig(kv, { token: values.token, owner: values.owner, repo: values.repo, branch: values.branch || 'main' });
        setStatus('GitHub settings saved.');
        renderSettingsView();
      },
    });
  }

  const ghPreviewFields = [
    labeledInput('Personal access token', 'password', config.token),
    labeledInput('Owner', 'text', config.owner, 'e.g. octocat'),
    labeledInput('Repo', 'text', config.repo, 'e.g. my-notes'),
    labeledInput('Branch', 'text', config.branch, 'main'),
  ];
  for (const field of ghPreviewFields) {
    field.input.readOnly = true;
    field.input.onfocus = () => {
      field.input.blur();
      openGithubFormPopup();
    };
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(field.wrap);
    githubSection.appendChild(row);
  }

  const ghHint = document.createElement('div');
  ghHint.style.fontSize = '11px';
  ghHint.style.opacity = '0.6';
  ghHint.style.margin = '2px 0 6px';
  ghHint.textContent =
    'Use a fine-grained token scoped to just this repo, with Contents read/write access only.';
  githubSection.appendChild(ghHint);

  const webdavSection = document.createElement('div');
  webdavSection.className = 'settings-section';
  cards.set('webdav', webdavSection);

  const webdavTitle = document.createElement('div');
  webdavTitle.className = 'panel-section-title';
  webdavTitle.textContent = 'WebDAV';
  webdavSection.appendChild(webdavTitle);

  function openWebdavFormPopup() {
    openMultiFieldPopup({
      label: 'WebDAV',
      fields: [
        { key: 'baseUrl', label: 'Server URL', type: 'text', value: S.webdavConfig.baseUrl, placeholder: 'e.g. https://dav.example.com/remote.php/dav/files/me' },
        { key: 'username', label: 'Username', type: 'text', value: S.webdavConfig.username },
        { key: 'password', label: 'Password', type: 'password', value: S.webdavConfig.password },
      ],
      onSave: async (/** @type {any} */ values) => {
        S.webdavConfig = await setWebdavConfig(kv, { baseUrl: values.baseUrl, username: values.username, password: values.password });
        setStatus('WebDAV settings saved.');
        renderSettingsView();
      },
    });
  }

  const webdavPreviewFields = [
    labeledInput('Server URL', 'text', webdavConfigStored.baseUrl, 'e.g. https://dav.example.com/remote.php/dav/files/me'),
    labeledInput('Username', 'text', webdavConfigStored.username),
    labeledInput('Password', 'password', webdavConfigStored.password),
  ];
  for (const field of webdavPreviewFields) {
    field.input.readOnly = true;
    field.input.onfocus = () => {
      field.input.blur();
      openWebdavFormPopup();
    };
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(field.wrap);
    webdavSection.appendChild(row);
  }

  const webdavHint = document.createElement('div');
  webdavHint.style.fontSize = '11px';
  webdavHint.style.opacity = '0.6';
  webdavHint.style.margin = '2px 0 6px';
  webdavHint.textContent =
    'Use an app-specific password if your server supports one, not your main account password. ' +
    'Most WebDAV servers need CORS explicitly enabled to accept requests from this app \u2014 ' +
    'if Open/Save fails with a network error, that\u2019s the first thing to check on the server side.';
  webdavSection.appendChild(webdavHint);

  // The calendar the agenda is mirrored to and the address book the contacts are, right after WebDAV: a CalDAV or CardDAV
  // server is often the same host, and one username and password serves both.
  const calendarConfigStored = await getCaldavConfig(kv);
  const calendarSection = document.createElement('div');
  calendarSection.className = 'settings-section';
  cards.set('calendar', calendarSection);
  const calendarTitle = document.createElement('div');
  calendarTitle.className = 'panel-section-title';
  calendarTitle.textContent = 'Calendar (CalDAV) / Contacts (CardDAV)';
  calendarSection.appendChild(calendarTitle);

  function openCalendarFormPopup() {
    openMultiFieldPopup({
      label: 'Calendar (CalDAV) / Contacts (CardDAV)',
      fields: [
        { key: 'url', label: 'Calendar address', type: 'text', value: calendarConfigStored.url, placeholder: 'e.g. https://dav.example.com/radicale/me/calendar/' },
        { key: 'contactsUrl', label: 'Contacts address (same username and password)', type: 'text', value: calendarConfigStored.contactsUrl, placeholder: 'e.g. https://dav.example.com/radicale/me/contacts/' },
        { key: 'username', label: 'Username (blank = the WebDAV one)', type: 'text', value: calendarConfigStored.username },
        { key: 'password', label: 'Password (blank = the WebDAV one)', type: 'password', value: calendarConfigStored.password },
      ],
      onSave: async (/** @type {any} */ values) => {
        S.caldavConfig = await setCaldavConfig(kv, { url: values.url, contactsUrl: values.contactsUrl, username: values.username, password: values.password });
        S.calendarSyncPaused = false;
        S.calendarSyncLastError = null;
        S.contactsSyncPaused = false;
        S.contactsSyncLastError = null;
        setStatus('Calendar and contacts settings saved.');
        renderSettingsView();
        if (S.caldavConfig.url || S.caldavConfig.contactsUrl) syncNow();
      },
    });
  }

  const calendarPreviewFields = [
    labeledInput('Calendar address', 'text', calendarConfigStored.url, 'e.g. https://dav.example.com/radicale/me/calendar/'),
    labeledInput('Contacts address (same username and password)', 'text', calendarConfigStored.contactsUrl, 'e.g. https://dav.example.com/radicale/me/contacts/'),
    labeledInput('Username', 'text', calendarConfigStored.username, 'blank = the WebDAV one'),
    labeledInput('Password', 'password', calendarConfigStored.password, 'blank = the WebDAV one'),
  ];
  for (const field of calendarPreviewFields) {
    field.input.readOnly = true;
    field.input.onfocus = () => {
      field.input.blur();
      openCalendarFormPopup();
    };
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(field.wrap);
    calendarSection.appendChild(row);
  }

  const calendarButtons = document.createElement('div');
  calendarButtons.className = 'panel-row';
  calendarButtons.appendChild(menuButton('Sync', () => syncNow(), !calendarConfigStored.url && !calendarConfigStored.contactsUrl));
  calendarButtons.appendChild(menuButton('Rebuild calendar', () => syncAgendaToCalendar({ manual: true, rebuild: true }), !calendarConfigStored.url));
  calendarButtons.appendChild(menuButton('Rebuild contacts', () => syncContactsToAddressBook({ manual: true, rebuild: true }), !calendarConfigStored.contactsUrl));
  calendarSection.appendChild(calendarButtons);

  const calendarHint = document.createElement('div');
  calendarHint.style.fontSize = '11px';
  calendarHint.style.opacity = '0.6';
  calendarHint.style.margin = '2px 0 6px';
  calendarHint.textContent =
    'Mirrors your agenda, one way, into a calendar you create on the server first. Use a calendar of its own: the app only ever ' +
    'removes events it put there, but edits you make to those in a calendar app are overwritten. Like WebDAV, the server must ' +
    'allow requests from this app (CORS). Leave the address blank to turn it off. ' +
    'Contacts go the same way: your contacts files (org-contacts-files) are mirrored, one way, into an address book you create on the ' +
    'server first, using the same username and password. Sync does both.';
  calendarSection.appendChild(calendarHint);

  const backupSection = document.createElement('div');
  backupSection.className = 'settings-section';
  cards.set('backup', backupSection);

  const backupTitle = document.createElement('div');
  backupTitle.className = 'panel-section-title';
  backupTitle.textContent = 'Backup';
  backupSection.appendChild(backupTitle);

  const backupRow = document.createElement('div');
  backupRow.className = 'panel-row';
  backupRow.appendChild(
    menuButton('Export Settings', async () => {
      const bundle = await exportAllSettings(kv);
      /** @type {any} */ (bundle.settings).globalVariables = buildFullyResolvedGlobalVariablesText();
      const hasCredentials = !!(/** @type {any} */ (bundle.settings).github && /** @type {any} */ (bundle.settings).github.token) || !!(/** @type {any} */ (bundle.settings).webdav && /** @type {any} */ (bundle.settings).webdav.password) || !!(/** @type {any} */ (bundle.settings).caldav && /** @type {any} */ (bundle.settings).caldav.password);
      if (
        hasCredentials &&
        !(await confirmDialog(
          'This file will include your GitHub token and/or WebDAV or calendar password in plain text. Keep it private, and only share it with something you trust. Continue?',
          { confirmLabel: 'Continue', danger: true }
        ))
      ) {
        return;
      }
      saveOut('org-pwa-settings.json', JSON.stringify(bundle, null, 2));
      setStatus('Settings exported \u2014 check your downloads.');
    })
  );
  backupRow.appendChild(
    menuButton('Import Settings\u2026', async () => {
      let content;
      try {
        content = await pickTextFile('.json,application/json');
      } catch {
        return; // picker cancelled -- not an error, nothing to report
      }
      let bundle;
      try {
        bundle = JSON.parse(content);
      } catch (err) {
        setStatus('Could not import settings: the file is not valid JSON.');
        return;
      }
      const imported = await importAllSettings(kv, bundle);
      syncCaptureShortcuts();
      if (imported.length === 0) {
        setStatus('No recognizable settings found in that file.');
        return;
      }
      // Re-apply anything with an immediate visual effect right away,
      // rather than requiring a reload to see the imported theme/fonts
      // take effect.
      if (imported.includes('theme')) applyTheme(await getTheme(kv));
      if (imported.includes('customThemeColors')) {
        S.customThemeColors = await getCustomThemeColors(kv);
        applyTheme(await getTheme(kv));
      }
      if (imported.includes('fontFamily')) applyFontFamily(await getFontFamily(kv));
      if (imported.includes('menuSize')) applyMenuSize(await getMenuSize(kv));
      if (imported.includes('paragraphSpacing')) applyParagraphSpacing(await getParagraphSpacing(kv));
      if (imported.includes('tablesSpacing')) applyTablesSpacing(await getTablesSpacing(kv));
      if (imported.includes('fontSize')) applyFontSize(await getFontSize(kv));
      if (imported.includes('tablesFontSize')) applyTablesFontSize(await getTablesFontSize(kv));
      if (imported.includes('github')) S.githubConfig = await getGithubConfig(kv);
      if (imported.includes('webdav')) S.webdavConfig = await getWebdavConfig(kv);
      if (imported.includes('globalVariables')) {
        S.globalVariablesText = await getGlobalVariables(kv);
        S.globalVariables = parseGlobalVariables(S.globalVariablesText);
        if (S.state.doc) {
          S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, parseLocalVariables(serializeOrg(S.state.doc)));
        }
        syncAgendaFilesConfig();
        syncContactsFilesConfig();
        syncExtraMenuButtonVisibility();
      }
      setStatus('Imported: ' + imported.join(', ') + '.');
      renderSettingsView();
    })
  );
  backupSection.appendChild(backupRow);

  const backupHint = document.createElement('div');
  backupHint.style.fontSize = '11px';
  backupHint.style.opacity = '0.6';
  backupHint.style.margin = '2px 0 6px';
  backupHint.textContent =
    'Export bundles every setting on this page \u2014 appearance, capture templates, GitHub, and WebDAV \u2014 into one file, useful for moving settings to another device. Import merges the file\u2019s settings into what\u2019s already configured here; anything the file doesn\u2019t mention is left untouched.';
  backupSection.appendChild(backupHint);

  // The update check lives at the foot of the Settings home list (settings-shell.js places it): the button centred on a line of its own, the version centred under it, and any status on that same line in bold red.
  const updatesSection = document.createElement('div');
  updatesSection.setAttribute('data-settings-updates', '');
  updatesSection.style.cssText = 'margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-strong)';
  cards.set('updates', updatesSection);

  if (platform.usesServiceWorker) { // no button where there is no service worker to ask
    const updatesRow = document.createElement('div');
    updatesRow.className = 'panel-row';
    updatesRow.style.justifyContent = 'center';
    updatesRow.appendChild(
      menuButton(
        'Check for updates',
      async () => {
        if (!S.swRegistration) {
          S.updateCheckStatus = 'error';
          renderSettingsView();
          return;
        }
        S.updateCheckStatus = 'checking';
        renderSettingsView();
        try {
          await S.swRegistration.update();
          // A successful update() that actually found something newer
          // fires 'updatefound' asynchronously, which showUpdateBanner
          // (see the registration setup above) already handles on its
          // own -- including flipping updateCheckStatus to 'found' and
          // re-rendering Settings again once that lands. Give that a
          // brief moment to actually happen before concluding nothing
          // was found -- 'updatefound' isn't guaranteed to have already
          // fired by the time update()'s own promise resolves.
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (S.updateCheckStatus === 'checking') {
            S.updateCheckStatus = 'up-to-date';
            renderSettingsView();
          }
        } catch {
          S.updateCheckStatus = 'error';
          renderSettingsView();
        }
      },
        !('serviceWorker' in navigator) // a platform without a service worker has nothing to check
      )
    );
    updatesSection.appendChild(updatesRow);
  }

  const versionDisplay = document.createElement('div');
  versionDisplay.setAttribute('data-about-version', '');
  versionDisplay.style.cssText = 'font-size: 13px; text-align: center; margin: 10px 0 6px';
  const versionText = document.createElement('span');
  if (platform.usesServiceWorker) {
    versionText.textContent = 'Version: ' + APP_VERSION; // the code that is running, not what the service worker says is installed
  } else if (S.currentAppVersion) {
    versionText.textContent = 'Version: ' + S.currentAppVersion;
  } else if (S.appVersionCheckState === 'done') {
    versionText.textContent = 'Version: unavailable';
  } else {
    versionText.textContent = 'Version: checking\u2026';
    if (S.appVersionCheckState === 'pending') {
      S.appVersionCheckState = 'checking';
      (platform.usesServiceWorker ? getServiceWorkerVersion() : platform.versionInfo()).then((/** @type {any} */ version) => {
        S.currentAppVersion = version;
        S.appVersionCheckState = 'done';
        if (S.settingsOpen) renderSettingsView();
      });
    }
  }
  versionDisplay.appendChild(versionText);
  // Short words, so the status stays on the version's line.
  const statusWords = [];
  if (platform.usesServiceWorker && S.currentAppVersion && S.currentAppVersion !== APP_VERSION) statusWords.push('Out of date \u2014 reload');
  if (platform.usesServiceWorker) {
    const checked =
      S.updateCheckStatus === 'checking'
        ? 'Checking\u2026'
        : S.updateCheckStatus === 'up-to-date'
          ? 'Up to date'
          : S.updateCheckStatus === 'found'
            ? 'Update found'
            : S.updateCheckStatus === 'error'
              ? 'Check failed'
              : '';
    if (checked) statusWords.push(checked);
  }
  if (statusWords.length > 0) {
    const status = document.createElement('span');
    status.setAttribute('data-about-status', '');
    status.style.cssText = 'color: #c0392b; font-weight: 700; margin-left: 6px';
    status.textContent = statusWords.join(' \u00b7 ');
    versionDisplay.appendChild(status);
  }
  updatesSection.appendChild(versionDisplay);
  if (!platform.usesServiceWorker) {
    const how = document.createElement('div');
    how.style.cssText = 'font-size: 12px; text-align: center; opacity: 0.7';
    how.textContent = 'This app is updated by installing a newer version of it.';
    updatesSection.appendChild(how);
  }

  const savedOrder = await getSettingsOrder(kv);
  renderSettingsShell(container, cards, savedOrder, () => renderSettingsView());

  scrollingEl.scrollTop = savedScrollTop;
}
