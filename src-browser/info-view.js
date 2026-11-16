// @ts-check
// The Info reader: a full-screen view over the app (directory, node, contents, index) with the Info keys, on the manuals kept on this
// device. What Info does is in src/info-nav.js (InfoSession); this is the screen, the keys and the sheets.
import { dirSections, dirManual, manualOf } from '../src/info-store.js';
import { completeNodeNames, findFileName } from '../src/info-manual.js';
import { InfoError } from '../src/info-parse.js';
import { InfoSession, breadcrumbs, historyNodeText } from '../src/info-nav.js';
import { S } from './app-state.js';
import { buildSheet, cancelButton, openActionSheet } from './bottom-sheet.js';
import { confirmDialog } from './dialogs.js';
import { openAddManuals } from './info-add.js';
import { loadBookmarks, loadImage, loadRecords, saveBookmarks } from './info-storage.js';
import { getInfoReflow } from './settings.js';
import { kv } from './singletons.js';
import { reflowInfoText } from '../src/info-reflow.js';

/** @typedef {import('../src/info-store.js').ManualRecord} ManualRecord */
/** @typedef {import('../src/info-manual.js').Manual} Manual */

const VIEW_ID = 'info-view';
const BUTTON = 'min-height:var(--target);min-width:var(--target);border:1px solid var(--border);border-radius:var(--radius-control);background:var(--bg);color:var(--fg);font:inherit;font-size:var(--text-secondary);';

/**
 * @param {string} tag
 * @param {string} [css]
 * @param {string} [text]
 */
