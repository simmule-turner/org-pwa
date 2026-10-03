// Extracted from app.js: settings view.
import { mergeGlobalAndLocalVariables, parseGlobalVariables, serializeGlobalVariables } from '../src/global-variables.js';
import { combineHexAlpha, splitHexAlpha } from '../src/hex-alpha.js';
import { getAgendaStartOnWeekday, getUseSubSuperscripts, getWeatherRefreshInterval, parseLispBoolean, parseLispNumber, parseLocalVariables } from '../src/local-variables.js';
import { multiEntryDisplayTextToValue, multiEntryValueToDisplayText } from '../src/multi-entry-format.js';
import { serializeOrg } from '../src/org-parser.js';
import { clearPendingChange, getPendingChange } from '../src/outbox.js';
import { parseLogDoneLispValue } from '../src/progress-logging.js';
import { findScrollingAncestor } from '../src/scroll-util.js';
import { normalizeSmartQuotes } from '../src/text-normalize.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { THEME_CSS_VARS, THEME_DEFAULTS, THEME_VAR_LABELS, applyFontFamily, applyFontSize, applyMenuSize, applyParagraphSpacing, applyReadingWidth, applyTablesFontSize, applyTablesSpacing, resolvedThemeName } from './appearance.js';
import { syncAgendaToCalendar } from './calendar-sync.js';
import { confirmDialog, openMultiFieldPopup, openTextFieldPopup } from './dialogs.js';
import { validateCaptureTemplates } from './doc-helpers.js';
import { sidePanelEl } from './dom.js';
import { setStatus } from './editing.js';
import { downloadFile } from './input-file-adapter.js';
import { syncExtraMenuButtonVisibility } from './menus.js';
import { getServiceWorkerVersion } from './render-helpers.js';
import { render } from './render.js';
import { QUICK_SETTINGS_FIELDS } from './settings-fields.js';
import { DEFAULT_CAPTURE_TEMPLATES, DEFAULT_GLOBAL_VARIABLES, MAX_SPACING, MIN_SPACING, exportAllSettings, getCaptureTemplates, getCustomThemeColors, getFontFamily, getFontSize, getGithubConfig, getGlobalVariables, getMenuSize, getParagraphSpacing, getReadingWidth, getTablesFontSize, getTablesSpacing, getTheme, getWebdavConfig, importAllSettings, setCaptureTemplates, setCustomThemeColors, setFontFamily, setFontSize, setGithubConfig, setGlobalVariables, setMenuSize, setParagraphSpacing, setReadingWidth, setTablesFontSize, setTablesSpacing, setTheme, setWebdavConfig, getCaldavConfig, setCaldavConfig } from './settings.js';
import { kv } from './singletons.js';
import { formatPendingChangeTimestamp } from './sync-helpers.js';
import { entryFieldButtonStyle, labeledInput, menuButton, pickTextFile, populateSelectOptions, textInputStyle } from './ui-widgets.js';
import { openDocsAtHeading } from './views.js';
import { refreshLocationFromDevice, refreshWeather, whereOrgWeatherIsUsed } from './weather-flow.js';

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    // Keep native form-control rendering (unstyled <input>s, date/time
    // pickers, etc.) in sync with the EXPLICIT choice. Without this,
    // color-scheme stays at its static 'light dark' declaration, which
    // means the browser picks native widget colors from the OS's own
    // dark/light preference — independent of what theme the user
    // actually picked in this app. If those disagree (OS in dark mode,
    // user explicitly chose Light here), an unstyled input gets a
    // browser-native DARK background while this app's CSS forces
    // light-theme (dark) text onto it: dark text on a dark background,
    // unreadable. This was the actual cause of "editing a link in light
    // mode, can't see the content" — the input containing the text being
    // edited, not the link's own rendered color.
    document.documentElement.style.colorScheme = theme;
  } else {
    document.documentElement.removeAttribute('data-theme'); // 'system' — let prefers-color-scheme decide
    document.documentElement.style.colorScheme = 'light dark';
  }

  // Clear any previously-applied custom-color overrides first, so
  // switching themes (or updating a color) never leaves a stale
  // override from a different theme/prior state lingering underneath
  // the new one.
  for (const varName of THEME_CSS_VARS) {
    document.documentElement.style.removeProperty(varName);
  }
  const overrides = S.customThemeColors[resolvedThemeName(theme)];
  if (overrides) {
    for (const [varName, value] of Object.entries(overrides)) {
      document.documentElement.style.setProperty(varName, value);
    }
  }
}

