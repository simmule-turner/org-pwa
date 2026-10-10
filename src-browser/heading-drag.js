// Drag and drop for headings: a grip at the left of each heading row. Dragging it lifts the heading with its subtree. It lands in
// a GAP between two visible headings (the line snaps to the gap nearest the finger, never between them), and sideways movement
// steps through the levels that fit there, one indent per step: the line's left edge jumps with each, and a tag says what the
// result is ("into Alpha", "after Alpha", "top level"). The result is the same as the move keys: a sibling or a child.
import { findAncestorPath } from '../src/archive-model.js';
import { dropClimbLimit, moveHeadingTo } from '../src/heading-edit.js';
import { S } from './app-state.js';
import { commitAndRender } from './editing.js';

const INDENT_PX = 16; // the indent the app draws per level
const STEP_PX = 28; // how far sideways the finger moves per level -- wider than the drawn indent, so a step is easy to hit
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

/** The heading `climb` levels above `node` (node itself for 0). */
function ancestorAt(doc, node, climb) {
  let current = node;
  for (let i = 0; i < climb; i += 1) {
    const path = findAncestorPath(doc, current);
    current = path[path.length - 1];
  }
  return current;
}

function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/** Builds the grip for a heading row and registers the row as a drop target. */
export function attachHeadingGrip(rowEl, row, side = 'right') {
  rowInfo.set(rowEl, { node: row.node, row });
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'heading-grip';
  grip.setAttribute('aria-label', `Drag ${row.node.title || 'heading'} to move it`);
  grip.innerHTML = GRIP_SVG;
  grip.style.cssText =
    'flex:none;width:20px;align-self:stretch;min-height:24px;padding:0;border:0;background:transparent;color:var(--fg);opacity:0.4;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;';
  if (side === 'right') grip.style.margin = '0 2px 0 4px'; // clear of the screen edge, where a system back gesture starts
  grip.addEventListener('pointerdown', (e) => beginDrag(e, grip, rowEl, row.node, side));
  return grip;
}

function beginDrag(e, grip, rowEl, node, side) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let started = false;
  let ghost = null;
  let line = null;
  let tagEl = null;
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
    if (tagEl) tagEl.style.display = 'none';
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

  function tag() {
    if (!tagEl) {
      tagEl = document.createElement('div');
      tagEl.style.cssText = `position:fixed;z-index:10000;pointer-events:none;padding:2px 8px;border-radius:10px;background:${LINE_COLOR};color:#fff;font-size:12px;font-weight:600;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      document.body.appendChild(tagEl);
    }
    return tagEl;
  }

  function update() {
    if (!started) return;
    // keep the floating label clear of the finger, on the open side of the screen
    ghost.style.left = (side === 'right' ? Math.max(4, last.x - ghost.offsetWidth - 16) : last.x + 16) + 'px';
    ghost.style.top = last.y - 18 + 'px';
    clearIndicator();
    drop = null;
    // The visible heading rows, in order, without the dragged subtree.
    const rows = Array.from(document.querySelectorAll('.row'))
      .filter((el) => rowInfo.has(el) && !inSubtree(node, rowInfo.get(el).node))
      .map((el) => ({ el, info: rowInfo.get(el), rect: el.getBoundingClientRect() }));
    if (rows.length === 0) return;
    let gap = rows.findIndex((r) => last.y < r.rect.top + r.rect.height / 2); // the first row whose middle is below the finger
    if (gap === -1) gap = rows.length;
    const prev = gap > 0 ? rows[gap - 1] : null;
    const next = gap < rows.length ? rows[gap] : null;

    // The levels that fit in this gap, outermost first: from the next row's level out to one inside the previous row.
    const options = [];
    if (!prev) {
      options.push({ level: next.info.node.level, depth: next.info.row.depth, position: 'before', target: next.info.node, climb: 0 });
    } else {
      const minLevel = next ? Math.min(next.info.node.level, prev.info.node.level + 1) : 1;
      for (let level = minLevel; level <= prev.info.node.level + 1; level += 1) {
        const depth = prev.info.row.depth + (level - prev.info.node.level);
        if (level === prev.info.node.level + 1) {
          const open = prev.info.row.hasChildren && !prev.info.node.collapsed;
          options.push({ level, depth, position: open ? 'firstChild' : 'lastChild', target: prev.info.node, climb: 0 });
        } else {
          const climb = prev.info.node.level - level;
          if (climb <= dropClimbLimit(S.state.doc, prev.info.node, node)) options.push({ level, depth, position: 'after', target: prev.info.node, climb });
        }
      }
    }
    if (options.length === 0) return;
    const anchor = (prev || next).rect.left + 8;
    // The level follows how far the finger has moved sideways from where it lifted, one step per level, and moving right is
    // always deeper, as the outline is drawn. The grip's own side is where the range starts: from a right-hand grip the
    // finger begins at the deepest level here and moves left to come out; from a left-hand grip it begins at the outermost
    // and moves right to go in. Either way the range is under the finger from the first step, however far it travelled.
    const start = side === 'right' ? options[options.length - 1].level : options[0].level;
    const wanted = start + Math.round((last.x - startX) / STEP_PX);
    let best = options[0];
    for (const o of options) if (Math.abs(o.level - wanted) < Math.abs(best.level - wanted)) best = o;
    drop = best;

    const lineLeft = anchor + best.depth * INDENT_PX;
    const lineTop = (next ? next.rect.top : prev.el.parentElement.lastElementChild.getBoundingClientRect().bottom) - 1;
    line.style.left = lineLeft + 'px';
    line.style.width = Math.max(40, (next || prev).rect.right - lineLeft - 8) + 'px';
    line.style.top = lineTop + 'px';
    line.style.display = 'block';
    const name = (n) => n.title || '(untitled)';
    let says;
    if (best.position === 'before') says = best.depth === 0 ? 'top level' : `before ${name(best.target)}`;
    else if (best.position === 'after') {
      says = best.level === 1 ? 'top level' : `same level as ${name(ancestorAt(S.state.doc, best.target, best.climb))}`;
    } else says = `into ${name(best.target)}`;
    const t = tag();
    t.textContent = says;
    t.style.display = 'block';
    t.style.top = lineTop - 22 + 'px';
    if (side === 'right') {
      t.style.right = '';
      t.style.left = Math.min(lineLeft, innerWidth - t.offsetWidth - 12) + 'px'; // over the line's start, away from the grip at the right
    } else {
      t.style.left = '';
      t.style.right = '12px'; // right-aligned, clear of the finger at the left
    }
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
    if (tagEl && tagEl.parentNode) tagEl.parentNode.removeChild(tagEl);
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
