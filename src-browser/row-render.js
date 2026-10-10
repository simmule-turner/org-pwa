// Extracted from app.js: row render.
import { captionText, imageOptions, splitAffiliated } from '../src/affiliated.js';
import { getPropertiesText, getProperty, isArchivedInPlace } from '../src/archive-model.js';
import { deleteListItem, deleteParagraph, deleteTable, deleteTableColumn, deleteTableRow, insertListItem, insertParagraphAfter, insertTableColumn, insertTableRow, isTableHeaderRow, setTableCell } from '../src/body-edit.js';
import { updateCheckboxCookiesUpward } from '../src/checkbox-cookie.js';
import { demoteHeading, insertChildHeading, moveHeadingDown, moveHeadingUp, promoteHeading } from '../src/heading-edit.js';
import { extractLatexFragments, parseInline, stripLineBreakMarker } from '../src/inline-markup.js';
import { getDragHandle, parseLispBoolean } from '../src/local-variables.js';
import { parseLogbookEntries } from '../src/logbook.js';
import { cycleHeadingTodo, cycleItemCheckbox, toggleFold } from '../src/outline-view-model.js';
import { S } from './app-state.js';
import { openArchiveConfirmPrompt, unarchiveHeadingToOriginalLocation } from './archive-flow.js';
import { GLOBAL_TODO_DEFAULT, SIDE_PANEL_MIN_WIDTH } from './constants.js';
import { confirmDialog, openHeadingTextEditor } from './dialogs.js';
import { contactPhotoValueForHeading, stripCommaEscapeApp } from './doc-helpers.js';
import { sidePanelDividerEl, sidePanelEl, splitRowEl } from './dom.js';
import { commitAndRender, openListItemEditor, openParagraphEditor, renderHistoryPanel, setStatus, startEditingTitle } from './editing.js';
import { attachHeadingGrip } from './heading-drag.js';
import { openGeneralEditor } from './general-editor.js';
import { attachSlideLeftToFold, attachSlideRightToComplete, confirmListItemDelete, confirmParagraphDelete, confirmTableDelete, deleteHeadingWithConfirmation, narrowToHeading, widen } from './gestures-structure.js';
import { cyclePriorityFor, openEffortEditor } from './heading-commands.js';
import { currentInlineOpts, renderInlineNodes } from './inline-render.js';
import { applyKeyboardFocusHighlight, resyncKeyboardFocusToBodyRow, rowMatchesKeyboardFocus, setKeyboardFocusToRow } from './keyboard-focus.js';
import { toggleActionMenu } from './navigation.js';
import { getOrRenderPlotSvg } from './render-helpers.js';
import { render } from './render.js';
import { applySidePanelWidth, renderSettingsView } from './settings-view.js';
import { setSidePanelWidth } from './settings.js';
import { kv } from './singletons.js';
import { recalculateOneTable } from './table-recalc.js';
import { applyTodoTransition, openTodoOrPickWorkflow } from './todo-workflow.js';
import { autoGrowTextarea, isWideLayout, smallButton, withActionMenu } from './ui-widgets.js';

/** The vertical margin around a paragraph, and around everything else in the
 *  body (tables, rules, source/quote/other blocks). Two adjacent blocks' margins
 *  collapse to ONE gap -- the larger of the two -- so the paragraph value is the
 *  space between consecutive paragraphs. They are two values, like the main and
 *  tables font sizes, read from CSS variables set by Settings -> Appearance ->
 *  Paragraph Spacing (src-browser/appearance.js); the literals here are only what
 *  applies before those settings have loaded. */
const PARAGRAPH_MARGIN = 'var(--paragraph-gap, 10px) 0';
const TABLES_MARGIN = 'var(--paragraph-gap-tables, 10px) 0';

export function renderActionMenu(actions, columns = 5) {
  const menu = document.createElement('div');
  menu.style.display = 'grid';
  menu.style.gridTemplateColumns = `repeat(${columns}, 44px)`; // fixed count per row, regardless of container width -- flex-wrap would vary the count by available space instead
  menu.style.justifyContent = 'center'; // centers the (fixed-width) button grid within the row's available width -- responsive to any container width and any column count, unlike a fixed left-margin value that would only look centered at one specific width
  menu.style.gap = '8px';
  menu.style.padding = '8px 8px 10px 8px';
  menu.style.borderBottom = '0.5px solid #8882';
  menu.style.overflowX = 'auto'; // safety net: a wide row (especially at 6 columns) can get tight on narrow phones, more so once a nested heading's own depth indentation eats into available width -- keeps buttons reachable via local scroll rather than clipped if it doesn't fit
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = action.icon;
    btn.setAttribute('aria-label', action.label);
    btn.className = 'icon-btn';
    btn.style.fontSize = '22px'; // matches the top-bar icons exactly
    btn.onclick = action.onClick;
    menu.appendChild(btn);
  }
  menu.onclick = (e) => {
    // Only when the tap landed on the menu's own background, not a
    // button -- e.target is the actual element tapped, so this only
    // fires in genuinely empty grid space (e.g. to the right of the
    // last button on a row that doesn't perfectly fill the width).
    if (e.target === menu) {
      S.actionMenuFor = null;
      render();
    }
  };
  return menu;
}

