// Extracted from app.js: general editor.
import { deleteTable, insertTable, lastTableInBody } from '../src/body-edit.js';
import { getPlainTimestampInTitle, setHeadingTags, setPlainTimestampInTitle, setPriority } from '../src/heading-edit.js';
import { S } from './app-state.js';
import { openAttachChoicePrompt } from './attachments-flow.js';
import { confirmDialog, lockBackgroundScroll, openButtonChoiceModal } from './dialogs.js';
import { addBtn } from './dom.js';
import { commitAndRender } from './editing.js';
import { buildPriorityFieldGroup, buildTimestampFieldGroup } from './field-groups.js';
import { withKeyboardFocusPreserved } from './keyboard-focus.js';
import { keepOverlayInVisibleViewport, menuButton, tableActionButton, textInputStyle, wizardButton } from './ui-widgets.js';

/** Structured tag editor: existing tags shown as removable chips, plus
 *  an input+button to add a new one. Working state is local to this
 *  group (not committed to `heading` until the general editor's own
 *  Save button reads getTags()) -- same uncommitted-until-Save pattern
 *  buildTimestampFieldGroup already uses, so Cancel genuinely discards
 *  everything, tags included, not just the timestamp fields. */
export function buildTagsFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Tags';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  let currentTags = [...heading.tags];

  const chipsRow = document.createElement('div');
  chipsRow.style.display = 'flex';
  chipsRow.style.flexWrap = 'wrap';
  chipsRow.style.gap = '6px';
  chipsRow.style.marginBottom = currentTags.length ? '10px' : '0';
  wrap.appendChild(chipsRow);

  const addRow = document.createElement('div');
  addRow.style.display = 'flex';
  addRow.style.gap = '6px';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  textInputStyle(addInput);
  addInput.placeholder = 'New tag';
  const addBtn = wizardButton('Add', () => {
    const val = addInput.value.trim().replace(/:/g, '');
    if (val && !currentTags.includes(val)) {
      currentTags.push(val);
      addInput.value = '';
      renderChips();
    }
  });
  addBtn.style.flex = '0 0 auto';
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

  function renderChips() {
    chipsRow.innerHTML = '';
    chipsRow.style.marginBottom = currentTags.length ? '10px' : '0';
    for (const tag of currentTags) {
      const chip = document.createElement('button');
      chip.textContent = tag + ' \u2715';
      chip.setAttribute('aria-label', 'Remove tag ' + tag);
      chip.style.fontSize = '13px';
      chip.style.padding = '5px 10px';
      chip.style.borderRadius = '12px';
      chip.style.border = '1px solid var(--border-strong)';
      chip.style.background = 'var(--surface)';
      chip.style.color = 'var(--fg)';
      chip.onclick = () => {
        currentTags = currentTags.filter((t) => t !== tag);
        renderChips();
      };
      chipsRow.appendChild(chip);
    }
  }
  renderChips();

  return { container: wrap, getTags: () => currentTags };
}

/** Structured properties editor: each existing property as its own
 *  key/value row (both directly editable, not a raw ":KEY: value" text
 *  block to parse), a per-row remove button, and an "Add property" row
 *  to append a new, initially-blank one. Blank-key rows are silently
 *  dropped on save (getProperties() below) rather than erroring, since
 *  "I tapped Add then changed my mind" is a normal, expected path, not
 *  a mistake to flag. Duplicate keys: the LAST row with a given key
 *  wins (matching a plain object's own last-write-wins semantics),
 *  since this UI doesn't have anywhere to show a "duplicate key"
 *  warning inline the way the raw-text editor's onChange validation
 *  could -- a stated simplification versus that discarded approach. */
