// @ts-check
// The theme and the side panel width: applying them and the Settings section that customizes theme colors.
import { combineHexAlpha, splitHexAlpha } from '../src/hex-alpha.js';
import { S } from './app-state.js';
import { THEME_CSS_VARS, THEME_DEFAULTS, THEME_VAR_LABELS, resolvedThemeName } from './appearance.js';
import { sidePanelEl } from './dom.js';
import { getTheme, setCustomThemeColors } from './settings.js';
import { kv } from './singletons.js';
import { menuButton } from './ui-widgets.js';
import { renderSettingsView } from './settings-view.js';

/** @param {any} [theme] */
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
 * @param {any} [themeName]
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
    const currentValue = themeOverrides[varName] || /** @type {any} */ (THEME_DEFAULTS)[themeName][varName];
    const { rgb, alpha } = splitHexAlpha(currentValue);
    const isCustomized = varName in themeOverrides;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid var(--border)';

    const label = document.createElement('div');
    label.textContent = /** @type {any} */ (THEME_VAR_LABELS)[varName];
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
    opacityInput.setAttribute('aria-label', /** @type {any} */ (THEME_VAR_LABELS)[varName] + ' opacity');
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

/** @param {any} [width] */
export function applySidePanelWidth(width) {
  sidePanelEl.style.flex = `0 0 ${width}px`;
}

