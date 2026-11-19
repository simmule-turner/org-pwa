// @ts-check
// Emacs mode's minibuffer: a prompt on the bottom line of the text with the matches above it (completion as Emacs's try-completion has it,
// src/emacs-complete.js), and a read-only list for *Messages* and the buffer list. Plain DOM on the text's wrapper; nothing else moves.
import { allCompletions, completeInput } from '../src/emacs-complete.js';

/** @param {HTMLElement} host @returns {HTMLDivElement} */
function panel(host) {
  const box = document.createElement('div');
  box.className = 'te-minibuffer';
  box.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;background:var(--surface);border-top:1px solid var(--border);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;';
  host.appendChild(box);
  return box;
}

/**
 * Reads a line with completion.
 * @param {{ host: HTMLElement, prompt: string, candidates: string[], initial?: string, fold?: boolean, requireMatch?: boolean,
 *   history?: string[], message?: (text: string) => void }} o
 * @returns {Promise<string | null>} what was typed, or null when quit (C-g or Esc)
 */
export function readMinibuffer(o) {
  return new Promise((resolve) => {
    const box = panel(o.host);
    const list = document.createElement('div');
    list.style.cssText = 'max-height:8.5em;overflow-y:auto;padding:2px 8px;display:flex;flex-wrap:wrap;gap:2px 16px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;';
    const label = document.createElement('span');
    label.textContent = o.prompt;
    label.style.cssText = 'font-weight:bold;white-space:pre;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = o.initial ?? '';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = 'flex:1;min-width:0;font:inherit;border:0;outline:0;background:transparent;color:inherit;';
    const note = document.createElement('span');
    note.style.cssText = 'opacity:.7;white-space:nowrap;';
    row.append(label, input, note);
    box.append(list, row);
    const history = o.history ?? [];
    let historyAt = -1;
    const fold = o.fold ?? false;

    const refresh = () => {
      list.replaceChildren();
      for (const name of allCompletions(input.value, o.candidates, fold).slice(0, 200)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = name;
        item.style.cssText = 'font:inherit;border:0;background:transparent;color:inherit;padding:0;cursor:pointer;';
        item.onclick = () => {
          input.value = name;
          refresh();
          input.focus();
        };
        list.appendChild(item);
      }
    };
    const finish = (/** @type {string | null} */ value) => {
      box.remove();
      resolve(value);
    };
    input.addEventListener('input', () => {
      note.textContent = '';
      refresh();
    });
    input.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey;
      if (e.key === 'Escape' || (ctrl && e.key === 'g')) {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const typed = input.value;
        if (o.requireMatch && !o.candidates.includes(typed)) {
          const done = completeInput(typed, o.candidates, fold);
          if (done.input !== typed && allCompletions(done.input, o.candidates, fold).length === 1 && o.candidates.includes(done.input)) finish(done.input);
          else {
            note.textContent = '[No match]';
            o.message?.('[No match]');
          }
          return;
        }
        finish(typed);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const done = completeInput(input.value, o.candidates, fold);
        input.value = done.input;
        note.textContent = done.message;
        refresh();
      } else if ((e.altKey && e.key === 'p') || (e.altKey && e.key === 'n') || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const older = e.key === 'ArrowUp' || e.key === 'p';
        historyAt = Math.max(-1, Math.min(history.length - 1, historyAt + (older ? 1 : -1)));
        input.value = historyAt < 0 ? '' : history[historyAt];
        refresh();
      }
    });
    refresh();
    input.focus();
  });
}

/**
 * A read-only list over the text (the *Messages* log, the buffer list): `q`, Esc, C-g or a tap on its title close it; a line can be picked when `onPick` is given.
 * @param {{ host: HTMLElement, title: string, lines: string[], onPick?: (index: number) => void }} o
 * @returns {Promise<void>}
 */
export function showList(o) {
  return new Promise((resolve) => {
    const box = panel(o.host);
    box.style.top = '0';
    box.style.borderTop = '0';
    box.style.borderBottom = '1px solid var(--border)';
    box.style.maxHeight = '100%';
    const head = document.createElement('div');
    head.textContent = `${o.title}   (q closes; so does a tap here)`;
    head.style.cssText = 'font-weight:bold;padding:4px 8px;border-bottom:1px solid var(--border);cursor:pointer;';
    head.onclick = () => close();
    const body = document.createElement('div');
    body.tabIndex = 0;
    body.style.cssText = 'flex:1;overflow:auto;padding:4px 8px;white-space:pre;outline:0;';
    o.lines.forEach((text, index) => {
      const line = document.createElement('div');
      line.textContent = text;
      if (o.onPick) {
        line.style.cursor = 'pointer';
        line.onclick = () => {
          close();
          o.onPick?.(index);
        };
      }
      body.appendChild(line);
    });
    const close = () => {
      box.remove();
      resolve();
    };
    body.addEventListener('keydown', (e) => {
      if (e.key === 'q' || e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        close();
      }
    });
    box.append(head, body);
    body.focus();
  });
}