export function renderRow(row, todoSequence) {
  if (row.rowType === 'heading') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    el.style.alignItems = 'flex-start';
    el.style.touchAction = 'pan-y';
    applyKeyboardFocusHighlight(el, row);
    attachSlideLeftToFold(el, row.node);
    attachSlideRightToComplete(el, row.node);

    const dragHandle = getDragHandle(S.state.localVariables || S.globalVariables);
    if (dragHandle === 'left') el.appendChild(attachHeadingGrip(el, row, 'left'));

    const fold = document.createElement('button');
    fold.className = 'fold-btn';
    fold.textContent = row.hasChildren ? (row.node.collapsed ? '\u25b8' : '\u25be') : ' ';
    fold.setAttribute('aria-label', 'Toggle fold');
    fold.onclick = () => {
      toggleFold(row.node);
      render();
    };
    el.appendChild(fold);

    if (row.node.todo) {
      const badge = document.createElement('span');
      badge.className = 'todo-badge ' + (todoSequence.doneKeywords.includes(row.node.todo) ? 'done' : 'todo');
      badge.textContent = row.node.todo;
      badge.onclick = () => {
        applyTodoTransition(row.node, () => cycleHeadingTodo(S.state.doc, row.node, GLOBAL_TODO_DEFAULT));
        commitAndRender('Cycled TODO state');
      };
      el.appendChild(badge);
    }

    if (row.node.priority) {
      const priorityBadge = document.createElement('span');
      priorityBadge.className = 'priority-badge';
      priorityBadge.textContent = `#${row.node.priority}`;
      priorityBadge.onclick = () => cyclePriorityFor(row.node);
      el.appendChild(priorityBadge);
    }

    const rowEffort = getProperty(row.node, 'EFFORT');
    if (rowEffort) {
      const effortBadge = document.createElement('span');
      effortBadge.className = 'priority-badge';
      effortBadge.textContent = `\u23f1 ${rowEffort}`;
      effortBadge.onclick = () => openEffortEditor(row.node);
      el.appendChild(effortBadge);
    }

    let menuEl = null;

    {
      const title = document.createElement('span');
      title.className = 'heading-title';
      if (row.node.title) {
        renderInlineNodes(parseInline(row.node.title, currentInlineOpts()), title, null, row.node);
      } else {
        title.textContent = '(untitled)';
        title.style.opacity = '0.5';
      }
      title.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        setKeyboardFocusToRow(row);
        toggleActionMenu(row.node);
      });
      el.appendChild(title);

      for (const tag of row.node.tags) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = tag;
        el.appendChild(t);
      }
      if (dragHandle === 'right') el.appendChild(attachHeadingGrip(el, row, 'right'));

      if (S.actionMenuFor === row.node) {
        menuEl = renderActionMenu(
          [
            {
              icon: '\u270f\ufe0f',
              label: 'Edit title',
              onClick: () => {
                S.actionMenuFor = null;
                startEditingTitle(row.node, false);
              },
            },
            {
              icon: '\ud83d\udcdd',
              label: 'Edit text',
              onClick: () => {
                S.actionMenuFor = null;
                S.editingHeadingText = row.node;
                render();
              },
            },
            {
              icon: '\ud83d\udccb',
              label: 'Edit details (scheduled/deadline, tags, priority, properties)',
              onClick: () => {
                S.actionMenuFor = null;
                render();
                S.editingGeneral = row.node;
                openGeneralEditor(row.node);
              },
            },
            {
              icon: '+',
              label: 'Add sub-heading',
              onClick: () => {
                S.actionMenuFor = null;
                const child = insertChildHeading(row.node, {});
                startEditingTitle(child, true);
              },
            },
            {
              icon: '\u2191',
              label: 'Move up',
              onClick: () => {
                if (moveHeadingUp(S.state.doc, row.node)) {
                  commitAndRender('Moved heading up');
                } else {
                  setStatus('Already first among its siblings.');
                  render();
                }
              },
            },
            {
              icon: '\u2193',
              label: 'Move down',
              onClick: () => {
                if (moveHeadingDown(S.state.doc, row.node)) {
                  commitAndRender('Moved heading down');
                } else {
                  setStatus('Already last among its siblings.');
                  render();
                }
              },
            },
            {
              icon: '\u2611\ufe0f',
              label: 'TODO',
              onClick: () => {
                S.actionMenuFor = null;
                openTodoOrPickWorkflow(row.node);
              },
            },
            {
              icon: isArchivedInPlace(row.node) ? '\ud83d\udce4' : '\ud83d\uddc4\ufe0f',
              label: isArchivedInPlace(row.node) ? 'Unarchive (restore)' : 'Archive',
              onClick: async () => {
                S.actionMenuFor = null;
                render();
                if (isArchivedInPlace(row.node)) {
                  await unarchiveHeadingToOriginalLocation(row.node);
                } else {
                  openArchiveConfirmPrompt(row.node);
                }
              },
            },
            {
              icon: S.narrowedHeading === row.node ? '\ud83d\udd3c' : '\ud83d\udd3d',
              label: S.narrowedHeading === row.node ? 'Widen' : 'Narrow',
              onClick: () => {
                S.actionMenuFor = null;
                render();
                if (S.narrowedHeading === row.node) {
                  widen();
                } else {
                  narrowToHeading(row.node);
                }
              },
            },
            {
              icon: '\u2715',
              label: 'Delete heading',
              onClick: () => {
                S.actionMenuFor = null;
                deleteHeadingWithConfirmation(row.node);
              },
            },
            {
              icon: '\u2190',
              label: 'Promote (outdent)',
              onClick: () => {
                if (promoteHeading(S.state.doc, row.node)) {
                  commitAndRender('Promoted heading');
                } else {
                  setStatus("Already top-level \u2014 can't promote further.");
                  render();
                }
              },
            },
            {
              icon: '\u2192',
              label: 'Demote (indent)',
              onClick: () => {
                if (demoteHeading(S.state.doc, row.node)) {
                  commitAndRender('Demoted heading');
                } else {
                  setStatus("No preceding sibling to demote under.");
                  render();
                }
              },
            },
          ],
          6
        );
      }
    }

    if (S.editingHeadingText === row.node && !document.getElementById('heading-text-edit-popup')) {
      openHeadingTextEditor(row.node);
    }

    let generalEditorEl = null;

    let propertiesDisplayEl = null;
    if (!row.node.drawersHidden && row.node.propertyOrder.length > 0 && S.editingGeneral !== row.node) {
      propertiesDisplayEl = document.createElement('div');
      propertiesDisplayEl.style.padding = '2px 10px 6px 40px';
      propertiesDisplayEl.style.fontSize = '12px';
      propertiesDisplayEl.style.fontFamily = 'monospace';
      propertiesDisplayEl.style.opacity = '0.65';
      propertiesDisplayEl.style.whiteSpace = 'pre-wrap';
      propertiesDisplayEl.style.overflowWrap = 'anywhere';
      propertiesDisplayEl.style.cursor = 'pointer';
      propertiesDisplayEl.textContent = getPropertiesText(row.node);
      propertiesDisplayEl.onclick = () => toggleActionMenu(row.node);

      const photoValue = contactPhotoValueForHeading(row.node);
      const showPhotosOn = parseLispBoolean((S.state.localVariables || {})['org-xx-startup-with-show-photos'], false);
      if (showPhotosOn && photoValue) {
        const photoThumbnailEl = document.createElement('img');
        photoThumbnailEl.src = photoValue;
        photoThumbnailEl.alt = '';
        photoThumbnailEl.style.display = 'block';
        photoThumbnailEl.style.maxWidth = '80px';
        photoThumbnailEl.style.maxHeight = '80px';
        photoThumbnailEl.style.borderRadius = '6px';
        photoThumbnailEl.style.margin = '4px 0 2px';
        propertiesDisplayEl.appendChild(photoThumbnailEl);
      }
    }

    let logbookDisplayEl = null;
    if (!row.node.drawersHidden && row.node.logbookLines.length > 0 && S.editingGeneral !== row.node) {
      logbookDisplayEl = document.createElement('div');
      logbookDisplayEl.style.padding = '2px 10px 6px 40px';
      logbookDisplayEl.style.fontSize = '12px';
      logbookDisplayEl.style.opacity = '0.65';
      logbookDisplayEl.style.cursor = 'pointer';
      logbookDisplayEl.onclick = () => toggleActionMenu(row.node);
      for (const entry of parseLogbookEntries(row.node.logbookLines)) {
        const line = document.createElement('div');
        line.style.whiteSpace = 'pre-wrap';
        line.style.overflowWrap = 'anywhere';
        if (entry.type === 'clock') {
          line.textContent = entry.end
            ? `Clock: ${entry.start}\u2013${entry.end} \u21d2 ${entry.duration}`
            : `Clock: ${entry.start} (running)`;
        } else if (entry.type === 'state') {
          const transition = entry.oldState ? `${entry.oldState} \u2192 ${entry.newState}` : entry.newState;
          line.textContent = `${transition}   ${entry.timestamp}`;
        } else {
          line.textContent = `Note   ${entry.timestamp}`;
        }
        logbookDisplayEl.appendChild(line);
        if (entry.note) {
          const noteLine = document.createElement('div');
          noteLine.style.whiteSpace = 'pre-wrap';
          noteLine.style.overflowWrap = 'anywhere';
          noteLine.style.paddingLeft = '12px';
          noteLine.style.fontStyle = 'italic';
          noteLine.textContent = entry.note;
          logbookDisplayEl.appendChild(noteLine);
        }
      }
    }

    return withActionMenu(el, menuEl, generalEditorEl, propertiesDisplayEl, logbookDisplayEl);
  }

  if (row.rowType === 'list-item') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    el.style.alignItems = 'flex-start';
    applyKeyboardFocusHighlight(el, row);
    if (row.item.checkbox !== null) {
      el.classList.add('checkbox-row');
      el.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        cycleItemCheckbox(row.heading, row.item);
        updateCheckboxCookiesUpward(S.state.doc, row.heading, todoSequence.doneKeywords);
        commitAndRender('Toggled checkbox');
      };
      const box = document.createElement('span');
      box.textContent = row.item.checkbox === 'X' ? '\u2611' : row.item.checkbox === '-' ? '\u25aa' : '\u2610';
      el.appendChild(box);
    } else {
      const marker = document.createElement('span');
      marker.style.flexShrink = '0';
      marker.style.color = 'var(--text-muted, #888)';
      marker.style.fontSize = '13px';
      marker.style.textAlign = 'right';
      marker.style.minWidth = row.item.ordered ? '22px' : '12px';
      marker.textContent = row.item.ordered ? row.displayNumber + '.' : '\u2022';
      el.appendChild(marker);
    }

    let menuEl = null;

    {
      const text = document.createElement('span');
      const hasContent = row.item.text.trim() !== '' || (row.item.tag && row.item.tag.trim() !== '');
      if (hasContent) {
        if (row.item.tag) {
          text.appendChild(document.createTextNode(row.item.tag + ' :: '));
        }
        renderInlineNodes(parseInline(row.item.text, currentInlineOpts()), text, null, row.heading);
      } else {
        // An empty item (e.g. a fresh checkbox with nothing typed yet)
        // otherwise renders zero visible content here — which means zero
        // tappable area, since this span is the only thing with the
        // reveal-menu handler. That made an empty item's edit/add/delete
        // actions completely unreachable: nothing to tap to reveal them.
        // Same placeholder pattern already used for an empty paragraph.
        text.textContent = '(empty \u2014 tap for options)';
        text.style.opacity = '0.5';
      }
      text.style.flex = '1 1 auto';
      text.style.minWidth = '0';
      text.style.whiteSpace = 'normal';
      text.style.overflowWrap = 'anywhere';
      text.style.cursor = 'text';
      // Tapping the text reveals the contextual menu (edit/add/delete)
      // rather than jumping straight into editing — even on a checkbox
      // row where tapping elsewhere toggles the checkbox; stopPropagation
      // is what keeps those two gestures from colliding.
      text.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        e.stopPropagation();
        toggleActionMenu(row.item);
      };
      el.appendChild(text);

      if (S.actionMenuFor === row.item) {
        menuEl = renderActionMenu(
          [
          {
            icon: '\u270f\ufe0f',
            label: 'Edit text',
            onClick: (e) => {
              e.stopPropagation();
              S.actionMenuFor = null;
              S.editingListItem = { heading: row.heading, item: row.item };
              render();
              openListItemEditor(row.heading, row.item);
            },
          },
          {
            icon: '+',
            label: 'Add item below',
            onClick: (e) => {
              e.stopPropagation();
              S.actionMenuFor = null;
              const oldLineIndex = row.item.lineIndex;
              const newItem = insertListItem(row.heading, row.item, '');
              resyncKeyboardFocusToBodyRow(row.heading, 'list-item', oldLineIndex);
              updateCheckboxCookiesUpward(S.state.doc, row.heading, todoSequence.doneKeywords);
              S.editingListItem = { heading: row.heading, item: newItem };
              commitAndRender('Added list item');
              openListItemEditor(row.heading, newItem);
            },
          },
          {
            icon: '\u2715',
            label: 'Delete item',
            onClick: async (e) => {
              e.stopPropagation();
              if (!(await confirmListItemDelete(row.item))) return;
              S.actionMenuFor = null;
              if (S.editingListItem && S.editingListItem.item === row.item) S.editingListItem = null;
              if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'list-item' && S.keyboardFocusedBodyRow.item === row.item) {
                S.keyboardFocusedBodyRow = null;
              }
              deleteListItem(row.heading, row.item);
              updateCheckboxCookiesUpward(S.state.doc, row.heading, todoSequence.doneKeywords);
              commitAndRender('Deleted list item');
            },
          },
          ],
          3
        );
      }
    }

    return withActionMenu(el, menuEl);
  }

  if (row.rowType === 'table') return renderTableRow(row);
  if (row.rowType === 'paragraph') return renderParagraphRow(row);
  if (row.rowType === 'block') return renderBlockRow(row);
  if (row.rowType === 'hr') return renderHrRow(row);

  const el = document.createElement('div');
  el.className = 'row';
  el.style.paddingLeft = 8 + row.depth * 16 + 'px';
  el.style.opacity = '0.6';
  el.style.fontStyle = 'italic';
  el.textContent = '[' + row.rowType + ']';
  return el;
}

