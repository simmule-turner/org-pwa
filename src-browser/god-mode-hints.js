// "Where can this prefix lead?" -- while a god-mode sequence is in progress, a card under the top bar lists the
// keys that would continue it and what each does, like Emacs's which-key. Each entry is a button that sends that
// key, so on a phone a whole chord can be completed by tapping, with no device keyboard. The list itself comes
// from src/god-mode-hints.js, which asks the real key translator, so it cannot disagree with what the keys do.
import { godModeContinuations, isSequenceInProgress, makeChordIndex } from '../src/god-mode-hints.js';
import { S } from './app-state.js';
import { topBarEl } from './dom.js';
import { GOD_MODE_ACTIONS, dispatchGodModeKeystroke, labelForChord } from './god-mode-palette.js';

/** Names for the god-mode chords that have no command-palette entry (movement, focus, table cells, and keys that
 *  are bound but not available yet), so the card never shows a bare chord. test/god-mode-hints.test.js fails if a
 *  chord is bound without a name here or in the palette, and if an entry here is stale. */
export const UNNAMED_CHORD_LABELS = {
  '<up>': 'Previous line',
  '<down>': 'Next line',
  '<left>': 'Collapse heading',
  '<right>': 'Expand one level',
  'S-<up>': 'Table cell above',
  'S-<down>': 'Table cell below',
  'S-<left>': 'Table cell to the left',
  'S-<right>': 'Table cell to the right',
  'M-S-<left>': 'Promote with subtree',
  'M-S-<right>': 'Demote with subtree',
  'C-c C-f': 'Next heading, same level',
  'C-c C-b': 'Previous heading, same level',
  'C-c C-u': 'Parent heading',
  'C-c C-n': 'Next heading',
  'C-c C-p': 'Previous heading',
  'C-c .': 'Edit details',
  'C-c !': 'Edit details',
  'C-c C-d': 'Edit details',
  'C-c C-c': 'Toggle checkbox (not available yet)',
  'C-c |': 'Insert table (not available yet)',
  'C-c l': 'Store link (not available yet)',
  'C-c C-l': 'Insert link (not available yet)',
  'C-c C-o': 'Open link (not available yet)',
  'M-x': 'Command palette',
  'C-h a': 'Command palette (apropos)',
  'C-f': 'Arm redo (then / redoes)',
};

function hintsElement() {
  if (S.godModeHintsEl) return S.godModeHintsEl;
  const el = document.createElement('div');
  el.id = 'godModeHints';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Keys that continue this god-mode sequence');
  el.style.cssText =
    'position:fixed;left:8px;right:8px;z-index:850;max-height:42vh;overflow:auto;box-sizing:border-box;padding:8px;' +
    'border-radius:10px;border:1px solid var(--border-strong);background:var(--modal-bg);color:var(--fg);' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.35);font-size:13px;display:none;';
  document.body.appendChild(el);
  S.godModeHintsEl = el;
  return el;
}

/** What has been typed so far, as the card's heading: "C-c", "M-", "C-c C-x", with "SPC" while literal mode is on. */
function sequenceSoFar(state) {
  const parts = [];
  if (state.chordString) parts.push(state.chordString);
  if (state.pendingModifier === 'M') parts.push('M-');
  if (state.pendingModifier === 'CM') parts.push('C-M-');
  if (state.literalActive) parts.push('(SPC: literal keys)');
  return parts.join(' ') || 'God-mode';
}

function describe(entry) {
  if (entry.chord === null) return entry.rawKey === ' ' ? `literal keys \u2026 ${entry.count}` : `Meta \u2026 ${entry.count}`;
  const label = entry.complete ? labelForChord(entry.chord) || UNNAMED_CHORD_LABELS[entry.chord] || entry.chord : '';
  if (entry.count > 0) return label ? `${label} \u2026` : `${entry.count} more \u2026`;
  return label;
}

function hintButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-hint-key', entry.key);
  button.style.cssText =
    'display:flex;align-items:center;gap:8px;min-height:40px;padding:4px 8px;text-align:left;border:1px solid var(--border-strong);' +
    'background:transparent;color:inherit;border-radius:8px;font-size:13px;cursor:pointer;';
  const key = document.createElement('span');
  key.textContent = entry.key;
  key.style.cssText = 'font-family:monospace;font-weight:700;color:var(--accent);min-width:30px;';
  const label = document.createElement('span');
  label.textContent = describe(entry);
  label.style.cssText = 'flex:1;min-width:0;';
  button.append(key, label);
  // pointerdown only keeps focus where it is, so tapping a hint does not drop the device keyboard
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', () => dispatchGodModeKeystroke(entry.rawKey, entry.shift));
  return button;
}

/** Shows the hint card while a god-mode sequence is in progress, and hides it otherwise. Called from render(). */
export function renderGodModeHints() {
  const state = S.godModeState;
  if (!S.godModeActive || !isSequenceInProgress(state)) {
    if (S.godModeHintsEl) S.godModeHintsEl.style.display = 'none';
    return;
  }
  if (!S.godModeChordIndex) S.godModeChordIndex = makeChordIndex(Object.keys(GOD_MODE_ACTIONS));
  const entries = godModeContinuations(state, S.godModeChordIndex);
  const el = hintsElement();
  if (entries.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.replaceChildren();
  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:12px;opacity:0.75;margin-bottom:6px;';
  heading.textContent = `${sequenceSoFar(state)} \u2026   tap a key or type it \u00b7 Esc cancels`;
  el.appendChild(heading);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;';
  for (const entry of entries) grid.appendChild(hintButton(entry));
  el.appendChild(grid);
  el.style.top = topBarEl.getBoundingClientRect().bottom + 6 + 'px';
  el.style.display = 'block';
}