/** Persists customThemeColors as it currently stands, re-applies the
 *  theme live (so a change is visible immediately, not after a
 *  reload), and re-renders Settings (so a Reset button's own
 *  enabled/disabled state -- there's nothing left to reset once a
 *  variable's override is gone -- reflects the change). Shared by
 *  every color-change and reset handler below rather than repeating
 *  this three-step sequence at each one. */
export async function persistAndReapplyThemeColors() {
  await setCustomThemeColors(kv, S.customThemeColors);
  applyTheme(await getTheme(kv));
  renderSettingsView();
}

/** One theme's ("light" or "dark") full color-customization section:
 *  a collapsed-by-default toggle (so Appearance stays exactly as
 *  uncluttered as it currently is unless someone actually wants to
 *  customize), expanding to one row per customizable CSS variable --
 *  a color swatch, an opacity slider (needed since several of these
 *  variables use an alpha channel a plain color input can't represent
 *  on its own), and a per-variable Reset -- plus a Reset all for the
 *  whole theme. */
export function buildThemeColorCustomizationSection(themeName) {
  const wrap = document.createElement('div');

  const toggleBtn = menuButton(
    (S.expandedThemeColorSection === themeName ? '\u25be ' : '\u25b8 ') +
      'Customize ' +
      themeName[0].toUpperCase() +
      themeName.slice(1) +
      ' colors',
    () => {
      S.expandedThemeColorSection = S.expandedThemeColorSection === themeName ? null : themeName;
      renderSettingsView();
    }
  );
  toggleBtn.style.width = '100%';
  toggleBtn.style.textAlign = 'left';
  toggleBtn.style.marginTop = '6px';
  wrap.appendChild(toggleBtn);

  if (S.expandedThemeColorSection !== themeName) return wrap;

  const list = document.createElement('div');
  list.style.marginTop = '6px';
  list.style.marginBottom = '6px';

  const themeOverrides = S.customThemeColors[themeName] || {};

  for (const varName of THEME_CSS_VARS) {
    const currentValue = themeOverrides[varName] || THEME_DEFAULTS[themeName][varName];
    const { rgb, alpha } = splitHexAlpha(currentValue);
    const isCustomized = varName in themeOverrides;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid var(--border)';

    const label = document.createElement('div');
    label.textContent = THEME_VAR_LABELS[varName];
    label.style.flex = '1';
    label.style.fontSize = '13px';
    label.style.fontWeight = isCustomized ? '600' : '400';
    row.appendChild(label);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = rgb;
    colorInput.style.width = '36px';
    colorInput.style.height = '32px';
    colorInput.style.padding = '0';
    colorInput.style.border = '1px solid var(--border-strong)';
    colorInput.style.borderRadius = '4px';
    row.appendChild(colorInput);

    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '255';
    opacityInput.value = String(alpha);
    opacityInput.style.width = '70px';
    opacityInput.setAttribute('aria-label', THEME_VAR_LABELS[varName] + ' opacity');
    row.appendChild(opacityInput);

    const applyChange = async () => {
      const newValue = combineHexAlpha(colorInput.value, Number(opacityInput.value));
      if (!S.customThemeColors[themeName]) S.customThemeColors[themeName] = {};
      S.customThemeColors[themeName][varName] = newValue;
      await persistAndReapplyThemeColors();
    };
    colorInput.addEventListener('input', applyChange);
    opacityInput.addEventListener('input', applyChange);

    const resetBtn = menuButton(
      'Reset',
      async () => {
        if (S.customThemeColors[themeName]) delete S.customThemeColors[themeName][varName];
        if (S.customThemeColors[themeName] && Object.keys(S.customThemeColors[themeName]).length === 0) {
          delete S.customThemeColors[themeName];
        }
        await persistAndReapplyThemeColors();
      },
      !isCustomized
    );
    resetBtn.style.fontSize = '11px';
    resetBtn.style.padding = '4px 8px';
    resetBtn.style.minHeight = 'auto';
    row.appendChild(resetBtn);

    list.appendChild(row);
  }
  wrap.appendChild(list);

  const resetAllBtn = menuButton(
    'Reset all ' + themeName[0].toUpperCase() + themeName.slice(1) + ' colors',
    async () => {
      delete S.customThemeColors[themeName];
      await persistAndReapplyThemeColors();
    },
    !S.customThemeColors[themeName]
  );
  resetAllBtn.style.width = '100%';
  resetAllBtn.style.marginBottom = '10px';
  wrap.appendChild(resetAllBtn);

  return wrap;
}

