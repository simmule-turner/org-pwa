// @ts-check
// rename-buffer (C-x x r): change the name a buffer is shown under, in the tab and the modeline, without saving it anywhere.
// As in Emacs it asks in the minibuffer, refuses an empty name and a name another buffer already has, and leaves the file alone.
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { render } from './render.js';
import { setBufferNames } from './settings.js';
import { kv } from './singletons.js';
import { bufferNames, documentDisplayLabel } from './sync-helpers.js';
import { renderTabBar } from './tabs.js';

/** The names of the other open buffers. */
function otherBufferNames() {
  /** @type {string[]} */ const names = [];
  for (const s of S.documentSessions) {
    if (s.tabId === S.activeTabId) continue;
    const st = s.state;
    if (st && st.doc) names.push(documentDisplayLabel(st.documentId, st.doc));
  }
  return names;
}

/** Asks for the new name and applies it. */
export async function renameBuffer() {
  if (!S.state.doc) return;
  const current = documentDisplayLabel(S.state.documentId, S.state.doc);
  const answer = await readFromMinibuffer('Rename buffer (to new name): ', current);
  if (answer === null) {
    setStatus('Quit');
    return;
  }
  const name = answer.trim();
  if (name === '') {
    setStatus('Empty string is invalid as a buffer name');
    return;
  }
  if (name === current) return;
  if (otherBufferNames().includes(name)) {
    setStatus(`Buffer name ‘${name}’ is in use`);
    return;
  }
  bufferNames.set(S.state.documentId, name);
  await setBufferNames(kv, Object.fromEntries(bufferNames));
  renderTabBar();
  render();
  setStatus(`Buffer renamed to ${name}.`);
}
