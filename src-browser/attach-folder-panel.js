// org-attach-reveal for this app: the heading's attachment folder as a list, the Dired of a browser. One compact row per file:
// `[ ] [O] [S] [D] filename` -- the checkbox selects, O opens, S saves, D deletes. A strip above the list selects all, shows the
// count, deletes the selection and adds files. `load()` resolves the names (or null if it could not say), `act(action, name)` runs
// one action, `saveMany(names)` saves and `removeMany(names)` deletes the selection (asking once) and `add()` attaches more files; each resolves when done.
import { S } from './app-state.js';
import { lockBackgroundScroll } from './dialogs.js';
import { keepOverlayInVisibleViewport, menuButton } from './ui-widgets.js';

const SMALL_BUTTON = 'font:inherit;font-size:12px;font-weight:600;min-width:28px;height:28px;padding:0 4px;border:1px solid var(--border-strong);border-radius:6px;background:transparent;color:var(--fg);cursor:pointer;flex:none;';

export function showAttachmentFolder({ title, load, act, removeMany, saveMany, add }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;';
  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.cssText = 'background:var(--modal-bg);color:var(--fg);border:1px solid var(--border-strong);border-radius:10px;padding:14px;width:100%;max-width:520px;max-height:100%;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;';
  overlay.appendChild(modal);

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:12px;opacity:0.65;margin-bottom:8px;overflow-wrap:anywhere;';
  heading.textContent = title;
  modal.appendChild(heading);
  const strip = document.createElement('div');
  strip.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;';
  modal.appendChild(strip);
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

  const selected = new Set();
  let names = [];

  function smallButton(text, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.style.cssText = SMALL_BUTTON;
    b.addEventListener('click', onClick);
    return b;
  }

  function drawStrip() {
    strip.innerHTML = '';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.setAttribute('aria-label', 'Select all');
    all.checked = names.length > 0 && selected.size === names.length;
    all.disabled = names.length === 0;
    all.addEventListener('change', () => {
      selected.clear();
      if (all.checked) for (const n of names) selected.add(n);
      drawRows();
      drawStrip();
    });
    strip.appendChild(all);
    const count = document.createElement('span');
    count.style.cssText = 'font-size:12px;opacity:0.7;flex:1;min-width:60px;';
    count.textContent = selected.size ? `${selected.size} selected` : `${names.length} file${names.length === 1 ? '' : 's'}`;
    strip.appendChild(count);
    if (selected.size && saveMany) {
      strip.appendChild(
        smallButton('Save selected', 'Save selected', async () => {
          await saveMany([...selected]);
        })
      );
      strip.lastChild.style.padding = '0 8px';
    }
    if (selected.size && removeMany) {
      strip.appendChild(
        smallButton('Delete selected', 'Delete selected', async () => {
          await removeMany([...selected]);
          selected.clear();
          await refresh();
        })
      );
      strip.lastChild.style.padding = '0 8px';
    }
    if (add) {
      strip.appendChild(
        smallButton('Add files…', 'Add files', async () => {
          await add();
          await refresh();
        })
      );
      strip.lastChild.style.padding = '0 8px';
    }
  }

  function drawRows() {
    list.innerHTML = '';
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:0.6;font-size:13px;margin:6px 0;';
      empty.textContent = 'No files in this folder.';
      list.appendChild(empty);
      return;
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.has(name);
      box.setAttribute('aria-label', `Select ${name}`);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(name);
        else selected.delete(name);
        drawStrip();
      });
      row.appendChild(box);
      for (const [text, label, action] of [['O', 'Open', 'open'], ['S', 'Save', 'save'], ['D', 'Delete', 'delete']]) {
        row.appendChild(
          smallButton(text, `${label} ${name}`, async () => {
            await act(action, name);
            await refresh();
          })
        );
      }
      const label = document.createElement('span');
      label.textContent = name;
      label.style.cssText = 'font-size:14px;overflow-wrap:anywhere;min-width:0;flex:1;';
      row.appendChild(label);
      list.appendChild(row);
    }
  }

  async function refresh() {
    const loaded = await load();
    if (!loaded) {
      names = [];
      strip.innerHTML = '';
      list.innerHTML = '';
      const err = document.createElement('div');
      err.style.cssText = 'opacity:0.6;font-size:13px;margin-bottom:8px;';
      err.textContent = "Couldn't read this folder.";
      list.appendChild(err);
      return;
    }
    names = loaded;
    for (const n of [...selected]) if (!names.includes(n)) selected.delete(n);
    drawStrip();
    drawRows();
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