export function renderTableRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = TABLES_MARGIN;
  applyKeyboardFocusHighlight(wrap, row);

  // A table has no single "tap the text" affordance the way a paragraph
  // or list item does — you interact with individual cells, and its
  // structural controls (+row/+col etc.) are a real toolbar, not a
  // per-item options menu, so they stay always-visible below the grid.
  // This label is the tap target for the one thing that *does* belong in
  // a reveal-on-tap menu: deleting the whole table.
  const label = document.createElement('div');
  label.textContent = '\u25a6 Table';
  label.style.fontSize = '11px';
  label.style.color = 'var(--text-muted, #888)';
  label.style.cursor = 'pointer';
  label.style.padding = '2px 0 4px';
  label.onclick = () => {
    toggleActionMenu(row.node);
  };
  wrap.appendChild(label);

  let menuEl = null;
  if (S.actionMenuFor === row.node) {
    menuEl = renderActionMenu(
      [
        {
          icon: '\u2715',
          label: 'Delete table',
          onClick: async () => {
            if (!(await confirmTableDelete(row.node))) return;
            S.actionMenuFor = null;
            if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'table' && S.keyboardFocusedBodyRow.node === row.node) {
              S.keyboardFocusedBodyRow = null;
              S.keyboardFocusedCellPos = null;
            }
            deleteTable(row.heading, row.node);
            commitAndRender('Deleted table');
          },
        },
      ],
      1
    );
  }

  const tableEl = document.createElement('table');
  tableEl.style.borderCollapse = 'collapse';
  tableEl.style.fontSize = 'var(--app-font-size-tables)';

  row.node.rows.forEach((tr, rowIndex) => {
    if (tr.type === 'rule') return; // shown implicitly via the header row's styling, not as its own grid row
    const trEl = document.createElement('tr');
    tr.cells.forEach((cellText, colIndex) => {
      const tdEl = document.createElement('td');
      tdEl.style.border = '1px solid #8886';
      tdEl.style.padding = '3px 6px';
      tdEl.style.cursor = 'text';
      if (isTableHeaderRow(row.node, rowIndex)) tdEl.style.fontWeight = '600';
      if (rowMatchesKeyboardFocus(row) && S.keyboardFocusedCellPos && S.keyboardFocusedCellPos.rowIndex === rowIndex && S.keyboardFocusedCellPos.colIndex === colIndex) {
        tdEl.style.outline = '2px solid var(--accent)';
        tdEl.style.outlineOffset = '-2px';
      }

      const isEditing =
        S.editingCell &&
        S.editingCell.table === row.node &&
        S.editingCell.rowIndex === rowIndex &&
        S.editingCell.colIndex === colIndex;

      if (isEditing) {
        const thisCellTable = row.node;
        const thisCellRowIndex = rowIndex;
        const thisCellColIndex = colIndex;
        tdEl.style.display = 'flex';
        tdEl.style.alignItems = 'center';
        tdEl.style.gap = '4px';
        const input = document.createElement('textarea');
        input.id = 'cell-edit-input';
        input.value = cellText;
        input.rows = 1;
        input.style.font = 'inherit';
        input.style.flex = '1 1 auto';
        input.style.minWidth = Math.min(50, cellText.length * 8 || 50) + 'px';
        input.style.maxWidth = '220px';
        input.style.boxSizing = 'border-box';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            // A literal newline would break the table's one-row-per-line
            // syntax on save — Enter commits instead, same as before.
            e.preventDefault();
            e.stopPropagation();
            input.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            S.editingCell = null;
            render();
          }
        });
        input.addEventListener('blur', () => {
          if (
            !S.editingCell ||
            S.editingCell.table !== thisCellTable ||
            S.editingCell.rowIndex !== thisCellRowIndex ||
            S.editingCell.colIndex !== thisCellColIndex
          ) {
            return;
          }
          const { heading, table, rowIndex: ri, colIndex: ci } = S.editingCell;
          S.editingCell = null;
          setTableCell(heading, table, ri, ci, input.value.replace(/\n/g, ' '));
          resyncKeyboardFocusToBodyRow(heading, 'table', table.lineIndex);
          commitAndRender('Edited table cell');
        });
        autoGrowTextarea(input);
        tdEl.appendChild(input);

        // Discard button -- mousedown (not click), so it clears editingCell
        // and re-renders BEFORE the textarea's own blur ever fires, the
        // exact same ordering the cross-cell-switch handler below already
        // relies on: mousedown always fires ahead of blur, so acting here
        // means the blur handler above sees editingCell already cleared/
        // mismatched and correctly no-ops rather than committing anyway.
        // The only in-place way to discard a cell edit without relying on
        // Escape, which the on-screen keyboard on a phone or tablet never
        // exposes at all.
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '\u238c';
        cancelBtn.className = 'cell-cancel-btn';
        cancelBtn.setAttribute('aria-label', 'Discard cell edit');
        cancelBtn.style.flex = '0 0 auto';
        cancelBtn.style.border = 'none';
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.color = 'var(--fg)';
        cancelBtn.style.opacity = '0.6';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontSize = '13px';
        cancelBtn.style.padding = '2px 4px';
        cancelBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          S.editingCell = null;
          render();
        });
        tdEl.appendChild(cancelBtn);
      } else {
        if (cellText) {
          renderInlineNodes(parseInline(cellText, currentInlineOpts()), tdEl, null, row.heading);
        } else {
          tdEl.textContent = '\u00a0';
        }
        tdEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (S.editingCell) {
            const prevInput = document.getElementById('cell-edit-input');
            const { heading, table, rowIndex: ri, colIndex: ci } = S.editingCell;
            S.editingCell = null;
            if (prevInput) setTableCell(heading, table, ri, ci, prevInput.value.replace(/\n/g, ' '));
          }
          setKeyboardFocusToRow(row);
          S.keyboardFocusedCellPos = { rowIndex, colIndex };
          // row.node may already be stale here -- the commit just above,
          // if there was one, fully re-parses heading.body (see the
          // comment on this whole handler), which produces a BRAND NEW
          // table object whenever the committed cell shares this same
          // heading. Re-finding it fresh by lineIndex, rather than
          // trusting the closure-captured row.node directly, is what
          // makes this correct either way.
          const freshTable = (row.heading.body || []).find((n) => n.type === 'table' && n.lineIndex === row.node.lineIndex) || row.node;
          S.editingCell = { heading: row.heading, table: freshTable, rowIndex, colIndex };
          commitAndRender('Edited table cell');
        });
      }
      trEl.appendChild(tdEl);
    });
    tableEl.appendChild(trEl);
  });
  const tableScroll = document.createElement('div');
  tableScroll.style.overflowX = 'auto';
  tableScroll.style.maxWidth = '100%';
  tableScroll.style.webkitOverflowScrolling = 'touch';
  tableScroll.appendChild(tableEl);
  wrap.appendChild(tableScroll);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '4px';
  controls.style.marginTop = '4px';

  const dataRowCount = () => row.node.rows.filter((r) => r.type === 'row').length;
  const colCount = () => {
    const dr = row.node.rows.find((r) => r.type === 'row');
    return dr ? dr.cells.length : 1;
  };

  function lastDataRowHasContent() {
    const dataRows = row.node.rows.filter((r) => r.type === 'row');
    const last = dataRows[dataRows.length - 1];
    return last ? last.cells.some((c) => c.trim() !== '') : false;
  }
  function lastColumnHasContent() {
    const dataRows = row.node.rows.filter((r) => r.type === 'row');
    const lastColIndex = colCount() - 1;
    return dataRows.some((r) => (r.cells[lastColIndex] || '').trim() !== '');
  }

  controls.appendChild(
    smallButton('+ row', 'Add row', () => {
      insertTableRow(row.heading, row.node, row.node.rows.length - 1);
      resyncKeyboardFocusToBodyRow(row.heading, 'table', row.node.lineIndex);
      commitAndRender('Added table row');
    })
  );
  controls.appendChild(
    smallButton('\u2212 row', 'Delete last row', async () => {
      if (dataRowCount() <= 1) {
        setStatus("Can't delete the last row.");
        return;
      }
      if (lastDataRowHasContent() && !(await confirmDialog('Delete the last row? It has data in it.'))) {
        return;
      }
      deleteTableRow(row.heading, row.node, row.node.rows.length - 1);
      resyncKeyboardFocusToBodyRow(row.heading, 'table', row.node.lineIndex);
      commitAndRender('Deleted table row');
    })
  );
  controls.appendChild(
    smallButton('+ col', 'Add column', () => {
      insertTableColumn(row.heading, row.node, colCount() - 1);
      resyncKeyboardFocusToBodyRow(row.heading, 'table', row.node.lineIndex);
      commitAndRender('Added table column');
    })
  );
  controls.appendChild(
    smallButton('\u2212 col', 'Delete last column', async () => {
      if (colCount() <= 1) {
        setStatus("Can't delete the last column.");
        return;
      }
      if (lastColumnHasContent() && !(await confirmDialog('Delete the last column? It has data in it.'))) {
        return;
      }
      deleteTableColumn(row.heading, row.node, colCount() - 1);
      resyncKeyboardFocusToBodyRow(row.heading, 'table', row.node.lineIndex);
      commitAndRender('Deleted table column');
    })
  );
  if (row.node.tblfm && row.node.tblfm.trim()) {
    controls.appendChild(
      smallButton('\ud83d\udd22 Calc', 'Recalculate this table', () => {
        const { result, message, hasError } = recalculateOneTable(row.heading, row.node);
        if (result === 'error') {
          setStatus(`Couldn't recalculate: ${message}`);
          render();
        } else if (result === 'unchanged') {
          setStatus('Table is already up to date.');
          render();
        } else if (result === 'changed') {
          setStatus(hasError ? 'Recalculated table -- one or more cells has #ERROR.' : 'Recalculated table.');
          commitAndRender('Recalculated table');
        }
        // 'no-formula' can't actually happen here -- the button itself is only shown when row.node.tblfm is set.
      })
    );
  }
  if (row.node.plot && row.node.plot.trim()) {
    const isPlotVisible = !!(row.heading.plotVisible && row.heading.plotVisible.has(row.node.lineIndex));
    controls.appendChild(
      smallButton(isPlotVisible ? '\ud83d\udcca Hide plot' : '\ud83d\udcca Plot', isPlotVisible ? "Hide this table's plot" : "Show this table's plot", () => {
        if (isPlotVisible) {
          row.heading.plotVisible.delete(row.node.lineIndex);
          render();
          return;
        }
        try {
          getOrRenderPlotSvg(row.node); // validate + warm the cache up front, so a bad #+PLOT: line surfaces immediately rather than marking it "visible" over nothing real
        } catch (err) {
          setStatus(`Couldn't plot: ${err.message}`);
          render();
          return;
        }
        row.heading.plotVisible = row.heading.plotVisible || new Set();
        row.heading.plotVisible.add(row.node.lineIndex);
        render();
      })
    );
  }
  wrap.appendChild(controls);

  if (row.node.plot && row.heading.plotVisible && row.heading.plotVisible.has(row.node.lineIndex)) {
    const plotWrap = document.createElement('div');
    plotWrap.style.marginTop = '6px';
    plotWrap.style.overflowX = 'auto';
    // Reclaims wrap's own depth-based left indentation for the plot
    // specifically (a chart is a graphic, not text continuing the
    // indented hierarchy the way a paragraph or a table's own cells
    // are), while still reserving a small, fixed, symmetric margin on
    // BOTH sides rather than letting it sit flush against either true
    // edge. wrap itself has no right-side padding at all (confirmed
    // directly -- it's never given the .row class other row kinds
    // elsewhere in this app get), so it's already flush-right; only
    // the left side carries the depth indentation being reclaimed
    // here, which is why this calc() is asymmetric between the two
    // sides even though the visual RESULT (8px inset on each side) is
    // symmetric.
    const indentPx = 8 + row.depth * 16; // matches wrap's own paddingLeft formula above exactly
    const EDGE_MARGIN = 8; // matches the "8" base already used in that same formula and in .row's own padding elsewhere
    plotWrap.style.marginLeft = `calc(${EDGE_MARGIN}px - ${indentPx}px)`;
    plotWrap.style.width = `calc(100% + ${indentPx}px - ${EDGE_MARGIN * 2}px)`;
    try {
      plotWrap.innerHTML = getOrRenderPlotSvg(row.node);
      const svgEl = plotWrap.querySelector('svg');
      if (svgEl) {
        // Overrides the SVG's own width="480"/height="320" attributes
        // (added for the standalone/exported case -- see org-plot.js's
        // own comments) only here, in the live app's styled DOM: CSS
        // always takes precedence over a presentation attribute. The
        // chart's own viewBox is untouched, so the whole thing scales
        // down proportionally -- text, points, everything together --
        // to fit whatever width is actually available on a narrow
        // phone, rather than rendering at a fixed size wider than the
        // screen with no way to see the rest. margin: auto centers it
        // within plotWrap's own (now edge-inset) width whenever the
        // chart's own natural or shrunk size is narrower than that --
        // e.g. a small chart on a wide screen that needs no shrinking
        // at all sits centered rather than flush against plotWrap's
        // own left edge.
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
        svgEl.style.display = 'block';
        svgEl.style.margin = '0 auto';
      }
    } catch (err) {
      // The table's own content changed since the plot was last shown
      // (a cache miss re-attempts fresh, see getOrRenderPlotSvg), and
      // this fresh attempt failed too -- a clear inline message, never
      // a silently empty area.
      plotWrap.textContent = `Couldn't plot: ${err.message}`;
      plotWrap.style.color = 'var(--text-muted, #888)';
      plotWrap.style.fontSize = '12px';
    }
    wrap.appendChild(plotWrap);
  }

  return withActionMenu(wrap, menuEl);
}

