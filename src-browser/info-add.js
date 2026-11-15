// @ts-check
// The Add manuals sheet: choose Info files (the parts of a split manual together, compressed ones as they are), see which manuals are
// whole, add them to this device, and remove the ones already there. Grouping and checking are in src/info-store.js.
import { groupFiles, readInfoBytes, recordOf } from '../src/info-store.js';
import { buildSheet, cancelButton } from './bottom-sheet.js';
import { confirmDialog, pickBinaryFiles } from './dialogs.js';
import { loadRecords, removeRecord, saveRecord } from './info-storage.js';
import { base64ToArrayBuffer } from './webdav-adapter.js';

/** @typedef {import('../src/info-store.js').PickedFile} PickedFile */

/** @param {number} bytes */
const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** @param {string} css @param {string} [text] */
function div(css, text) {
  const d = document.createElement('div');
  d.style.cssText = css;
  if (text !== undefined) d.textContent = text;
  return d;
}

/** @param {string} text */
const heading = (text) => div('font-size:var(--text-meta);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin:var(--space-4) 0 var(--space-1);', text);

/**
 * Opens the sheet. `onChange` runs after manuals were added or removed.
 * @param {() => void | Promise<unknown>} onChange
 */
export async function openAddManuals(onChange) {
  const { panel, close } = buildSheet('Add manuals', undefined);
  /** @type {PickedFile[]} */
  let picked = [];
  let stored = await loadRecords();
  let busy = '';

  const draw = () => {
    panel.querySelectorAll('[data-add-body]').forEach((n) => n.remove());
    const body = div('');
    body.setAttribute('data-add-body', '');
    body.append(div('font-size:var(--text-secondary);color:var(--muted);margin:var(--space-1) 0 var(--space-3);', 'Pick the files for one manual together. For a manual split into parts, pick all of them: org.info, org.info-1, org.info-2, and so on. Compressed .info.gz files work as they are.'));
    const choose = document.createElement('button');
    choose.textContent = busy || 'Choose files…';
    choose.disabled = !!busy;
    choose.style.cssText = 'display:block;width:100%;min-height:var(--target);font-size:var(--text-body);';
    choose.onclick = async () => {
      /** @type {{ name: string, base64: string }[]} */
      let chosen;
      try {
        chosen = /** @type {{ name: string, base64: string }[]} */ (await pickBinaryFiles(undefined, undefined, true));
      } catch {
        return;
      }
      for (const [i, f] of chosen.entries()) {
        busy = `Reading ${i + 1} of ${chosen.length}…`;
        draw();
        const bytes = new Uint8Array(base64ToArrayBuffer(f.base64));
        const { text, encoding } = await readInfoBytes(bytes);
        picked = [...picked.filter((p) => p.name !== f.name), { name: f.name, text, encoding, size: bytes.length }];
      }
      busy = '';
      draw();
    };
    body.append(choose);
    const groups = groupFiles(picked);
    const ready = groups.filter((g) => g.status === 'ready');
    if (groups.length) body.append(heading('Ready to add'));
    for (const g of groups) {
      const row = div('display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:var(--target);border-bottom:1px solid var(--border);padding:var(--space-1) 0;');
      const text = div('min-width:0;');
      text.append(div('font-size:var(--text-body);overflow-wrap:anywhere;', g.files.length > 1 ? `${g.base}.info, ${g.files.length} files` : g.main || g.files[0].name));
      const note = g.status === 'ready' ? `${g.files.length} ${g.files.length === 1 ? 'file' : 'files'}, ${sizeText(g.files.reduce((n, f) => n + f.size, 0))}` : g.note;
      text.append(div('font-size:var(--text-secondary);color:var(--muted);overflow-wrap:anywhere;', note));
      row.append(text, div(`flex:none;font-size:var(--text-meta);font-weight:700;color:${g.status === 'ready' ? 'var(--done-fg)' : 'var(--todo-fg)'};`, g.status === 'invalid' ? 'not Info' : g.status));
      body.append(row);
    }
    body.append(heading('On this device'));
    if (stored.length === 0) body.append(div('font-size:var(--text-secondary);color:var(--muted);padding:var(--space-2) 0;', 'No manuals added yet.'));
    for (const r of stored) {
      const row = div('display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:var(--target);border-bottom:1px solid var(--border);');
      const text = div('min-width:0;');
      const files = Object.keys(r.files).length;
      text.append(div('font-size:var(--text-body);', r.name), div('font-size:var(--text-secondary);color:var(--muted);', `${files} ${files === 1 ? 'file' : 'files'}, ${sizeText(r.size)}, added ${new Date(r.added).toLocaleDateString()}`));
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${r.name}`);
      remove.style.cssText = 'flex:none;min-height:var(--target);color:#c0392b;';
      remove.onclick = async () => {
        if (!(await confirmDialog(`Remove the manual "${r.name}" from this device?`, { confirmLabel: 'Remove' }))) return;
        await removeRecord(r.name);
        stored = await loadRecords();
        draw();
        await onChange();
      };
      row.append(text, remove);
      body.append(row);
    }
    const buttons = div('display:flex;gap:8px;margin-top:var(--space-3);');
    const cancel = cancelButton('Cancel', close);
    cancel.style.cssText += 'margin-top:0;width:auto;flex:1 1 0;';
    const add = document.createElement('button');
    add.textContent = ready.length ? `Add ${ready.length} ${ready.length === 1 ? 'manual' : 'manuals'}` : 'Add';
    add.disabled = ready.length === 0;
    add.style.cssText = 'flex:1 1 0;min-height:var(--target);font-size:var(--text-body);font-weight:700;background:var(--accent);color:#fff;border-color:var(--accent);';
    add.onclick = async () => {
      const now = Date.now();
      for (const g of ready) await saveRecord(recordOf(g, now));
      close();
      await onChange();
    };
    buttons.append(cancel, add);
    body.append(buttons);
    panel.append(body);
  };
  draw();
}
