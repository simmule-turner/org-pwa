// @ts-check
// A one-line question asked in the minibuffer, as Emacs does it: the prompt and an input where the status line normally is.
// Return accepts, Escape (C-g) cancels. Returns the text, or null when cancelled.
import { statusEl } from './dom.js';

export const MINIBUFFER_PROMPT_ID = 'minibufferPrompt';

/**
 * @param {string} prompt  e.g. 'Rename buffer (to new name): '
 * @param {string} [initial]
 * @returns {Promise<string | null>} */
export function readFromMinibuffer(prompt, initial = '') {
  return new Promise((resolve) => {
    const old = document.getElementById(MINIBUFFER_PROMPT_ID);
    if (old) old.remove();
    const row = document.createElement('div');
    row.id = MINIBUFFER_PROMPT_ID;
    row.style.cssText = 'display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0';
    const label = document.createElement('label');
    label.textContent = prompt;
    label.style.cssText = 'white-space: nowrap; font-size: 13px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.setAttribute('aria-label', prompt.replace(/:\s*$/, ''));
    input.autocomplete = 'off';
    input.style.cssText = 'flex: 1 1 auto; min-width: 0; min-height: 32px; box-sizing: border-box; padding: 2px 8px; font: inherit; font-size: 14px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg); color: var(--fg)';
    label.appendChild(document.createElement('span'));
    row.appendChild(label);
    row.appendChild(input);
    let done = false;
    /** @param {string | null} value */
    const finish = (value) => {
      if (done) return;
      done = true;
      row.remove();
      statusEl.style.display = 'flex';
      resolve(value);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      } else if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        finish(null);
      }
      e.stopPropagation(); // typing here is not god-mode or a heading shortcut
    };
    statusEl.style.display = 'none';
    statusEl.parentElement?.appendChild(row);
    input.focus();
    input.select();
  });
}