/** A horizontal rule (5+ dashes on their own line) -- purely visual, no
 *  action menu, since there's nothing meaningful to edit on it beyond
 *  what the plain-text editor or the heading's own "Edit text" action
 *  already cover for arbitrary raw content. */
export function renderHrRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.paddingRight = '8px';
  wrap.style.margin = TABLES_MARGIN;
  applyKeyboardFocusHighlight(wrap, row);
  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = '1px solid var(--border-strong)';
  hr.style.margin = '8px 0';
  wrap.appendChild(hr);
  return wrap;
}

/** The `#+NAME:`, `#+ATTR_*:`, `#+HEADER:` and `#+RESULTS:` lines above a paragraph, as small muted text
 *  (shown, not hidden, since they are part of the document). `#+CAPTION:` is not here; see renderCaption. */
function renderAffiliatedPrefix(affiliated) {
  const lines = affiliated.filter((a) => a.key !== 'CAPTION');
  if (!lines.length) return null;
  const box = document.createElement('div');
  box.setAttribute('data-affiliated', 'meta');
  box.style.cssText = 'font-size:11px;opacity:0.6;font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere;';
  box.textContent = lines.map((a) => a.line.trim()).join('\n');
  return box;
}

/** A `#+CAPTION:` as an italic caption, with its inline markup rendered. */
function renderCaption(text, heading) {
  const el = document.createElement('div');
  el.setAttribute('data-affiliated', 'caption');
  el.style.cssText = 'font-style:italic;font-size:0.92em;opacity:0.85;margin:2px 0;';
  renderInlineNodes(parseInline(text, currentInlineOpts()), el, null, heading);
  return el;
}