export function buildPropertiesFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Properties';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  const currentProps = heading.propertyOrder.map((key) => ({ key, value: heading.properties[key] ?? '' }));

  const rowsContainer = document.createElement('div');
  wrap.appendChild(rowsContainer);

  function renderRows() {
    rowsContainer.innerHTML = '';
    currentProps.forEach((prop, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.marginBottom = '6px';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      textInputStyle(keyInput);
      keyInput.style.flex = '1 1 40%';
      keyInput.placeholder = 'Key';
      keyInput.value = prop.key;
      keyInput.oninput = () => {
        prop.key = keyInput.value;
      };

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      textInputStyle(valueInput);
      valueInput.style.flex = '2 1 60%';
      valueInput.placeholder = 'Value';
      valueInput.value = prop.value;
      valueInput.oninput = () => {
        prop.value = valueInput.value;
      };

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\u2715';
      removeBtn.setAttribute('aria-label', 'Remove property');
      removeBtn.style.flexShrink = '0';
      removeBtn.style.minWidth = '40px';
      removeBtn.style.minHeight = '40px';
      removeBtn.onclick = () => {
        currentProps.splice(idx, 1);
        renderRows();
      };

      row.appendChild(keyInput);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      rowsContainer.appendChild(row);
    });
  }
  renderRows();

  const addBtn = wizardButton('+ Add property', () => {
    currentProps.push({ key: '', value: '' });
    renderRows();
  });
  addBtn.style.marginTop = '4px';
  wrap.appendChild(addBtn);

  return {
    container: wrap,
    getProperties: () => {
      const properties = {};
      const propertyOrder = [];
      for (const { key, value } of currentProps) {
        const trimmedKey = key.trim();
        if (!trimmedKey) continue; // an incomplete "Add property" row the user never filled in -- dropped silently, not an error
        if (!(trimmedKey in properties)) propertyOrder.push(trimmedKey);
        properties[trimmedKey] = value;
      }
      return { properties, propertyOrder };
    },
  };
}

/** The combined SCHEDULED/DEADLINE/plain-timestamp, tags, priority, and
 *  properties editor -- a modal popup with Cancel/Reset/OK, matching
 *  every other multi-field editor in this app. None of the four
 *  buildXxxFieldGroup functions below mutate `heading` at all until
 *  their own getXxx() is explicitly read (see each one's own doc
 *  comment) -- Reset exploits this directly: it just re-runs all four
 *  builders again against the same, still-untouched heading and swaps
 *  the fields container's contents, genuinely restoring the on-entry
 *  values without needing a dedicated reset method built into any of
 *  these four separate, already-complex widgets. */