export function applySidePanelWidth(width) {
  sidePanelEl.style.flex = `0 0 ${width}px`;
}

/** Resolves `field`'s own actual current effective value -- whatever
 *  is genuinely in effect right now, whether that's an explicit
 *  override in `globalVariables` or (when nothing's been set) the
 *  field's own documented default -- and serializes it as the exact
 *  string that variable's own value would need to be for a later
 *  re-parse to reproduce the same effective state. Mirrors each field
 *  type's own current-value resolution in renderQuickSettingField
 *  exactly (same parseLispBoolean/parseLispNumber/getAgendaStartOnWeekday/
 *  parseLogDoneLispValue/getUseSubSuperscripts calls), since this needs
 *  to compute precisely what that UI is already showing, not a
 *  second, potentially-drifting notion of "the value." Returns `null`
 *  for a longtext field with nothing set at all (org-refile-targets,
 *  org-agenda-files, org-xx-extra-menu, org-xx-menu-aliases) --
 *  unlike every other type here, an unset longtext field has no
 *  alternate "default value" a future release could ever change out
 *  from under it (empty always means the same thing: nothing
 *  configured), so there's nothing to protect against and nothing
 *  meaningful to bake in. */
export function resolveQuickSettingValue(field) {
  const rawValue = S.globalVariables[field.key];
  switch (field.type) {
    case 'boolean':
      return parseLispBoolean(rawValue, field.default) ? 't' : 'nil';
    case 'number':
      return String(parseLispNumber(rawValue, field.default));
    case 'text':
      return rawValue !== undefined ? rawValue : field.default;
    case 'longtext':
      return rawValue !== undefined && rawValue !== '' ? rawValue : null;
    case 'weekday':
      return String(getAgendaStartOnWeekday(S.globalVariables));
    case 'logdone': {
      const current = parseLogDoneLispValue(rawValue); // 'time' | 'note' | null
      return current ? `'${current}` : "'nil";
    }
    case 'subsuper':
      return getUseSubSuperscripts(S.globalVariables);
    default:
      return rawValue !== undefined ? rawValue : null;
  }
}

/** Builds a FULLY-RESOLVED copy of globalVariablesText for Export
 *  Settings specifically -- every QUICK_SETTINGS_FIELDS key's own
 *  actual current value baked in explicitly (see
 *  resolveQuickSettingValue's own docs for exactly why), layered on
 *  top of whatever's already in globalVariablesText so any variable
 *  NOT covered by a Quick Settings field (there isn't one today, but
 *  this stays correct if that ever changes) is still carried through
 *  untouched. The LIVE globalVariablesText itself -- what the raw
 *  textarea shows, what actually gets saved on every ordinary edit --
 *  is completely unaffected by this; only the bundle Export Settings
 *  produces is different from what's actually stored, and only in
 *  the direction of being MORE complete, never less. */
export function buildFullyResolvedGlobalVariablesText() {
  const resolved = { ...parseGlobalVariables(S.globalVariablesText) };
  for (const field of QUICK_SETTINGS_FIELDS) {
    const value = resolveQuickSettingValue(field);
    if (value !== null) resolved[field.key] = value;
  }
  return serializeGlobalVariables(resolved);
}

/** Writes `key: rawValue` into the app-wide Global Variables baseline
 *  (or removes `key` entirely when `rawValue` is null) -- the exact
 *  same globalVariablesText/globalVariables module-level state the
 *  existing raw textarea reads and writes, kept persisted and
 *  re-merged into the currently open document immediately, the same
 *  "applies right away, no reload needed" convention every other
 *  Settings control here already follows. */
