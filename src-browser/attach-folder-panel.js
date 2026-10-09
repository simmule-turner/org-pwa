// org-attach-reveal for this app: the heading's attachment folder as a list, the Dired of a browser. Each file has its own Open,
// Preview, Save and Delete; the list is read again after each action. `load()` resolves the names (or null if it could not say),
// and `act(action, name)` runs one action and resolves when it is done.
import { S } from './app-state.js';
import { lockBackgroundScroll } from './dialogs.js';
import { keepOverlayInVisibleViewport, menuButton } from './ui-widgets.js';

export function showAttachmentFolder({ title, load, act }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;';
  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.cssText = 'background:var(--modal-bg);color:var(--fg);border:1px solid var(--border-strong);border-radius:10px;padding:18px;width:100%;max-width:520px;max-height:100%;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;';
  overlay.appendChild(modal);

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:12px;opacity:0.65;margin-bottom:8px;overflow-wrap:anywhere;';
  heading.textContent = title;
  modal.appendChild(heading);
  const list = document.createElement('div');
  modal.appendChild(list);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  const wasOpen = S.buttonChoiceModalOpen; // a panel opened over another leaves that one's state as it found it
  S.buttonChoiceModalOpen = true;
  function close() {
    S.buttonChoiceModalOpen = wasOpen;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    if (overlay.parentNode) document.body.removeChild(overlay);
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape' || document.body.lastElementChild !== overlay) return; // only the topmost panel answers
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKeyDown, true);

  async function refresh() {
    const names = await load();
    list.innerHTML = '';
    if (!names || names.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:0.6;font-size:13px;margin-bottom:8px;';
      empty.textContent = names ? 'No files in this folder.' : "Couldn't read this folder.";
      list.appendChild(empty);
      return;
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid var(--border-strong);border-radius:8px;padding:8px 10px;margin-bottom:6px;';
      const label = document.createElement('div');
      label.textContent = name;
      label.style.cssText = 'font-size:14px;overflow-wrap:anywhere;margin-bottom:6px;';
      row.appendChild(label);
      const buttons = document.createElement('div');
      buttons.className = 'panel-row';
      for (const [text, action] of [['Open', 'open'], ['Preview', 'preview'], ['Save', 'save'], ['Delete', 'delete']]) {
        buttons.appendChild(
          menuButton(text, async () => {
            await act(action, name);
            await refresh();
          })
        );
      }
      row.appendChild(buttons);
      list.appendChild(row);
    }
  }

  const closeRow = document.createElement('div');
  closeRow.className = 'panel-row';
  closeRow.style.marginTop = '6px';
  closeRow.appendChild(menuButton('Close', close));
  modal.appendChild(closeRow);
  document.body.appendChild(overlay);
  refresh();
  return overlay;
}