export function openGeneralEditor(heading) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.background = 'var(--modal-bg)';
  modal.style.color = 'var(--fg)';
  modal.style.border = '1px solid var(--border-strong)';
  modal.style.borderRadius = '10px';
  modal.style.padding = '18px';
  modal.style.width = '100%';
  modal.style.maxWidth = '420px';
  modal.style.maxHeight = '100%';
  modal.style.overflowY = 'auto';
  modal.style.overscrollBehavior = 'contain';
  modal.style.boxSizing = 'border-box';
  overlay.appendChild(modal);

  const titleEl = document.createElement('div');
  titleEl.textContent = 'Edit heading details';
  titleEl.style.fontWeight = '700';
  titleEl.style.fontSize = '15px';
  titleEl.style.marginBottom = '14px';
  modal.appendChild(titleEl);

  const fieldsContainer = document.createElement('div');
  modal.appendChild(fieldsContainer);

  let scheduledGroup, deadlineGroup, plainGroup, tagsGroup, priorityGroup, propsGroup;
  let initialSnapshotJSON = null;

  function snapshotFields() {
    return {
      scheduled: scheduledGroup.getRawValue(),
      deadline: deadlineGroup.getRawValue(),
      plain: plainGroup.getRawValue(),
      tags: tagsGroup.getTags(),
      priority: priorityGroup.getPriority(),
      properties: propsGroup.getProperties(),
    };
  }

  // Compares the fields' own CURRENT output against a snapshot taken
  // right after buildFields() last ran -- both computed by the exact
  // same getRawValue()/getTags()/getPriority()/getProperties()
  // functions, so this compares like with like. Deliberately NOT
  // compared against `heading`'s own raw stored value directly: a
  // timestamp field group re-serializes through formatOrgTimestamp,
  // whose output isn't guaranteed to be byte-identical to whatever's
  // actually stored, which would risk a false "changed" on a field
  // nobody touched.
  //
  // initialSnapshotJSON is deliberately a STRING, stringified the
  // instant it's captured (see buildFields() below) -- NOT the raw
  // object. getTags() returns the SAME mutable array on every call
  // (the tag editor's own Add button does currentTags.push(), an
  // in-place mutation); had this stored the object itself, that one
  // array would still be shared between "initial" and "current" the
  // whole time, so adding a tag would silently mutate both at once
  // and this check could never see a difference. A string, captured
  // immediately, is genuinely frozen at that instant regardless of
  // what happens to the live objects afterward.
  function hasPendingChanges() {
    return JSON.stringify(snapshotFields()) !== initialSnapshotJSON;
  }

  function applyFieldsToHeading() {
    heading.planning = {
      scheduled: scheduledGroup.getRawValue(),
      deadline: deadlineGroup.getRawValue(),
      closed: heading.planning.closed,
    };
    setPlainTimestampInTitle(heading, plainGroup.getRawValue());
    setHeadingTags(heading, tagsGroup.getTags());
    setPriority(heading, priorityGroup.getPriority());
    const { properties, propertyOrder } = propsGroup.getProperties();
    heading.properties = properties;
    heading.propertyOrder = propertyOrder;
  }

  function buildFields() {
    fieldsContainer.innerHTML = '';
    scheduledGroup = buildTimestampFieldGroup('SCHEDULED', heading.planning.scheduled);
    deadlineGroup = buildTimestampFieldGroup('DEADLINE', heading.planning.deadline);
    plainGroup = buildTimestampFieldGroup('Plain timestamp (not scheduled/deadline)', getPlainTimestampInTitle(heading));
    tagsGroup = buildTagsFieldGroup(heading);
    priorityGroup = buildPriorityFieldGroup(heading);
    propsGroup = buildPropertiesFieldGroup(heading);
    fieldsContainer.appendChild(scheduledGroup.container);
    fieldsContainer.appendChild(deadlineGroup.container);
    fieldsContainer.appendChild(plainGroup.container);
    fieldsContainer.appendChild(tagsGroup.container);
    fieldsContainer.appendChild(priorityGroup.container);
    fieldsContainer.appendChild(propsGroup.container);
    initialSnapshotJSON = JSON.stringify(snapshotFields());
  }
  buildFields();

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);

  function close() {
    stopTrackingViewport();
    unlockScroll();
    document.body.removeChild(overlay);
    S.editingGeneral = null;
  }

  // Used by the three immediate-action buttons below (Add table,
  // Delete table, Attach) -- each of those closes this editor and does
  // something else entirely, which used to silently discard any
  // pending field edits (heading was never actually touched until OK).
  // This checks first: if nothing's pending, `action` just runs
  // directly; if something is, a genuine 3-way choice is offered
  // rather than forcing either outcome on the person's behalf.
  async function proceedWithAction(action) {
    if (!hasPendingChanges()) {
      close();
      action();
      return;
    }
    openButtonChoiceModal({
      label: 'This heading has unsaved changes. Commit them before continuing?',
      buttons: [
        {
          text: 'Commit and continue',
          onClick: () => {
            applyFieldsToHeading();
            close();
            commitAndRender('Edited heading details');
            action();
          },
        },
        {
          text: 'Discard and continue',
          onClick: () => {
            close();
            action();
          },
        },
        { text: 'Keep editing', onClick: () => {} },
      ],
    });
  }

  const addTableRow = document.createElement('div');
  addTableRow.style.display = 'flex';
  addTableRow.style.flexWrap = 'wrap';
  addTableRow.style.gap = '8px';
  addTableRow.style.marginBottom = '10px';
  const existingTable = lastTableInBody(heading);
  addTableRow.appendChild(
    tableActionButton('Add table', () => {
      proceedWithAction(() => {
        withKeyboardFocusPreserved(heading, () => insertTable(heading, {}));
        commitAndRender('Added table');
      });
    })
  );
  addTableRow.appendChild(
    tableActionButton(
      'Delete table',
      async () => {
        const table = lastTableInBody(heading);
        if (!table) return; // shouldn't happen -- disabled when there's nothing to delete -- but never act on nothing
        if (!(await confirmDialog("Delete this table? This can\u2019t be undone."))) return;
        proceedWithAction(() => {
          if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'table' && S.keyboardFocusedBodyRow.node === table) {
            S.keyboardFocusedBodyRow = null;
            S.keyboardFocusedCellPos = null;
          }
          deleteTable(heading, table);
          commitAndRender('Deleted table');
        });
      },
      !existingTable
    )
  );
  addTableRow.appendChild(
    tableActionButton('Attach', () => {
      proceedWithAction(() => {
        openAttachChoicePrompt(heading);
      });
    })
  );
  modal.appendChild(addTableRow);

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.justifyContent = 'flex-end';
  btnRow.style.gap = '8px';
  btnRow.style.marginTop = '4px';
  modal.appendChild(btnRow);

  btnRow.appendChild(menuButton('Cancel', () => close()));
  btnRow.appendChild(
    menuButton('Reset', () => {
      buildFields();
    })
  );
  btnRow.appendChild(
    menuButton('OK', () => {
      close();
      applyFieldsToHeading();
      commitAndRender('Edited heading details');
    })
  );

  document.body.appendChild(overlay);
  return overlay;
}
