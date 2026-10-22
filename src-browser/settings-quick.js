// @ts-check
// The Quick Settings section of Settings: reading a setting's value, saving a change, and drawing each field.
import { applyDurationVariables } from '../src/org-duration.js';
import { mergeGlobalAndLocalVariables, parseGlobalVariables, serializeGlobalVariables } from '../src/global-variables.js';
import { getAgendaStartOnWeekday, isTimeDisplay24, TIME_DISPLAY_FORM_24, DEFAULT_TIME_DISPLAY_FORM, getUseSubSuperscripts, getWeatherRefreshInterval, parseLispBoolean, parseLispNumber, parseLocalVariables } from '../src/local-variables.js';
import { multiEntryDisplayTextToValue, multiEntryValueToDisplayText } from '../src/multi-entry-format.js';
import { serializeOrg } from '../src/org-parser.js';
import { parseLogDoneLispValue } from '../src/progress-logging.js';
import { normalizeSmartQuotes } from '../src/text-normalize.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { openTextFieldPopup } from './dialogs.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { QUICK_SETTINGS_FIELDS } from './settings-fields.js';
import { setGlobalVariables } from './settings.js';
import { kv } from './singletons.js';
import { entryFieldButtonStyle, menuButton, populateSelectOptions, textInputStyle } from './ui-widgets.js';
import { openDocsAtHeading } from './views.js';
import { refreshLocationFromDevice, refreshWeather, whereOrgWeatherIsUsed } from './weather-flow.js';
import { renderSettingsView } from './settings-view.js';

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
 * @param {import('./settings-fields.js').QuickSettingField} field
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
 * @param {string} key
 * @param {string | null} rawValue
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
  applyDurationVariables(vars);
  await setGlobalVariables(kv, S.globalVariablesText);
  if (S.state.doc) {
    S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, parseLocalVariables(serializeOrg(S.state.doc)));
  }
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
}

/**
 * Builds one Quick Settings field's own label + control row.
 * @param {import('./settings-fields.js').QuickSettingField} field
 */
export function renderQuickSettingField(field) {
  const row = document.createElement('div');
  row.style.marginBottom = '10px';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '8px';

  const label = document.createElement('label');
  const isCheckboxType = field.type === 'boolean' || field.type === 'onezero' || field.type === 'hours24';
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
    label.replaceChild(checkbox, /** @type {ChildNode} */ (label.firstChild));
    label.appendChild(labelText);
  } else if (field.type === 'hours24') {
    // calendar-time-display-form is a list: ticked writes the 24-hour one, unticked Emacs's default
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isTimeDisplay24(S.globalVariables);
    checkbox.onchange = async () => {
      await commitGlobalVariableChange(field.key, checkbox.checked ? TIME_DISPLAY_FORM_24 : DEFAULT_TIME_DISPLAY_FORM);
      setStatus(`${field.label}: ${checkbox.checked ? 'on' : 'off'}.`);
      renderSettingsView();
      render();
    };
    label.replaceChild(checkbox, /** @type {ChildNode} */ (label.firstChild));
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
    label.replaceChild(checkbox, /** @type {ChildNode} */ (label.firstChild));
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
        onSave: async (/** @type {any} */ newValue) => {
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
    const current = field.currentValue ? field.currentValue(rawValue) : rawValue !== undefined ? rawValue : field.default;
    populateSelectOptions(select, field.options, current);
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value === field.default ? null : select.value);
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'longtext') {
    /** @param {any} [raw] */
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
        onSave: async (/** @type {any} */ newValue) => {
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
    helpLink.onclick = () => openDocsAtHeading(/** @type {string} */ (field.helpAnchor));
    headerRow.appendChild(helpLink);
  }
  row.appendChild(headerRow);
  return row;
}

/** Groups QUICK_SETTINGS_FIELDS by their own `section`, in first-
 *  appearance order (not alphabetical -- "Progress logging" and
 *  "Agenda" first, "Advanced" last, matches how someone would
 *  actually want to scan this, not dictionary order). */
export function renderQuickSettingsGroups() {
  const sections = [];
  for (const field of QUICK_SETTINGS_FIELDS) {
    /** @type {any} */ let group = sections.find((s) => s.name === field.section);
    if (!group) {
      group = { name: field.section, fields: [] };
      sections.push(group);
    }
    group.fields.push(field);
  }

  /** @type {{ name: string, element: HTMLElement }[]} */
  const cards = [];
  for (const group of sections) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-section';
    cards.push({ name: group.name, element: wrap });
    const groupTitle = document.createElement('div');
    groupTitle.className = 'panel-section-title';
    groupTitle.textContent = group.name;
    wrap.appendChild(groupTitle);
    if (group.name === 'Advanced (raw syntax)') {
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.6';
      hint.style.margin = '2px 0 10px';
      hint.textContent =
        'Friendlier controls for the same app-wide Global Variables baseline the raw text box also edits \u2014 changing one here updates that text too, and vice versa. Applies immediately, no reload needed.';
      wrap.appendChild(hint);
    }

    for (const field of group.fields) {
      wrap.appendChild(renderQuickSettingField(field));
    }

    if (group.name === 'Diary') {
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
        'Add "%%(org-weather)" as a line under any heading (or use it inside a <%%(...)> timestamp) to show today\u2019s weather in the agenda there. Weather uses the latitude and longitude in the Diary card.';
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

  return cards;
}

