// Drag and drop for headings: a grip at the left of each heading row. Dragging it lifts the heading with its subtree; a blue
// line (or a highlighted row) shows where it will land. The result is the same as the move keys: a sibling before or after the
// target, or a child of it. Over the top quarter of a row = before it; bottom quarter = after it (or its first child when it
// is open); middle = its last child. On an "after" line, dragging left climbs out a level where nothing follows.
import { dropClimbLimit, moveHeadingTo } from '../src/heading-edit.js';
import { S } from './app-state.js';
import { commitAndRender } from './editing.js';

const INDENT_PX = 16;
const EDGE_PX = 56;
const LINE_COLOR = '#1f6feb';
const rowInfo = new WeakMap(); // heading row element -> { node, row }

const GRIP_SVG =
  '<svg aria-hidden="true" width="12" height="16" viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.6"/><circle cx="10" cy="3" r="1.6"/><circle cx="4" cy="9" r="1.6"/><circle cx="10" cy="9" r="1.6"/><circle cx="4" cy="15" r="1.6"/><circle cx="10" cy="15" r="1.6"/></svg>';

function inSubtree(heading, node) {
  return heading === node || (heading.children || []).some((child) => inSubtree(child, node));
}

function countDescendants(node) {
  return (node.children || []).reduce((n, child) => n + 1 + countDescendants(child), 0);
}

function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/** The heading row under a point: a heading row itself, or the heading a body row belongs to (reached by walking back up the list). */
function headingRowAt(x, y) {
  let el = document.elementFromPoint(x, y);
  el = el && el.closest('.row');
  while (el && !rowInfo.has(el)) el = el.previousElementSibling;
  return el;
}

/** Builds the grip for a heading row and registers the row as a drop target. */
export function attachHeadingGrip(rowEl, row) {
  rowInfo.set(rowEl, { node: row.node, row });
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'heading-grip';
  grip.setAttribute('aria-label', `Drag ${row.node.title || 'heading'} to move it`);
  grip.innerHTML = GRIP_SVG;
  grip.style.cssText =
    'flex:none;width:20px;align-self:stretch;min-height:24px;padding:0;border:0;background:transparent;color:var(--fg);opacity:0.4;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;';
  grip.addEventListener('pointerdown', (e) => beginDrag(e, grip, rowEl, row.node));
  return grip;
}

function beginDrag(e, grip, rowEl, node) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let started = false;
  let ghost = null;
  let line = null;
  let highlighted = null;
  let drop = null; // { target, position, climb }
  let last = { x: startX, y: startY };
  let scrollTimer = 0;
  const scroller = scrollParent(rowEl);
  try {
    grip.setPointerCapture(pointerId);
  } catch {
    /* a synthetic pointer has nothing to capture */
  }

  function clearIndicator() {
    if (line) line.style.display = 'none';
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.outlineOffset = '';
      highlighted.style.background = '';
      highlighted = null;
    }
  }

  function start() {
    started = true;
    ghost = document.createElement('div');
    const below = countDescendants(node);
    ghost.textContent = (node.title || '(untitled)') + (below ? `  + ${below} below` : '');
    ghost.style.cssText = `position:fixed;z-index:10001;pointer-events:none;max-width:70vw;padding:8px 12px;border:1px solid ${LINE_COLOR};border-radius:8px;background:var(--modal-bg, var(--bg));color:var(--fg);box-shadow:0 8px 20px rgba(0,0,0,0.3);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    line = document.createElement('div');
    line.style.cssText = `position:fixed;z-index:10000;pointer-events:none;height:3px;border-radius:2px;background:${LINE_COLOR};display:none;`;
    document.body.appendChild(ghost);
    document.body.appendChild(line);
    rowEl.style.opacity = '0.35';
    scrollTimer = requestAnimationFrame(scrollTick);
  }

  function update() {
    if (!started) return;
    ghost.style.left = last.x + 12 + 'px';
    ghost.style.top = last.y - 18 + 'px';
    clearIndicator();
    drop = null;
    const el = headingRowAt(last.x, last.y);
    const info = el && rowInfo.get(el);
    if (!info || inSubtree(node, info.node)) return; // not on a heading, or into itself: no landing here
    const rect = el.getBoundingClientRect();
    const rel = (last.y - rect.top) / Math.max(1, rect.height);
    const openChildren = info.row.hasChildren && !info.node.collapsed;
    const baseLeft = rect.left + 8 + info.row.depth * INDENT_PX;
    let position;
    let climb = 0;
    if (!el.classList.contains('row') || rel < 0.25) position = 'before';
    else if (rel > 0.75) position = openChildren ? 'firstChild' : 'after';
    else position = 'lastChild';
    if (position === 'after') {
      const limit = dropClimbLimit(S.state.doc, info.node);
      climb = Math.max(0, Math.min(limit, Math.round((baseLeft - last.x) / INDENT_PX)));
    }
    drop = { target: info.node, position, climb };
    if (position === 'lastChild') {
      el.style.outline = `2px solid ${LINE_COLOR}`;
      el.style.outlineOffset = '-2px';
      el.style.background = 'rgba(31,111,235,0.12)';
      highlighted = el;
      return;
    }
    const indent = position === 'firstChild' ? info.row.depth + 1 : info.row.depth - climb;
    const left = rect.left + 8 + Math.max(0, indent) * INDENT_PX;
    line.style.left = left + 'px';
    line.style.width = Math.max(24, rect.right - left) + 'px';
    line.style.top = (position === 'before' ? rect.top : rect.bottom) - 1 + 'px';
    line.style.display = 'block';
  }

  function scrollTick() {
    const area = scroller === document.scrollingElement || scroller === document.documentElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
    let speed = 0;
    if (last.y < area.top + EDGE_PX) speed = -Math.ceil((area.top + EDGE_PX - last.y) / 4);
    else if (last.y > area.bottom - EDGE_PX) speed = Math.ceil((last.y - (area.bottom - EDGE_PX)) / 4);
    if (speed) {
      scroller.scrollTop += Math.max(-24, Math.min(24, speed));
      update();
    }
    scrollTimer = requestAnimationFrame(scrollTick);
  }

  function cleanup() {
    cancelAnimationFrame(scrollTimer);
    clearIndicator();
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    if (line && line.parentNode) line.parentNode.removeChild(line);
    rowEl.style.opacity = '';
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    try {
      grip.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }

  function onMove(ev) {
    last = { x: ev.clientX, y: ev.clientY };
    if (!started && Math.hypot(last.x - startX, last.y - startY) > 5) start();
    update();
  }
  function onUp(ev) {
    last = { x: ev.clientX, y: ev.clientY };
    update();
    const chosen = started ? drop : null;
    cleanup();
    if (chosen && moveHeadingTo(S.state.doc, node, chosen.target, chosen.position, chosen.climb)) commitAndRender('Moved heading');
  }
  function onCancel() {
    cleanup();
  }
  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
  }
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
}