function el(tag, css = '', text) {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The manuals on this device as the session looks them up: by name, by any of their file names, and `dir`. */
class Library {
  /** @param {ManualRecord[]} records */
  constructor(records) {
    this.records = records;
    /** @type {Map<string, Manual>} */
    this.cache = new Map();
  }

  /** @param {string} name @returns {ManualRecord | null} */
  record(name) {
    const base = name.replace(/^.*\//, '');
    const lower = base.toLowerCase();
    for (const r of this.records) if (r.name.toLowerCase() === lower || findFileName(Object.keys(r.files), base) !== null) return r;
    for (const r of this.records) if (findFileName([r.name + '.info'], base) !== null) return r;
    return null;
  }

  /** @param {string} name @returns {Manual | null} */
  resolve(name) {
    if (name.toLowerCase() === 'dir') return dirManual(this.records);
    const record = this.record(name);
    if (!record) return null;
    let manual = this.cache.get(record.name);
    if (!manual) {
      manual = manualOf(record);
      this.cache.set(record.name, manual);
    }
    return manual;
  }
}

/**
 * @typedef {object} View
 * @property {HTMLElement} root
 * @property {InfoSession} session
 * @property {Library} library
 * @property {'node' | 'toc' | 'index' | 'history'} mode
 * @property {string} topic what the index screen is looking for
 * @property {string} message the echo line: what the last command said
 * @property {boolean} toEnd whether the next node shows from its end (DEL)
 * @property {string} reflow the setting for joining the lines of paragraphs: 'narrow', 'always' or 'never'
 */

/** The line number of a menu entry in an index: where point goes (Info-point-loc). @param {string} text @param {number} line */
function lineStart(text, line) {
  let p = text.indexOf('\n') + 1;
  for (let i = 0; i < line - 2 && p > 0; i++) {
    const next = text.indexOf('\n', p);
    if (next === -1) break;
    p = next + 1;
  }
  return p;
}

/** Reads the stored manuals into the open view, keeping the session where it is. */
async function refreshLibrary() {
  const v = /** @type {View} */ (S.infoView);
  v.library = new Library(await loadRecords());
  v.session.library = v.library;
}

/** Runs a command of the session, showing what went wrong in the echo line. @param {() => void} fn @param {{ toEnd?: boolean }} [options] */
function run(fn, options = {}) {
  const v = /** @type {View} */ (S.infoView);
  try {
    fn();
    v.message = v.session.message || '';
    v.session.message = '';
  } catch (err) {
    if (!(err instanceof InfoError)) throw err;
    v.message = err.message;
  }
  v.mode = 'node';
  v.toEnd = !!options.toEnd;
  show();
}

/** Opens the reader, on the directory unless a manual and node are named. @param {{ manual?: string, node?: string }} [target] */
export async function openInfo(target = {}) {
  if (!S.infoView) {
    const root = el('div', 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:var(--app-font-family);');
    root.id = VIEW_ID;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Info');
    const library = new Library(await loadRecords());
    S.infoView = { root, session: new InfoSession(library), library, mode: 'node', topic: '', message: '', toEnd: false, reflow: await getInfoReflow(kv) };
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    S.infoOpen = true;
    run(() => /** @type {View} */ (S.infoView).session.directory());
  } else {
    await refreshLibrary();
    /** @type {View} */ (S.infoView).reflow = await getInfoReflow(kv);
  }
  if (target.manual) await goTo(target.manual, target.node || 'Top');
}

/** Closes the reader. */
export function closeInfo() {
  if (!S.infoView) return;
  document.removeEventListener('keydown', onKey, true);
  S.infoView.root.remove();
  S.infoView = null;
  S.infoOpen = false;
}

/** Goes to `(manual)node`; a node the manual does not have falls back to its Top and then to its index, as ol-info does. @param {string} manual @param {string} node */
async function goTo(manual, node) {
  const v = /** @type {View} */ (S.infoView);
  if (manual.toLowerCase() !== 'dir' && !v.library.record(manual)) {
    const ok = await confirmDialog(`The manual "${manual}" is not on this device. Add it now?`, { confirmLabel: 'Add manuals', danger: false });
    if (!ok) return;
    await openAddManuals(() => refreshLibrary());
    if (!v.library.record(manual)) return;
  }
  run(() => {
    const s = v.session;
    try {
      s.goto(`(${manual})${node}`);
    } catch (err) {
      if (!(err instanceof InfoError)) throw err;
      s.goto(`(${manual})Top`);
      s.index(node);
    }
  });
}

/** A command from the palette: open the reader, then do it. @param {'goto' | 'index' | 'search' | 'directory' | 'toc' | 'add'} name */
export async function infoCommand(name) {
  if (name === 'add') {
    await openAddManuals(async () => {
      if (!S.infoView) return;
      await refreshLibrary();
      show();
    });
    return;
  }
  await openInfo();
  if (name === 'goto') openGoto('goto');
  else if (name === 'index') command('i');
  else if (name === 'search') openGoto('search');
  else if (name === 'directory') command('d');
  else command('T');
}

// ---------------------------------------------------------------------------------------------------------------------
// Keys

/** @param {KeyboardEvent} e */
function onKey(e) {
  if (!S.infoView || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target && target.closest('input, textarea, select, [contenteditable], [data-bottom-sheet]')) return;
  const key = e.key === ' ' ? 'SPC' : e.key === 'Backspace' || e.key === 'Delete' ? 'DEL' : e.key;
  if (command(key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** The Info keys: n p u l r t d m f g i , s S T SPC DEL q. @param {string} key @returns {boolean} whether it was one */
function command(key) {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  switch (key) {
    case 'n': run(() => s.next()); return true;
    case 'p': run(() => s.prev()); return true;
    case 'u': run(() => s.up()); return true;
    case 'l': run(() => s.historyBack()); return true;
    case 'r': run(() => s.historyForward()); return true;
    case 't': run(() => s.top()); return true;
    case 'd': run(() => s.directory()); return true;
    case 'm': openMenuSheet(); return true;
    case 'f': openFollowSheet(); return true;
    case 'g': openGoto('goto'); return true;
    case 'i': openIndex(); return true;
    case ',': run(() => s.indexNext(1)); return true;
    case 's': openGoto('search', true); return true;
    case 'S': openGoto('search', false); return true;
    case 'T': openToc(); return true;
    case 'L': v.mode = 'history'; show(); return true;
    case 'B': openBookmarks(); return true;
    case 'SPC': page(1); return true;
    case 'DEL': page(-1); return true;
    case 'q': closeInfo(); return true;
    default: return false;
  }
}

/** SPC and DEL: scroll a page; at the end (or the start) of the node, go to the next (or the previous) one. @param {1 | -1} dir */
function page(dir) {
  const v = /** @type {View} */ (S.infoView);
  const body = /** @type {HTMLElement | null} */ (v.root.querySelector('[data-info-body]'));
  if (v.mode !== 'node' || !body) return;
  const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
  if (dir > 0) {
    if (!atEnd) body.scrollBy(0, body.clientHeight * 0.9);
    else run(() => v.session.scrollForward());
  } else if (body.scrollTop > 0) body.scrollBy(0, -body.clientHeight * 0.9);
  else run(() => v.session.scrollBackward(), { toEnd: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Screens

function show() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  v.root.replaceChildren();
  const isDir = !!s.manual && s.manual.name === 'dir';
  const title = isDir ? 'Info directory' : (v.library.record(s.manual ? s.manual.name : '') || { title: s.file || 'Info' }).title;
  const crumbs = isDir ? '(dir) Top' : breadcrumbs(/** @type {Manual} */ (s.manual), s.file || '', s.name || '').trim();
  const head = el('div', 'flex:none;min-height:56px;box-sizing:border-box;padding:0 var(--space-2);display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--border);');
  const back = headButton('←', 'Close Info', closeInfo);
  const heading = el('div', 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;');
  heading.append(el('span', 'font-size:var(--text-title);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', v.mode === 'toc' ? 'Contents' : v.mode === 'index' ? 'Index' : v.mode === 'history' ? 'History' : title), el('span', 'font-size:var(--text-meta);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', v.mode === 'toc' ? `${title}, all nodes` : v.mode === 'history' ? 'the nodes you visited, the latest first' : v.mode === 'index' ? `${title}, all index entries` : crumbs));
  head.append(back, heading);
  if (v.mode === 'node' && isDir) head.append(headButton('Add', 'Add manuals', () => openAddManuals(() => refreshLibrary().then(show))));
  else if (v.mode === 'node') {
    head.append(headButton('Find', 'Go to node or search', () => openGoto('goto')), headButton('⋮', 'More', openMore));
  }
  v.root.appendChild(head);
  if (v.mode === 'toc') v.root.appendChild(tocScreen());
  else if (v.mode === 'history') v.root.appendChild(historyScreen());
  else if (v.mode === 'index') v.root.appendChild(indexScreen());
  else if (isDir) v.root.appendChild(dirScreen());
  else v.root.appendChild(nodeScreen());
  if (v.mode === 'node' && !isDir) v.root.appendChild(bottomBar());
}

/** @param {string} label @param {string} name @param {() => void} onClick */
function headButton(label, name, onClick) {
  const b = el('button', BUTTON + 'border:0;background:transparent;', label);
  b.setAttribute('aria-label', name);
  b.onclick = onClick;
  return b;
}

/** The echo line: what the last command said. */
function echo() {
  const v = /** @type {View} */ (S.infoView);
  const line = el('div', 'flex:none;padding:var(--space-1) var(--space-4);font-size:var(--text-secondary);color:var(--muted);min-height:0;', v.message);
  line.setAttribute('role', 'status');
  if (!v.message) line.style.display = 'none';
  return line;
}

/** The directory: the manuals on this device by section. */
function dirScreen() {
  const v = /** @type {View} */ (S.infoView);
  const wrap = el('div', 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;');
  const body = el('div', 'flex:1 1 auto;overflow-y:auto;padding:var(--space-3) var(--space-4);');
  body.setAttribute('data-info-body', '');
  body.append(el('div', 'font-size:var(--text-secondary);color:var(--muted);margin-bottom:var(--space-3);', 'Tap a manual to open its Top node. Manuals you add stay on this device.'));
  const sections = dirSections(v.session.text);
  if (v.library.records.length === 0) body.append(el('div', 'padding:var(--space-4) 0;', 'No manuals yet. Tap Add to choose Info files.'));
  for (const section of sections) {
    if (section.heading) body.append(el('div', 'font-size:var(--text-meta);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin:var(--space-4) 0 var(--space-1);', section.heading));
    for (const entry of section.entries) {
      const row = el('button', 'display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:var(--target);padding:var(--space-2) 0;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;color:var(--fg);font:inherit;text-align:left;');
      row.append(el('span', 'font-size:var(--text-body);font-weight:600;', entry.name), el('span', 'font-size:var(--text-secondary);color:var(--muted);', entry.description));
      row.onclick = () => run(() => v.session.goto(entry.file ? `(${entry.file})${entry.node}` : entry.node));
      body.append(row);
    }
  }
  wrap.append(body, echo());
  return wrap;
}

/** Whether paragraphs are joined for this screen: always, never, or only on a narrow one (under 600 px, where the app's sheets are full width). @param {string} mode */
function reflowWanted(mode) {
  return mode === 'always' || (mode === 'narrow' && window.matchMedia('(max-width: 599px)').matches);
}

/** Splits the shown text into plain runs, links and the marker where point is. */
function nodeScreen() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const shown = s.display();
  const text = shown.text;
  const nl = text.indexOf('\n');
  const header = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl + 1);
  const offset = nl + 1;
  const wrap = el('div', 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;');
  const body = el('div', 'flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:var(--space-3) var(--space-4);');
  body.setAttribute('data-info-body', '');
  body.tabIndex = 0;
  body.append(headerLine(header));
  const pre = el('div', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--text-secondary);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:var(--space-3);');
  // the lines of paragraphs joined, when the setting asks for it; positions in the text go through the map
  const flow = reflowWanted(v.reflow) ? reflowInfoText(rest) : { text: rest, map: null };
  const shownRest = flow.text;
  /** @param {number} p */
  const moved = (p) => (flow.map ? flow.map[Math.min(p, rest.length)] : p);
  const raw = shown.shown[Math.min(s.point, shown.shown.length - 1)] - offset;
  const point = raw < 0 ? raw : moved(raw);
  let at = 0;
  /** @param {number} to */
  const plain = (to) => {
    if (to > at) pre.append(document.createTextNode(shownRest.slice(at, to)));
    at = Math.max(at, to);
  };
  /** @type {HTMLElement | null} */
  let marker = null;
  const mark = () => {
    if (point > 0 && !marker && point >= at) {
      plain(point);
      marker = el('span');
      pre.append(marker);
    }
  };
  for (const link of shown.links) {
    if (link.start - offset < 0) continue;
    const a = moved(link.start - offset);
    const b = moved(link.end - offset);
    if (point >= at && point <= a) mark();
    plain(a);
    pre.append(linkElement(shownRest.slice(a, b), link));
    at = b;
  }
  if (point >= at) mark();
  plain(shownRest.length);
  body.append(pre);
  const images = s.node && s.node.images ? s.node.images : [];
  if (images.length) body.append(imageFigures(images));
  wrap.append(body, echo());
  queueMicrotask(() => {
    if (v.toEnd) body.scrollTop = body.scrollHeight;
    else if (marker) marker.scrollIntoView({ block: 'center' });
  });
  return wrap;
}

/** The images the node names, shown below its text: the ones added on this device, a note for the others. @param {{ src: string, alt: string | null, text: string | null }[]} images */
function imageFigures(images) {
  const box = el('div', 'display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-3);');
  for (const image of images) {
    const figure = el('figure', 'margin:0;');
    const caption = image.alt || image.text || image.src;
    figure.append(el('figcaption', 'font-size:var(--text-meta);color:var(--muted);', caption));
    box.append(figure);
    loadImage(image.src).then((url) => {
      if (!url) {
        figure.prepend(el('div', 'font-size:var(--text-secondary);color:var(--muted);', `The image ${image.src} is not on this device. Add it with the manual.`));
        return;
      }
      const img = document.createElement('img');
      img.src = url;
      img.alt = image.alt || image.text || image.src;
      img.style.cssText = 'max-width:100%;height:auto;display:block;';
      figure.prepend(img);
    });
  }
  return box;
}

/** @param {string} label @param {{ node: string | null, url: string | null }} link */
function linkElement(label, link) {
  const a = el('a', 'color:var(--accent);text-decoration:underline;cursor:pointer;', label);
  a.setAttribute('role', 'link');
  a.tabIndex = 0;
  const go = () => {
    if (link.url) window.open(link.url, '_blank', 'noopener');
    else if (link.node !== null) run(() => /** @type {View} */ (S.infoView).session.goto(/** @type {string} */ (link.node)));
  };
  a.onclick = (e) => {
    e.preventDefault();
    go();
  };
  a.onkeydown = (e) => {
    if (e.key === 'Enter') go();
  };
  return a;
}

/** The first line of the node: File, Node, Next, Prev and Up, with the nodes the pointers name as links. @param {string} header */
function headerLine(header) {
  const line = el('div', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--text-meta);line-height:1.6;color:var(--muted);overflow-wrap:anywhere;');
  const re = /\b(Next|Prev|Previous|Up):[ \t]*([^,\n]*)/g;
  let at = 0;
  let m;
  while ((m = re.exec(header))) {
    const start = m.index + m[0].length - m[2].length;
    line.append(document.createTextNode(header.slice(at, start)));
    line.append(linkElement(m[2], { node: m[2].trim(), url: null }));
    at = start + m[2].length;
  }
  line.append(document.createTextNode(header.slice(at)));
  return line;
}

/** The five buttons under a node: Prev, Up, Next, Back, Index. */
function bottomBar() {
  const bar = el('div', 'flex:none;border-top:1px solid var(--border);padding:var(--space-2) var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom, 0px));display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;');
  for (const [label, key] of [['Prev', 'p'], ['Up', 'u'], ['Next', 'n'], ['Back', 'l'], ['Index', 'i']]) {
    const b = el('button', BUTTON + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:calc(var(--target) + 4px);');
    b.append(el('span', '', label), el('span', 'font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);', key));
    b.onclick = () => command(key);
    bar.append(b);
  }
  return bar;
}

/** The contents: every node of the manual under its section, the current one marked. */
function tocScreen() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const body = el('div', 'flex:1 1 auto;overflow-y:auto;padding:var(--space-3) var(--space-4);');
  body.setAttribute('data-info-body', '');
  for (const row of /** @type {Manual} */ (s.manual).tocRows()) {
    if (row.section !== null) {
      body.append(el('div', `font-size:var(--text-meta);font-weight:700;color:var(--muted);margin:var(--space-3) 0 var(--space-1);padding-left:${row.level * 16}px;`, row.section));
      continue;
    }
    const node = /** @type {string} */ (row.node);
    const b = el('button', `display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:var(--target);padding:var(--space-1) 0 var(--space-1) ${row.level * 16}px;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;color:var(--fg);font:inherit;text-align:left;`);
    b.append(el('span', node === s.name ? 'font-weight:700;' : '', node));
    if (node === s.name) b.append(el('span', 'font-size:var(--text-meta);color:var(--accent);', 'you are here'));
    b.onclick = () => run(() => s.goto(node));
    body.append(b);
  }
  return body;
}

/** B: bookmark the node you are at (once), or go to a bookmarked node; a bookmark keeps the manual, the node and where point was. */
async function openBookmarks() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const list = await loadBookmarks();
  const here = s.file !== null && s.name !== null ? { file: s.file, node: s.name, point: s.point } : null;
  const kept = here ? list.find((b) => b.file === here.file && b.node === here.node) : undefined;
  /** @type {{ label: string, hint?: string, onClick: () => void }[]} */
  const actions = [];
  if (here && !kept) actions.push({ label: `Bookmark ${here.node}`, onClick: () => { void saveBookmarks([...list, here]).then(() => { v.message = `Bookmarked (${here.file})${here.node}`; show(); }); } });
  if (kept) actions.push({ label: `Remove the bookmark on ${kept.node}`, onClick: () => { void saveBookmarks(list.filter((b) => b !== kept)).then(() => { v.message = 'Bookmark removed'; show(); }); } });
  for (const b of list) {
    actions.push({ label: b.node, hint: b.file, onClick: () => run(() => { s.goto(`(${b.file})${b.node}`); if (b.point > 0 && b.point <= s.text.length) s.point = b.point; }) });
  }
  if (!list.length && !here) actions.push({ label: 'No bookmarks yet', onClick: () => {} });
  openActionSheet({ title: 'Bookmarks', actions });
}

/** Info-history (L): the nodes visited, the latest first, as Emacs's *History* node lists them. */
function historyScreen() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const body = el('div', 'flex:1 1 auto;overflow-y:auto;padding:var(--space-3) var(--space-4);');
  body.setAttribute('data-info-body', '');
  const { entries } = historyNodeText(s.visited);
  if (entries.length === 0) body.append(el('div', 'color:var(--muted);', 'No node has been visited yet.'));
  for (const e of entries) {
    const b = el('button', 'display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:var(--target);padding:var(--space-1) 0;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;color:var(--fg);font:inherit;text-align:left;');
    b.append(el('span', e.node === s.name && e.file === s.file ? 'font-weight:700;' : '', e.node), el('span', 'font-size:var(--text-meta);color:var(--muted);', e.file));
    b.onclick = () => { v.mode = 'node'; run(() => s.goto(`(${e.file})${e.node}`)); };
    body.append(b);
  }
  return body;
}

function openToc() {
  const v = /** @type {View} */ (S.infoView);
  if (!v.session.manual || v.session.manual.name === 'dir') {
    v.message = 'The directory has no contents';
  } else v.mode = 'toc';
  show();
}

/** The index: the entries of the manual's index nodes that contain what is typed, each leading to its node. */
function indexScreen() {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const manual = /** @type {Manual} */ (s.manual);
  const wrap = el('div', 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;');
  const bar = el('div', 'flex:none;padding:var(--space-2) var(--space-4);');
  const input = /** @type {HTMLInputElement} */ (el('input', 'width:100%;box-sizing:border-box;min-height:var(--target);font:inherit;padding:0 var(--space-3);border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--bg);color:var(--fg);'));
  input.type = 'search';
  input.placeholder = 'Index topic';
  input.setAttribute('aria-label', 'Index topic');
  input.value = v.topic;
  const status = el('div', 'font-size:var(--text-secondary);color:var(--muted);padding:var(--space-1) 0;');
  const list = el('div', 'flex:1 1 auto;overflow-y:auto;padding:0 var(--space-4);');
  list.setAttribute('data-info-body', '');
  const fill = () => {
    v.topic = input.value;
    list.replaceChildren();
    const matches = manual.indexNodes().length ? manual.indexMatches(input.value) : [];
    status.textContent = manual.indexNodes().length === 0 ? 'This manual has no index.' : `${matches.length} ${matches.length === 1 ? 'entry matches' : 'entries match'}. Tap one to go to its node. The next match is , (comma).${matches.length > 300 ? ' Showing the first 300; type to narrow them.' : ''}`;
    matches.slice(0, 300).forEach((m, k) => {
      const row = el('button', 'display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:var(--target);padding:var(--space-2) 0;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;color:var(--fg);font:inherit;text-align:left;');
      row.append(el('span', 'font-size:var(--text-body);overflow-wrap:anywhere;', m.entry), el('span', 'font-size:var(--text-secondary);color:var(--muted);', `${m.node}, in ${m.indexNode}`));
      row.onclick = () =>
        run(() => {
          if (input.value) {
            s.index(input.value);
            if (k > 0) s.indexNext(k);
          } else {
            s.goto(m.node);
            if (m.line > 0) s.point = lineStart(s.text, m.line);
          }
        });
      list.append(row);
    });
  };
  input.oninput = fill;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && input.value) run(() => s.index(input.value));
    if (e.key === 'Escape') {
      v.mode = 'node';
      show();
    }
  };
  bar.append(input, status);
  wrap.append(bar, list);
  fill();
  queueMicrotask(() => input.focus());
  return wrap;
}

function openIndex() {
  const v = /** @type {View} */ (S.infoView);
  if (!v.session.manual || v.session.manual.name === 'dir') v.message = 'The Info directory node has no index; type m to select a manual';
  else v.mode = 'index';
  show();
}

// ---------------------------------------------------------------------------------------------------------------------
// Sheets

/** m: the entries of this node's menu. */
function openMenuSheet() {
  const v = /** @type {View} */ (S.infoView);
  const text = v.session.text;
  const entries = [...text.matchAll(/^\* +([^:\n]+):[:\s]/gm)].filter((m) => m[1].toLowerCase() !== 'menu').map((m) => m[1]);
  if (entries.length === 0) {
    v.message = 'No menu in this node';
    show();
    return;
  }
  openActionSheet({ title: 'Menu', actions: entries.map((name) => ({ label: name, onClick: () => run(() => v.session.menu(name)) })) });
}

/** f: the cross references of this node. */
function openFollowSheet() {
  const v = /** @type {View} */ (S.infoView);
  const links = v.session.display().links.filter((l) => l.kind === 'xref' && l.node !== null);
  if (links.length === 0) {
    v.message = 'No cross references in this node';
    show();
    return;
  }
  const seen = new Set();
  const actions = [];
  for (const l of links) {
    const node = /** @type {string} */ (l.node);
    if (seen.has(node)) continue;
    seen.add(node);
    actions.push({ label: node, onClick: () => run(() => v.session.goto(node)) });
  }
  openActionSheet({ title: 'Follow reference', actions });
}

/** The nodes whose name matches what was typed: those that start with it first, then those that contain it. @param {string} typed */
function completionsFor(typed) {
  const v = /** @type {View} */ (S.infoView);
  const manual = v.session.manual;
  if (!manual || typed.startsWith('(')) return [];
  return completeNodeNames(manual.completions().filter((n) => n !== '*'), typed).slice(0, 40);
}

/** The matches of a search from here on, one per hit, up to a limit. @param {string} pattern @param {boolean} fold */
function searchHits(pattern, fold) {
  const v = /** @type {View} */ (S.infoView);
  const s = v.session;
  const probe = new InfoSession(v.library);
  probe.find(s.file, s.name || 'Top', { noGoingBack: true });
  probe.point = s.point;
  /** @type {{ node: string, point: number, snippet: string }[]} */
  const hits = [];
  for (let i = 0; i < 40; i++) {
    try {
      probe.search(pattern, fold);
    } catch {
      break;
    }
    const text = probe.text;
    const from = Math.max(0, probe.point - 40);
    hits.push({ node: /** @type {string} */ (probe.name), point: probe.point, snippet: text.slice(from, probe.point + 40).replace(/\s+/g, ' ') });
  }
  return hits;
}

/**
 * g and s: one sheet with a Go to node tab (completes node names as you type, `(manual)node` reaches another manual) and a Search text
 * tab (a regexp, from this node through the manual, with every match listed). S is the same search, matching case.
 * @param {'goto' | 'search'} tab @param {boolean} [fold]
 */
function openGoto(tab, fold = true) {
  const v = /** @type {View} */ (S.infoView);
  const { panel, close } = buildSheet('Info', v.session.file ? `File: ${v.session.file}, Node: ${v.session.name}` : undefined);
  let current = tab;
  const tabs = el('div', 'display:flex;gap:8px;margin:var(--space-2) 0;');
  const input = /** @type {HTMLInputElement} */ (el('input', 'width:100%;box-sizing:border-box;min-height:var(--target);font:inherit;padding:0 var(--space-3);border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--bg);color:var(--fg);'));
  const label = el('div', 'font-size:var(--text-secondary);color:var(--muted);margin:var(--space-2) 0;');
  const matchCase = /** @type {HTMLInputElement} */ (el('input'));
  matchCase.type = 'checkbox';
  matchCase.checked = !fold;
  const caseRow = el('label', 'display:flex;align-items:center;gap:8px;min-height:var(--target);');
  caseRow.append(matchCase, document.createTextNode('Match case (S)'));
  // a fixed height, so the sheet (anchored to the bottom) keeps its size and the input stays put however many matches there are
  const list = el('div', 'height:clamp(6rem, 35vh, 18rem);overflow-y:auto;overscroll-behavior:contain;');
  const tabButtons = /** @type {Record<string, HTMLButtonElement>} */ ({});
  for (const [id, name, key] of [['goto', 'Go to node', 'g'], ['search', 'Search text', 's']]) {
    const b = /** @type {HTMLButtonElement} */ (el('button', BUTTON + 'flex:1 1 0;'));
    b.append(document.createTextNode(name + ' '), el('span', 'font-family:ui-monospace,Menlo,monospace;color:var(--muted);', key));
    b.onclick = () => {
      current = /** @type {'goto' | 'search'} */ (id);
      draw();
      input.focus();
    };
    tabButtons[id] = b;
    tabs.append(b);
  }
  const draw = () => {
    for (const id of Object.keys(tabButtons)) tabButtons[id].style.borderColor = id === current ? 'var(--accent)' : 'var(--border)';
    caseRow.style.visibility = current === 'search' ? 'visible' : 'hidden'; // its space stays, so the sheet is the same size on both tabs
    input.placeholder = current === 'goto' ? 'Node name, or (manual)node' : 'Regexp';
    input.setAttribute('aria-label', current === 'goto' ? 'Go to node' : 'Search text');
    label.textContent = current === 'goto' ? 'Go to node: type a name, or (manual)node for another manual. Matches complete as you type.' : 'Search runs through the whole manual from this node and lists each match with its node.';
    fill();
  };
  const fill = () => {
    list.replaceChildren();
    if (current === 'goto') {
      for (const name of completionsFor(input.value)) list.append(choiceRow(name, '', () => (close(), run(() => v.session.goto(name)))));
    } else if (input.value) {
      for (const hit of searchHits(input.value, !matchCase.checked)) {
        list.append(
          choiceRow(hit.snippet, hit.node, () => {
            close();
            run(() => {
              v.session.goto(hit.node);
              v.session.point = hit.point;
            });
          }),
        );
      }
    }
  };
  input.oninput = fill;
  matchCase.onchange = fill;
  input.onkeydown = (e) => {
    if (e.key !== 'Enter' || !input.value) return;
    e.preventDefault();
    close();
    if (current === 'goto') run(() => v.session.goto(input.value));
    else run(() => v.session.search(input.value, !matchCase.checked));
  };
  panel.append(tabs, input, label, caseRow, list, cancelButton('Cancel', close));
  draw();
  input.focus();
}

/** @param {string} main @param {string} sub @param {() => void} onClick */
function choiceRow(main, sub, onClick) {
  const row = el('button', 'display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:var(--target);padding:var(--space-1) 4px;border:0;border-bottom:1px solid var(--border);border-radius:0;background:none;color:var(--fg);font:inherit;text-align:left;');
  row.append(el('span', 'font-size:var(--text-body);overflow-wrap:anywhere;', main));
  if (sub) row.append(el('span', 'font-size:var(--text-meta);color:var(--muted);', sub));
  row.onclick = onClick;
  return row;
}

/** The three dots: the commands that have no button, with their keys. */
function openMore() {
  const items = [
    ['Top', 't'],
    ['Directory', 'd'],
    ['Contents', 'T'],
    ['History', 'L'],
    ['Bookmarks', 'B'],
    ['Menu', 'm'],
    ['Follow reference', 'f'],
    ['Go to node', 'g'],
    ['Search', 's'],
    ['Search, matching case', 'S'],
    ['Next index match', ','],
    ['Forward in history', 'r'],
    ['Next page or node', 'SPC'],
    ['Previous page or node', 'DEL'],
  ];
  openActionSheet({
    title: 'Info',
    actions: [
      ...items.map(([label, key]) => ({ label, hint: key, onClick: () => command(key) })),
      { label: 'Add manuals', onClick: () => openAddManuals(() => refreshLibrary().then(show)) },
      { label: 'Quit Info', hint: 'q', onClick: closeInfo },
    ],
  });
}