export function renderParagraphRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = PARAGRAPH_MARGIN;
  applyKeyboardFocusHighlight(wrap, row);

  const p = document.createElement('div');
  p.style.cursor = 'text';
  p.style.whiteSpace = 'pre-wrap';
  p.style.overflowWrap = 'anywhere';
  if (row.node.footnoteLabel !== null) {
    p.style.fontSize = '0.92em';
    p.style.opacity = '0.85';
    const labelEl = document.createElement('sup');
    labelEl.textContent = '[' + row.node.footnoteLabel + '] ';
    labelEl.style.opacity = '0.7';
    p.appendChild(labelEl);
  }
  // Leading #+NAME / #+CAPTION / #+ATTR_* lines describe what follows (the image, table or block); show them as that
  // instead of as raw paragraph text. The lines themselves are untouched and are still what gets edited and saved.
  const { affiliated, rest: contentLines } = splitAffiliated(row.node.lines);
  const affiliatedPrefix = renderAffiliatedPrefix(affiliated);
  if (affiliatedPrefix) p.appendChild(affiliatedPrefix);
  const caption = captionText(affiliated);
  const hasContent = contentLines.some((l) => l.trim() !== '');
  if (hasContent) {
    const strippedLines = contentLines.map((line, i) =>
      i === 0 && row.node.footnoteLabel !== null
        ? line.replace(new RegExp('^\\[fn:' + row.node.footnoteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s?'), '')
        : line
    );
    const { lines: extractedLines, fragments } = extractLatexFragments(strippedLines);
    const inlineOpts = { ...currentInlineOpts(), latexFragments: fragments };
    extractedLines.forEach((line, i) => {
      if (i > 0) {
        const prevLine = extractedLines[i - 1];
        const prevForcedBreak = stripLineBreakMarker(prevLine) !== prevLine;
        p.appendChild(prevForcedBreak ? document.createElement('br') : document.createTextNode(' '));
      }
      renderInlineNodes(parseInline(stripLineBreakMarker(line), inlineOpts), p, null, row.heading);
    });
  } else if (!affiliated.length) {
    p.textContent = '(empty note \u2014 tap to edit)';
    p.style.opacity = '0.5';
  }
  const sizing = imageOptions(affiliated);
  if (sizing.width || sizing.height || sizing.center) {
    p.querySelectorAll('img').forEach((img) => {
      if (sizing.width) img.style.width = sizing.width;
      if (sizing.height) img.style.height = sizing.height;
      if (sizing.center) {
        img.style.marginLeft = 'auto';
        img.style.marginRight = 'auto';
      }
    });
  }
  if (caption) p.appendChild(renderCaption(caption, row.heading));
  // Tapping the text reveals the contextual menu (edit/add/delete),
  // matching list items and headings, instead of jumping straight into
  // editing and showing a standalone always-visible delete button.
  p.onclick = (e) => {
    if (e.target.closest('[data-inline-link]')) return;
    toggleActionMenu(row.node);
  };
  wrap.appendChild(p);

  let menuEl = null;
  if (S.actionMenuFor === row.node) {
    menuEl = renderActionMenu(
      [
        {
          icon: '\u270f\ufe0f',
          label: 'Edit text',
          onClick: () => {
            S.actionMenuFor = null;
            S.editingParagraph = { heading: row.heading, paragraph: row.node };
            render();
            openParagraphEditor(row.heading, row.node);
          },
        },
        {
          icon: '+',
          label: 'Add paragraph below',
          onClick: () => {
            S.actionMenuFor = null;
            const oldLineIndex = row.node.lineIndex;
            const newParagraph = insertParagraphAfter(row.heading, row.node, '');
            resyncKeyboardFocusToBodyRow(row.heading, 'paragraph', oldLineIndex);
            S.editingParagraph = { heading: row.heading, paragraph: newParagraph };
            commitAndRender('Added paragraph');
            openParagraphEditor(row.heading, newParagraph);
          },
        },
        {
          icon: '\u2715',
          label: 'Delete note',
          onClick: async () => {
            if (!(await confirmParagraphDelete(row.node))) return;
            S.actionMenuFor = null;
            if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'paragraph' && S.keyboardFocusedBodyRow.node === row.node) {
              S.keyboardFocusedBodyRow = null;
            }
            deleteParagraph(row.heading, row.node);
            commitAndRender('Deleted paragraph');
          },
        },
      ],
      3
    );
  }

  return withActionMenu(wrap, menuEl);
}