export async function commitGlobalVariableChange(key, rawValue) {
  const normalizedValue = typeof rawValue === 'string' ? normalizeSmartQuotes(rawValue) : rawValue;
  const vars = parseGlobalVariables(S.globalVariablesText);
  if (normalizedValue === null) {
    delete vars[key];
  } else {
    vars[key] = normalizedValue;
  }
  S.globalVariablesText = serializeGlobalVariables(vars);
  S.globalVariables = vars;
  await setGlobalVariables(kv, S.globalVariablesText);
  if (S.state.doc) {
    S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, parseLocalVariables(serializeOrg(S.state.doc)));
  }
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
}

/** Builds one Quick Settings field's own label + control row. */
export function renderQuickSettingField(field) {
  const row = document.createElement('div');
  row.style.marginBottom = '10px';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '8px';

  const label = document.createElement('label');
  const isCheckboxType = field.type === 'boolean' || field.type === 'onezero';
  label.style.display = 'flex';
  label.style.flexDirection = isCheckboxType ? 'row' : 'column';
  label.style.alignItems = isCheckboxType ? 'center' : 'stretch';
  label.style.gap = isCheckboxType ? '8px' : '4px';
  label.style.fontSize = '13px';
  label.style.cursor = isCheckboxType ? 'pointer' : 'default';
  label.style.flex = '1 1 auto';
  label.style.minWidth = '0';

  const labelText = document.createElement('span');
  labelText.textContent = field.label;
  if (isCheckboxType) label.appendChild(document.createElement('span')); // placeholder swapped below, keeps checkbox-then-label DOM order consistent with other checkboxes in this app
  else label.appendChild(labelText);

  const rawValue = S.globalVariables[field.key];

  if (field.type === 'boolean') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = parseLispBoolean(rawValue, field.default);
    checkbox.onchange = async () => {
      await commitGlobalVariableChange(field.key, checkbox.checked ? 't' : 'nil');
      setStatus(`${field.label}: ${checkbox.checked ? 'on' : 'off'}.`);
      renderSettingsView();
      render();
    };
    label.replaceChild(checkbox, label.firstChild);
    label.appendChild(labelText);
  } else if (field.type === 'onezero') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rawValue === undefined ? field.default : String(rawValue).trim() !== '0';
    checkbox.onchange = async () => {
      await commitGlobalVariableChange(field.key, checkbox.checked ? '1' : '0');
      setStatus(`${field.label}: ${checkbox.checked ? 'on' : 'off'}.`);
      renderSettingsView();
      render();
    };
    label.replaceChild(checkbox, label.firstChild);
    label.appendChild(labelText);
  } else if (field.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    textInputStyle(input);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    input.value = String(parseLispNumber(rawValue, field.default));
    input.onchange = async () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) {
        setStatus(`${field.label}: not a valid number, ignored.`);
        render();
        return;
      }
      await commitGlobalVariableChange(field.key, String(n));
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(input);
  } else if (field.type === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    textInputStyle(input);
    input.readOnly = true;
    input.value = rawValue !== undefined ? rawValue : field.default;
    input.onfocus = () => {
      input.blur();
      openTextFieldPopup({
        label: field.label,
        value: rawValue !== undefined ? rawValue : field.default,
        defaultValue: field.default,
        onSave: async (newValue) => {
          const trimmed = normalizeSmartQuotes(newValue).trim();
          await commitGlobalVariableChange(field.key, trimmed === field.default || trimmed === '' ? null : trimmed);
          setStatus(`${field.label} updated.`);
          renderSettingsView();
          render();
        },
        onReset:
          rawValue !== undefined
            ? async () => {
                await commitGlobalVariableChange(field.key, null);
                setStatus(`${field.label} reset to its default.`);
                renderSettingsView();
                render();
              }
            : null,
      });
    };
    label.appendChild(input);
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    textInputStyle(select);
    const current = rawValue !== undefined ? rawValue : field.default;
    populateSelectOptions(select, field.options, current);
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value === field.default ? null : select.value);
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'longtext') {
    const displayValue = (raw) => {
      if (raw === undefined) return '';
      return field.entryTokenizer ? multiEntryValueToDisplayText(raw, field.entryTokenizer) : raw;
    };
    const textarea = document.createElement('textarea');
    textarea.rows = field.entryTokenizer ? 4 : 2; // multi-line entries need more visible room than a single flat line did
    textarea.style.fontFamily = 'monospace';
    textarea.style.fontSize = '12px';
    textarea.style.width = '100%';
    textarea.style.maxWidth = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.resize = 'vertical';
    textarea.readOnly = true;
    textarea.value = displayValue(rawValue);
    textarea.onfocus = () => {
      textarea.blur();
      openTextFieldPopup({
        label: field.label,
        value: displayValue(rawValue),
        defaultValue: '',
        onSave: async (newValue) => {
          const normalized = normalizeSmartQuotes(newValue).trim();
          const canonical = field.entryTokenizer ? multiEntryDisplayTextToValue(normalized, field.entryTokenizer) : normalized;
          await commitGlobalVariableChange(field.key, canonical === '' ? null : canonical);
          setStatus(`${field.label} updated.`);
          renderSettingsView();
          render();
        },
        onReset:
          rawValue !== undefined
            ? async () => {
                await commitGlobalVariableChange(field.key, null);
                setStatus(`${field.label} reset to its default.`);
                renderSettingsView();
                render();
              }
            : null,
      });
    };
    label.appendChild(textarea);
  } else if (field.type === 'weekday') {
    const select = document.createElement('select');
    textInputStyle(select);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const current = getAgendaStartOnWeekday(S.globalVariables);
    for (let i = 0; i < 7; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = dayNames[i];
      if (i === current) option.selected = true;
      select.appendChild(option);
    }
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value);
      setStatus(`${field.label}: ${dayNames[Number(select.value)]}.`);
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'logdone') {
    const select = document.createElement('select');
    textInputStyle(select);
    const current = parseLogDoneLispValue(rawValue); // 'time' | 'note' | null
    const options = [
      { value: '', text: 'Off (no logging)' },
      { value: 'time', text: 'Timestamp (CLOSED:)' },
      { value: 'note', text: 'Note (prompted in LOGBOOK)' },
    ];
    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.text;
      if ((current || '') === opt.value) optionEl.selected = true;
      select.appendChild(optionEl);
    }
    select.onchange = async () => {
      const v = select.value;
      await commitGlobalVariableChange(field.key, v ? `'${v}` : null);
      setStatus('org-log-done updated.');
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'subsuper') {
    const select = document.createElement('select');
    textInputStyle(select);
    const current = getUseSubSuperscripts(S.globalVariables);
    const options = [
      { value: 't', text: 'Always (a_b \u2192 subscript)' },
      { value: '{}', text: 'Only with {braces} (a_{b})' },
      { value: 'nil', text: 'Never' },
    ];
    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.text;
      if (current === opt.value) optionEl.selected = true;
      select.appendChild(optionEl);
    }
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value);
      setStatus('org-use-sub-superscripts updated.');
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  }

  headerRow.appendChild(label);
  if (rawValue !== undefined) {
    const resetLink = document.createElement('span');
    resetLink.textContent = '\u21ba';
    resetLink.title = `Reset ${field.label} to its default`;
    resetLink.style.flexShrink = '0';
    resetLink.style.opacity = '0.6';
    resetLink.style.fontSize = '15px';
    resetLink.style.cursor = 'pointer';
    resetLink.style.padding = '0 4px';
    resetLink.onclick = async () => {
      await commitGlobalVariableChange(field.key, null);
      setStatus(`${field.label} reset to its default.`);
      renderSettingsView();
      render();
    };
    headerRow.appendChild(resetLink);
  }
  if (field.helpAnchor) {
    const helpLink = document.createElement('span');
    helpLink.textContent = '?';
    helpLink.title = 'Open the help doc for this setting';
    helpLink.style.flexShrink = '0';
    helpLink.style.opacity = '0.6';
    helpLink.style.fontSize = '13px';
    helpLink.style.cursor = 'pointer';
    helpLink.style.padding = '0 4px';
    helpLink.onclick = () => openDocsAtHeading(field.helpAnchor);
    headerRow.appendChild(helpLink);
  }
  row.appendChild(headerRow);
  return row;
}

