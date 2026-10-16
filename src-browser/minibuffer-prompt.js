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

/** A one-key question asked in the minibuffer, as Emacs's read-char-choice does: no Enter, the first accepted key answers.
 *  Space answers as `y` and Backspace as `n`; Escape, C-g and Enter answer `q`. Any other key is ignored. The input holds the
 *  keyboard open on a phone; it keeps one invisible character so Backspace has something to delete, and the answer is read from
 *  the typed character rather than the key code, which a phone keyboard often reports as "Unidentified".
 * @param {string} prompt  e.g. 'Save file notes.org? (y, n, !, ., q, d): '
 * @param {string} keys  the characters that answer, e.g. 'yn!.qd'
 * @returns {Promise<string>} one of `keys` */
export function readKeyFromMinibuffer(prompt, keys) {
  return new Promise((resolve) => {
    const old = document.getElementById(MINIBUFFER_PROMPT_ID);
    if (old) old.remove();
    const SENTINEL = '​';
    const row = document.createElement('div');
    row.id = MINIBUFFER_PROMPT_ID;
    row.style.cssText = 'display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0';
    const label = document.createElement('label');
    label.textContent = prompt;
    label.style.cssText = 'white-space: nowrap; font-size: 13px; overflow: hidden; text-overflow: ellipsis';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = SENTINEL;
    input.setAttribute('aria-label', prompt.replace(/:\s*$/, ''));
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.style.cssText = 'flex: 0 0 2.5em; width: 2.5em; min-height: 32px; box-sizing: border-box; padding: 2px 4px; font: inherit; font-size: 14px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg); color: var(--fg)';
    row.appendChild(label);
    row.appendChild(input);
    let done = false;
    /** @param {string} key */
    const answer = (key) => {
      if (done) return;
      done = true;
      row.remove();
      statusEl.style.display = 'flex';
      resolve(key);
    };
    /** Maps what was typed to an answer, or null for a key that isn't one.
     * @param {string} typed */
    const choose = (typed) => {
      if (typed === ' ') return 'y';
      return keys.includes(typed) ? typed : null;
    };
    input.onkeydown = (e) => {
      e.stopPropagation(); // typing here is not god-mode or a heading shortcut
      let key = null;
      if (e.key === 'Escape' || e.key === 'Enter' || (e.ctrlKey && e.key === 'g')) key = 'q';
      else if (e.key === 'Backspace' || e.key === 'Delete') key = 'n';
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) key = choose(e.key);
      else if (e.key === 'Unidentified' || e.key === 'Process') return; // a phone keyboard: beforeinput has the character
      if (key !== null) {
        e.preventDefault();
        answer(key);
      } else if (e.key.length === 1 || e.key === 'Tab') {
        e.preventDefault(); // not an answer: ignored
      }
    };
    input.addEventListener('beforeinput', (e) => {
      const ev = /** @type {InputEvent} */ (e);
      let key = null;
      if (ev.inputType === 'deleteContentBackward' || ev.inputType === 'deleteContentForward') key = 'n';
      else if (ev.inputType === 'insertText' && ev.data) key = choose(ev.data.slice(-1));
      ev.preventDefault();
      if (key !== null) answer(key);
    });
    input.addEventListener('input', () => {
      // a keyboard whose beforeinput can't be cancelled (composition): read what landed, then put the invisible character back
      const typed = input.value.replace(SENTINEL, '').slice(-1);
      input.value = SENTINEL;
      const key = typed ? choose(typed) : 'n';
      if (key !== null) answer(key);
    });
    statusEl.style.display = 'none';
    statusEl.parentElement?.appendChild(row);
    input.focus();
  });
}