export function renderBlockContent(block, container, linkContext) {
  const name = block.name;

  if (name === 'VERSE') {
    // One source line is always one visual line -- never reflowed or
    // merged with an adjacent line the way ordinary paragraph text
    // is, matching real org's own defining characteristic of a verse
    // block. Each line gets its own block-level element, which
    // preserves the break naturally without needing white-space: pre
    // at all (unlike the literal SRC/EXAMPLE case, this can still
    // word-wrap a too-long single line, since only the *line breaks
    // between* source lines need preserving here, not the wrapping
    // within one). The hard-line-break marker is stripped but has no
    // extra effect here -- every line already breaks regardless.
    const verse = document.createElement('div');
    verse.style.padding = '4px 12px';
    verse.style.fontStyle = 'italic';
    for (const line of block.lines) {
      const lineEl = document.createElement('div');
      const stripped = stripLineBreakMarker(stripCommaEscapeApp(line));
      if (stripped.trim() === '') {
        lineEl.innerHTML = '&nbsp;'; // a blank verse line is still a real, visible line break, not nothing
      } else {
        renderInlineNodes(parseInline(stripped, currentInlineOpts()), lineEl, linkContext);
      }
      verse.appendChild(lineEl);
    }
    container.appendChild(verse);
    return;
  }

  if (name === 'QUOTE' || name === 'CENTER') {
    const wrap = document.createElement('div');
    if (name === 'QUOTE') {
      // Indented on BOTH the left and right margins, plus a left
      // border -- a conventional blockquote treatment, and the
      // specific thing real org's own manual describes ("indented on
      // both the left and the right margin").
      wrap.style.padding = '4px 16px';
      wrap.style.margin = TABLES_MARGIN;
      wrap.style.borderLeft = '3px solid var(--border)';
      wrap.style.fontStyle = 'italic';
    } else {
      wrap.style.padding = '4px 12px';
      wrap.style.textAlign = 'center';
    }
    // Blank-line-separated paragraphs, each one reflowing its own
    // lines together normally (matching ordinary prose -- the actual
    // distinction from VERSE above) UNLESS a line ends with the
    // hard-line-break marker, which forces a real break at that point
    // instead of just joining into the next line with a space. This
    // is the one place in this app where the marker does something a
    // plain per-line join wouldn't already do on its own.
    let currentParagraphLines = [];
    const flushParagraph = () => {
      if (currentParagraphLines.length === 0) return;
      const p = document.createElement('p');
      p.style.margin = PARAGRAPH_MARGIN; // prose inside a quote: the paragraph value
      const { lines: extractedLines, fragments } = extractLatexFragments(currentParagraphLines);
      const inlineOpts = { ...currentInlineOpts(), latexFragments: fragments };
      extractedLines.forEach((line, i) => {
        if (i > 0) {
          const prevLine = extractedLines[i - 1];
          const prevForcedBreak = stripLineBreakMarker(prevLine) !== prevLine;
          p.appendChild(prevForcedBreak ? document.createElement('br') : document.createTextNode(' '));
        }
        renderInlineNodes(parseInline(stripLineBreakMarker(line), inlineOpts), p, linkContext);
      });
      wrap.appendChild(p);
      currentParagraphLines = [];
    };
    for (const line of block.lines) {
      if (line.trim() === '') {
        flushParagraph();
      } else {
        currentParagraphLines.push(stripCommaEscapeApp(line.trim()));
      }
    }
    flushParagraph();
    container.appendChild(wrap);
    return;
  }

  // SRC, EXAMPLE, or any other/custom name -- literal, verbatim, no
  // markup interpretation, unchanged from before.
  const pre = document.createElement('pre');
  pre.style.margin = TABLES_MARGIN; // follows the spacing setting, so 0 really is 0
  pre.style.padding = '8px';
  pre.style.background = 'var(--surface)';
  pre.style.borderRadius = '6px';
  pre.style.overflowX = 'auto';
  pre.style.fontSize = '13px';
  pre.style.whiteSpace = 'pre-wrap';
  const code = document.createElement('code');
  code.style.fontFamily = 'monospace';
  code.textContent = block.lines.map(stripCommaEscapeApp).join('\n');
  pre.appendChild(code);
  container.appendChild(pre);
}