/** Groups QUICK_SETTINGS_FIELDS by their own `section`, in first-
 *  appearance order (not alphabetical -- "Progress logging" and
 *  "Agenda" first, "Advanced" last, matches how someone would
 *  actually want to scan this, not dictionary order). */
export function renderQuickSettingsSection() {
  const wrap = document.createElement('div');
  wrap.className = 'settings-section';

  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'Quick Settings';
  wrap.appendChild(title);

  const hint = document.createElement('div');
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.6';
  hint.style.margin = '2px 0 10px';
  hint.textContent =
    'Friendlier controls for the same app-wide Global Variables baseline the raw text box below also edits \u2014 changing one here updates that text too, and vice versa. Applies immediately, no reload needed.';
  wrap.appendChild(hint);

  const sections = [];
  for (const field of QUICK_SETTINGS_FIELDS) {
    let group = sections.find((s) => s.name === field.section);
    if (!group) {
      group = { name: field.section, fields: [] };
      sections.push(group);
    }
    group.fields.push(field);
  }

  for (const group of sections) {
    const groupTitle = document.createElement('div');
    groupTitle.style.fontSize = '12px';
    groupTitle.style.fontWeight = '600';
    groupTitle.style.opacity = '0.7';
    groupTitle.style.margin = '10px 0 6px';
    groupTitle.textContent = group.name;
    wrap.appendChild(groupTitle);

    for (const field of group.fields) {
      wrap.appendChild(renderQuickSettingField(field));
    }

    if (group.name === 'Contacts & Calendar') {
      const geoRow = document.createElement('div');
      geoRow.className = 'panel-row';
      geoRow.style.marginBottom = '10px';
      geoRow.appendChild(menuButton('\ud83d\udccd Use device location', refreshLocationFromDevice));
      wrap.appendChild(geoRow);
    }

    if (group.name === 'Weather') {
      const weatherHint = document.createElement('div');
      weatherHint.style.fontSize = '11px';
      weatherHint.style.opacity = '0.6';
      weatherHint.style.margin = '2px 0 6px';
      weatherHint.textContent =
        'Add "%%(org-weather)" as a line under any heading (or use it inside a <%%(...)> timestamp) to show today\u2019s weather in the agenda there.';
      wrap.appendChild(weatherHint);

      const weatherStatus = document.createElement('div');
      weatherStatus.style.fontSize = '13px';
      weatherStatus.style.marginBottom = '6px';
      const refreshedText = S.weatherLastRefreshed ? `Last refreshed: ${new Date(S.weatherLastRefreshed).toLocaleString()}` : 'Never refreshed yet.';
      const weatherUsage = whereOrgWeatherIsUsed();
      const usageNote =
        weatherUsage === 'current'
          ? ''
          : weatherUsage === 'agenda'
          ? ' Used via an agenda file, not the current document.'
          : ' Not used in the current document yet.';
      weatherStatus.textContent = refreshedText + usageNote;
      wrap.appendChild(weatherStatus);

      const weatherRow = document.createElement('div');
      weatherRow.className = 'panel-row';
      weatherRow.style.marginBottom = '10px';
      const refreshWeatherBtn = menuButton('\ud83c\udf24\ufe0f Refresh weather', async () => {
        await refreshWeather();
        renderSettingsView();
      });
      entryFieldButtonStyle(refreshWeatherBtn);
      weatherRow.appendChild(refreshWeatherBtn);

      const REFRESH_INTERVAL_OPTIONS = [
        { value: 'never', label: 'Never' },
        { value: '1', label: '1h' },
        { value: '2', label: '2h' },
        { value: '4', label: '4h' },
        { value: '6', label: '6h' },
        { value: '12', label: '12h' },
        { value: '24', label: '24h' },
      ];
      const refreshIntervalSelect = document.createElement('select');
      refreshIntervalSelect.setAttribute('aria-label', 'Auto-refresh weather every');
      textInputStyle(refreshIntervalSelect, true);
      const currentInterval = getWeatherRefreshInterval(S.globalVariables);
      populateSelectOptions(refreshIntervalSelect, REFRESH_INTERVAL_OPTIONS, currentInterval);
      refreshIntervalSelect.onchange = async () => {
        const chosenValue = refreshIntervalSelect.value;
        await commitGlobalVariableChange('org-weather-refresh-interval', chosenValue === 'never' ? null : chosenValue);
        const statusPhrase = chosenValue === 'never' ? 'never' : chosenValue === '1' ? 'every hour' : `every ${chosenValue} hours`;
        setStatus(`Weather auto-refresh: ${statusPhrase}.`);
        renderSettingsView();
        render();
      };
      weatherRow.appendChild(refreshIntervalSelect);
      wrap.appendChild(weatherRow);
    }
  }

  return wrap;
}

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

  const appearanceSection = document.createElement('div');
  appearanceSection.className = 'settings-section';
  container.appendChild(appearanceSection);

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
  const addSpacingStepper = (valueId, current, lessLabel, moreLabel, save, apply) => {
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

  container.appendChild(renderQuickSettingsSection());

  const globalVarsSection = document.createElement('div');
  globalVarsSection.className = 'settings-section';
  container.appendChild(globalVarsSection);

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

  const captureSection = document.createElement('div');
  captureSection.className = 'settings-section';
  container.appendChild(captureSection);

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
      onSave: async (newValue) => {
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
        setStatus('Capture templates saved.');
        renderSettingsView();
        render();
      },
      onReset:
        currentTemplatesText !== defaultTemplatesText
          ? async () => {
              await setCaptureTemplates(kv, DEFAULT_CAPTURE_TEMPLATES);
              setStatus('Capture templates reset to defaults.');
              renderSettingsView();
            }
          : null,
    });
  };
  captureSection.appendChild(captureTextarea);

  const pendingSection = document.createElement('div');
  pendingSection.className = 'settings-section';
  container.appendChild(pendingSection);

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

  const githubSection = document.createElement('div');
  githubSection.className = 'settings-section';
  container.appendChild(githubSection);

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
      onSave: async (values) => {
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
  container.appendChild(webdavSection);

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
      onSave: async (values) => {
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

  // The calendar the agenda is mirrored to, right after WebDAV: a CalDAV server is often the same host.
  const calendarConfigStored = await getCaldavConfig(kv);
  const calendarSection = document.createElement('div');
  calendarSection.className = 'settings-section';
  container.appendChild(calendarSection);
  const calendarTitle = document.createElement('div');
  calendarTitle.className = 'panel-section-title';
  calendarTitle.textContent = 'Calendar (CalDAV)';
  calendarSection.appendChild(calendarTitle);

  function openCalendarFormPopup() {
    openMultiFieldPopup({
      label: 'Calendar (CalDAV)',
      fields: [
        { key: 'url', label: 'Calendar address', type: 'text', value: calendarConfigStored.url, placeholder: 'e.g. https://dav.example.com/radicale/me/calendar/' },
        { key: 'username', label: 'Username (blank = the WebDAV one)', type: 'text', value: calendarConfigStored.username },
        { key: 'password', label: 'Password (blank = the WebDAV one)', type: 'password', value: calendarConfigStored.password },
      ],
      onSave: async (values) => {
        S.caldavConfig = await setCaldavConfig(kv, { url: values.url, username: values.username, password: values.password });
        S.calendarSyncPaused = false;
        S.calendarSyncLastError = null;
        setStatus('Calendar settings saved.');
        renderSettingsView();
        if (S.caldavConfig.url) syncAgendaToCalendar({ manual: true });
      },
    });
  }

  const calendarPreviewFields = [
    labeledInput('Calendar address', 'text', calendarConfigStored.url, 'e.g. https://dav.example.com/radicale/me/calendar/'),
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
  calendarButtons.appendChild(menuButton('Sync now', () => syncAgendaToCalendar({ manual: true }), !calendarConfigStored.url));
  calendarButtons.appendChild(menuButton('Rebuild calendar', () => syncAgendaToCalendar({ manual: true, rebuild: true }), !calendarConfigStored.url));
  calendarSection.appendChild(calendarButtons);

  const calendarHint = document.createElement('div');
  calendarHint.style.fontSize = '11px';
  calendarHint.style.opacity = '0.6';
  calendarHint.style.margin = '2px 0 6px';
  calendarHint.textContent =
    'Mirrors your agenda, one way, into a calendar you create on the server first. Use a calendar of its own: the app only ever ' +
    'removes events it put there, but edits you make to those in a calendar app are overwritten. Like WebDAV, the server must ' +
    'allow requests from this app (CORS). Leave the address blank to turn it off.';
  calendarSection.appendChild(calendarHint);

  const backupSection = document.createElement('div');
  backupSection.className = 'settings-section';
  container.appendChild(backupSection);

  const backupTitle = document.createElement('div');
  backupTitle.className = 'panel-section-title';
  backupTitle.textContent = 'Backup';
  backupSection.appendChild(backupTitle);

  const backupRow = document.createElement('div');
  backupRow.className = 'panel-row';
  backupRow.appendChild(
    menuButton('Export Settings', async () => {
      const bundle = await exportAllSettings(kv);
      bundle.settings.globalVariables = buildFullyResolvedGlobalVariablesText();
      const hasCredentials = !!(bundle.settings.github && bundle.settings.github.token) || !!(bundle.settings.webdav && bundle.settings.webdav.password) || !!(bundle.settings.caldav && bundle.settings.caldav.password);
      if (
        hasCredentials &&
        !(await confirmDialog(
          'This file will include your GitHub token and/or WebDAV or calendar password in plain text. Keep it private, and only share it with something you trust. Continue?',
          { confirmLabel: 'Continue', danger: true }
        ))
      ) {
        return;
      }
      downloadFile('org-pwa-settings.json', JSON.stringify(bundle, null, 2));
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

  const updatesSection = document.createElement('div');
  updatesSection.className = 'settings-section';
  // org-xx-updates-at-top (this app's own extension, not a real
  // org-mode variable -- same "org-xx-" convention as
  // org-xx-extra-menu/org-xx-menu-aliases): true (the
  // default, matching real org's own t/nil convention for "unset"
  // meaning "on") puts Updates at the very top of Settings, since for
  // many people it's the single most-used entry on this whole page;
  // explicitly nil keeps it at its own original position instead, for
  // anyone who'd rather Settings stay in its previous, familiar order.
  const updatesAtTop = parseLispBoolean((S.state.localVariables || {})['org-xx-updates-at-top'], true);
  if (updatesAtTop) {
    container.insertBefore(updatesSection, container.firstChild);
  } else {
    container.appendChild(updatesSection);
  }

  const updatesTitle = document.createElement('div');
  updatesTitle.className = 'panel-section-title';
  updatesTitle.textContent = 'Updates';
  updatesSection.appendChild(updatesTitle);

  const versionDisplay = document.createElement('div');
  versionDisplay.style.fontSize = '12px';
  versionDisplay.style.opacity = '0.6';
  versionDisplay.style.marginBottom = '6px';
  if (S.currentAppVersion) {
    versionDisplay.textContent = 'Version: ' + S.currentAppVersion;
  } else if (S.appVersionCheckState === 'done') {
    versionDisplay.textContent = 'Version: unavailable';
  } else {
    versionDisplay.textContent = 'Version: checking\u2026';
    if (S.appVersionCheckState === 'pending') {
      S.appVersionCheckState = 'checking';
      getServiceWorkerVersion().then((version) => {
        S.currentAppVersion = version;
        S.appVersionCheckState = 'done';
        if (S.settingsOpen) renderSettingsView();
      });
    }
  }
  updatesSection.appendChild(versionDisplay);

  const updatesRow = document.createElement('div');
  updatesRow.className = 'panel-row';
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
      !('serviceWorker' in navigator)
    )
  );
  updatesSection.appendChild(updatesRow);

  const updatesStatus = document.createElement('div');
  updatesStatus.style.fontSize = '12px';
  updatesStatus.style.marginTop = '6px';
  updatesStatus.textContent =
    S.updateCheckStatus === 'checking'
      ? 'Checking\u2026'
      : S.updateCheckStatus === 'up-to-date'
        ? 'You\u2019re on the latest version.'
        : S.updateCheckStatus === 'found'
          ? 'An update was found \u2014 use the Reload banner at the top to apply it.'
          : S.updateCheckStatus === 'error'
            ? 'Couldn\u2019t check for updates right now.'
            : '';
  updatesSection.appendChild(updatesStatus);

  scrollingEl.scrollTop = savedScrollTop;
}
