// Extracted from app.js: appearance. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).

/** Every CSS custom property a theme actually defines -- the complete
 *  set both applyTheme's own override logic and the Settings UI's
 *  color-customization controls need to know about. Kept as one
 *  shared list so neither can drift out of sync with what
 *  index.html's own :root/[data-theme] rules actually declare. */
export const THEME_CSS_VARS = [
  '--bg',
  '--fg',
  '--border',
  '--border-strong',
  '--surface',
  '--muted',
  '--accent',
  '--todo-bg',
  '--todo-fg',
  '--done-bg',
  '--done-fg',
];

/** Which theme ('light' or 'dark') is actually in effect right now,
 *  resolving 'system' against the LIVE OS preference. Needed because
 *  custom-color overrides are applied as JS-set inline styles, which
 *  -- unlike index.html's own static `@media (prefers-color-scheme:
 *  dark)` CSS rule -- don't automatically re-evaluate when the OS
 *  preference changes; something has to actually re-check and
 *  re-apply (see the matchMedia listener below). */
export function resolvedThemeName(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The actual, current default value for each theme's own 11
 *  customizable CSS variables -- matching index.html's own
 *  html[data-theme="light"]/html[data-theme="dark"] rules exactly.
 *  This is what "Reset" restores a color to, and what a
 *  never-customized color picker shows to start with. Kept here (not
 *  read from the live CSS) since a person could be viewing/editing
 *  the LIGHT theme's colors while DARK is actually active on screen
 *  right now (or vice versa) -- the picker needs to show that other
 *  theme's own values regardless of which one is currently rendered. */
export const THEME_DEFAULTS = {
  light: {
    '--bg': '#ffffff',
    '--fg': '#1a1a1a',
    '--border': '#00000022',
    '--border-strong': '#0000003a',
    '--surface': '#00000009',
    '--muted': '#666666',
    '--accent': '#185fa5',
    '--todo-bg': '#f0997b55',
    '--todo-fg': '#99341d',
    '--done-bg': '#97c45955',
    '--done-fg': '#27500a',
  },
  dark: {
    '--bg': '#16181c',
    '--fg': '#e8e8e8',
    '--border': '#ffffff22',
    '--border-strong': '#ffffff3a',
    '--surface': '#ffffff14',
    '--muted': '#9aa0a6',
    '--accent': '#6fb2ff',
    '--todo-bg': '#ff8f5c40',
    '--todo-fg': '#ffb28c',
    '--done-bg': '#6fcf5740',
    '--done-fg': '#a3e693',
  },
};

export const THEME_VAR_LABELS = {
  '--bg': 'Background',
  '--fg': 'Text',
  '--border': 'Border',
  '--border-strong': 'Border (Strong)',
  '--surface': 'Surface',
  '--muted': 'Muted Text',
  '--accent': 'Accent',
  '--todo-bg': 'TODO Badge Background',
  '--todo-fg': 'TODO Badge Text',
  '--done-bg': 'DONE Badge Background',
  '--done-fg': 'DONE Badge Text',
};

export const FONT_FAMILY_STACKS = {
  system: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};

export function applyFontFamily(fontFamily) {
  document.documentElement.style.setProperty(
    '--app-font-family',
    FONT_FAMILY_STACKS[fontFamily] || FONT_FAMILY_STACKS.system
  );
}

export function applyMenuSize(menuSize) {
  if (menuSize === 'small') {
    document.documentElement.setAttribute('data-menu-size', 'small');
  } else {
    document.documentElement.removeAttribute('data-menu-size'); // 'regular' -- the default, no attribute needed
  }
}

export function applyFontSize(size) {
  document.documentElement.style.setProperty('--app-font-size', size + 'px');
}

export function applyTablesFontSize(size) {
  document.documentElement.style.setProperty('--app-font-size-tables', size + 'px');
}

export function applyReadingWidth(readingWidth) {
  document.documentElement.style.setProperty('--reading-max-width', readingWidth ? readingWidth + 'ch' : 'none');
}