export function renderBlockRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = TABLES_MARGIN;
  applyKeyboardFocusHighlight(wrap, row);

  const label = row.node.name + (row.node.params ? ' ' + row.node.params : '');

  if (row.heading.drawersHidden) {
    const placeholder = document.createElement('div');
    placeholder.style.cursor = 'pointer';
    placeholder.style.opacity = '0.6';
    placeholder.style.fontStyle = 'italic';
    placeholder.style.fontSize = '13px';
    placeholder.textContent = '\u25b8 ' + label + ' (collapsed block \u2014 tap to reveal)';
    placeholder.onclick = () => {
      row.heading.drawersHidden = false;
      render();
    };
    wrap.appendChild(placeholder);
    return wrap;
  }

  const header = document.createElement('div');
  header.style.fontSize = '11px';
  header.style.opacity = '0.6';
  header.style.fontFamily = 'monospace';
  header.style.cursor = 'pointer';
  header.textContent = '\u25be ' + label;
  header.onclick = () => {
    row.heading.drawersHidden = true;
    render();
  };
  wrap.appendChild(header);

  renderBlockContent(row.node, wrap, null);

  return wrap;
}

/** On a wide layout, Settings/Docs render into #sidePanel instead of
 *  replacing #outline outright — called at the very start of render()
 *  so every existing caller gets this "for free" without individually
 *  needing to know about it. On a narrow layout, this is a complete
 *  no-op: #sidePanel stays hidden, and render()'s own guards below
 *  still fully own #outline exactly as before this feature existed. */
