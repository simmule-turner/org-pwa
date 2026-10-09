// org-attach-open-in-emacs for this app: shows an attachment inside the app (a picture, a recording, a video, or text) rather than
// handing it to the browser's viewer in a new tab. `bytes` is an ArrayBuffer and `mime` its type; a type with no in-app preview
// is the caller's to catch (previewKind returns null).
import { S } from './app-state.js';
import { lockBackgroundScroll } from './dialogs.js';
import { keepOverlayInVisibleViewport, menuButton } from './ui-widgets.js';

const TEXT_LIMIT = 200000; // characters shown; more would only slow the page

/** 'image' | 'audio' | 'video' | 'text', or null when the app cannot show it itself. */
export function previewKind(mime) {
  if (/^image\//.test(mime || '')) return 'image';
  if (/^audio\//.test(mime || '')) return 'audio';
  if (/^video\//.test(mime || '')) return 'video';
  if (/^text\//.test(mime || '')) return 'text';
  return null;
}

export function showAttachmentPreview(filename, mime, bytes) {
  const kind = previewKind(mime);
  if (!kind) return false;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;';
  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.cssText = 'background:var(--modal-bg);color:var(--fg);border:1px solid var(--border-strong);border-radius:10px;padding:14px;width:100%;max-width:720px;max-height:100%;overflow-y:auto;box-sizing:border-box;';
  overlay.appendChild(modal);

  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;opacity:0.75;margin-bottom:8px;overflow-wrap:anywhere;';
  title.textContent = filename;
  modal.appendChild(title);

  const url = kind === 'text' ? null : URL.createObjectURL(new Blob([bytes], { type: mime }));
  let content;
  if (kind === 'text') {
    content = document.createElement('pre');
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    content.textContent = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…` : text;
    content.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:70vh;overflow:auto;margin:0;font-size:13px;';
  } else {
    content = document.createElement(kind === 'image' ? 'img' : kind);
    content.src = url;
    if (kind !== 'image') content.controls = true;
    content.style.cssText = 'display:block;max-width:100%;max-height:70vh;margin:0 auto;';
    content.onerror = () => {
      const note = document.createElement('div');
      note.textContent = "This device can't show that file here. Use Open instead.";
      content.replaceWith(note);
    };
  }
  modal.appendChild(content);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  const wasOpen = S.buttonChoiceModalOpen; // a panel opened over another leaves that one's state as it found it
  S.buttonChoiceModalOpen = true;
  function close() {
    S.buttonChoiceModalOpen = wasOpen;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    if (url) URL.revokeObjectURL(url);
    if (overlay.parentNode) document.body.removeChild(overlay);
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape' || document.body.lastElementChild !== overlay) return; // only the topmost panel answers
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKeyDown, true);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.style.marginTop = '10px';
  row.appendChild(menuButton('Close', close));
  modal.appendChild(row);
  document.body.appendChild(overlay);
  return true;
}
