
/**
 * Fold/collapse state model.
 *
 * This is deliberately much smaller than an earlier version, which
 * persisted a sparse per-heading override list to IndexedDB (keyed by a
 * best-effort content hash, since headings have no stable id by default)
 * so a document would "remember" exactly which headings you'd manually
 * folded or unfolded across sessions.
 *
 * That machinery is gone. The reason: real Emacs org-mode doesn't do that
 * either. Reopening a .org file re-applies its #+STARTUP visibility
 * directive fresh every time — Emacs does not remember your last manual
 * fold across sessions by default. Chasing "remember exactly what the
 * user folded" was solving a problem org-mode itself doesn't solve,
 * using an identity-hashing/hash-collision-prone/rename-breaks-it system
 * to do it. Declaring the desired default visibility *in the file*
 * (#+STARTUP:, see startup-config.js) is both more correct — it matches
 * the actual spec — and removes an entire subsystem: no more per-heading
 * id computation, no override diffing, no IndexedDB round-trip on every
 * fold click. A session's manual folding is live, in-memory UI state for
 * that session, same as it is in Emacs; closing and reopening resets to
 * whatever the file declares.
 */

import { isArchived } from './archive-model.js';

/**
 * Sets every heading's initial `collapsed` state from the file's parsed
 * #+STARTUP visibility (see startup-config.js): 'overview' collapses
 * everything (only top-level headings show, matching org's actual
 * 'overview' semantics — child headings are hidden, not just their body
 * text); anything else ('content', 'showall', 'showeverything') expands
 * everything — EXCEPT an archived heading itself, which stays collapsed
 * regardless of visibility mode when `archiveVisibility: 'archived'` (the
 * default), the same rule the slide-left cycle already applies (see
 * expandFully below). Without this, 'content'/'showall'/'showeverything'
 * would unfold an archived subtree's children right on file open — a real
 * bug this fixes, not a hypothetical: 'content' mode in particular sets
 * every heading's `collapsed: false` unconditionally, which included
 * archived ones until this changed. An archived heading's own descendants
 * still get their `collapsed`/`bodyHidden` set per the normal visibility
 * rule (not forced collapsed themselves) — only the archived heading
 * itself is forced shut, which is what actually hides them from view
 * (flattenVisibleRows never recurses into a collapsed heading's
 * children), and it means manually expanding that one heading later (via
 * the chevron) reveals its contents already in the right state for
 * whatever visibility mode is active, not doubly restricted.
 *
 * Known simplification, stated rather than hidden: org's real 'content'
 * mode shows every heading LINE but folds away body text under each one —
 * a distinction this app's simpler per-heading collapsed flag can't
 * represent (that flag controls "children and body" together, not
 * separately). `bodyHidden` is the second, independent flag that makes
 * that distinction real: `collapsed` controls whether a heading's
 * children (and body) are visible at all; `bodyHidden` controls
 * specifically whether a heading's own body content shows, independent of
 * whether its children headings do.
 */
function applyStartupVisibility(doc, startupConfig) {
  const collapsedDefault = startupConfig.visibility === 'overview';
  const bodyHiddenDefault = startupConfig.visibility === 'content';
  const archiveVisibility = startupConfig.archiveVisibility || 'archived';

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      const forceCollapsed = archiveVisibility === 'archived' && isArchived(node);
      node.collapsed = forceCollapsed ? true : collapsedDefault;
      node.bodyHidden = bodyHiddenDefault;
      walk(node.children);
    }
  }
  walk(doc.children);
  return doc;
}

/**
 * Whether `heading` and every descendant heading (recursively) is
 * expanded. Used to tell "fully expanded" apart from "one level
 * expanded" — there's no separate state tracked for this; it's derived
 * from the actual collapsed flags in the subtree each time, so it can
 * never drift out of sync with what's really on screen.
 *
 * `archiveVisibility: 'archived'` (the default) excludes archived
 * children from this check — an archived child sitting collapsed
 * shouldn't prevent its parent from counting as "fully expanded", since
 * visibility cycling deliberately leaves archived items alone (see
 * expandFully below).
 */
function isFullyExpanded(heading, opts = {}) {
  const { archiveVisibility = 'archived' } = opts;
  if (heading.collapsed) return false;
  for (const child of heading.children || []) {
    if (archiveVisibility === 'archived' && isArchived(child)) continue;
    if (!isFullyExpanded(child, opts)) return false;
  }
  return true;
}

/** Reveals `heading`'s own content and its direct child headings, but
 *  collapses each direct child — so grandchildren stay hidden. This is
 *  the "one level" step. */
function expandOneLevel(heading) {
  heading.collapsed = false;
  for (const child of heading.children || []) {
    child.collapsed = true;
  }
}

/**
 * Reveals `heading` and every descendant heading, recursively — except,
 * with `archiveVisibility: 'archived'` (the default), an archived child
 * is left collapsed and not recursed into at all, matching the requested
 * behavior: visibility cycling (the slide-left gesture) does not
 * expand/unfold archived items, though they can still be expanded
 * directly with the chevron (a direct, explicit action on that specific
 * heading, unaffected by this — this only skips *cascading* expansion
 * onto archived descendants during a cycle).
 */
function expandFully(heading, opts = {}) {
  const { archiveVisibility = 'archived' } = opts;
  heading.collapsed = false;
  for (const child of heading.children || []) {
    if (archiveVisibility === 'archived' && isArchived(child)) {
      child.collapsed = true;
      continue;
    }
    expandFully(child, opts);
  }
}

/** Collapses `heading` AND resets every descendant back to collapsed too
 *  — not just hiding them (which node.collapsed = true alone would do),
 *  but resetting their state, so the next cycle starts clean at "one
 *  level" rather than silently remembering a stale full-expand from
 *  before. Without this reset, cycling collapsed -> full -> collapsed ->
 *  (expected: one level) could actually jump straight back to "full",
 *  since the descendants' collapsed=false flags would still be sitting
 *  there unseen. */
function collapseFully(heading) {
  heading.collapsed = true;
  for (const child of heading.children || []) {
    collapseFully(child);
  }
}

/**
 * Advances `heading` through the three-state fold cycle used by the
 * slide-left gesture: collapsed -> one level -> fully expanded ->
 * collapsed -> ... There's no stored "which step am I on" — each call
 * inspects the heading's actual current fold state and decides the next
 * step from that, which is what makes it safe to call after some other
 * action (e.g. the plain fold-toggle button) has changed things in a way
 * that doesn't cleanly match one of the three canonical states: a
 * heading that's expanded but only partially (some grandchildren shown,
 * others not) is treated as "not fully expanded", so the next call
 * advances it to fully expanded rather than getting stuck.
 *
 * `opts.archiveVisibility` (default 'archived') is threaded through to
 * isFullyExpanded/expandFully — see their docs for what it does.
 *
 * Returns which state the heading ended up in: 'children' | 'full' | 'collapsed'.
 */
function cycleFoldLevel(heading, opts = {}) {
  if (heading.collapsed) {
    expandOneLevel(heading);
    return 'children';
  }
  if (isFullyExpanded(heading, opts)) {
    collapseFully(heading);
    return 'collapsed';
  }
  expandFully(heading, opts);
  return 'full';
}

export {
  applyStartupVisibility,
  isFullyExpanded,
  expandOneLevel,
  expandFully,
  collapseFully,
  cycleFoldLevel,
};