export function syncSidePanel() {
  const wide = isWideLayout();
  if (wide && S.settingsOpen) {
    sidePanelEl.style.display = 'block';
    sidePanelDividerEl.style.display = 'block';
    renderSettingsView(sidePanelEl);
  } else if (wide && S.historyOpen) {
    sidePanelEl.style.display = 'block';
    sidePanelDividerEl.style.display = 'block';
    renderHistoryPanel(sidePanelEl);
  } else {
    sidePanelEl.style.display = 'none';
    sidePanelDividerEl.style.display = 'none';
    sidePanelEl.innerHTML = '';
  }
}

export function setupSidePanelResize() {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  sidePanelDividerEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidePanelEl.getBoundingClientRect().width;
    sidePanelDividerEl.setPointerCapture(e.pointerId);
    sidePanelDividerEl.classList.add('dragging');
    e.preventDefault();
  });

  sidePanelDividerEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = startX - e.clientX; // dragging left grows the panel (it's the right-hand side of the row), dragging right shrinks it
    const rowWidth = splitRowEl.getBoundingClientRect().width;
    const dividerWidth = sidePanelDividerEl.getBoundingClientRect().width;
    const maxWidth = Math.max(SIDE_PANEL_MIN_WIDTH, rowWidth - dividerWidth - SIDE_PANEL_MIN_WIDTH);
    const newWidth = Math.min(maxWidth, Math.max(SIDE_PANEL_MIN_WIDTH, startWidth + delta));
    applySidePanelWidth(newWidth);
  });

  sidePanelDividerEl.addEventListener('pointerup', async (e) => {
    if (!dragging) return;
    dragging = false;
    sidePanelDividerEl.classList.remove('dragging');
    sidePanelDividerEl.releasePointerCapture(e.pointerId);
    await setSidePanelWidth(kv, Math.round(sidePanelEl.getBoundingClientRect().width));
  });
}
