// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {import('../src/types.js').Doc} Doc */
// Extracted from app.js: general editor.
import { deleteTable, insertTable, lastTableInBody } from '../src/body-edit.js';
import { getPlainTimestampInTitle, setHeadingTags, setPlainTimestampInTitle, setPriority } from '../src/heading-edit.js';
import { S } from './app-state.js';
import { attachmentFiles, openAttachChoicePrompt, performAttachmentAction } from './attachments-flow.js';
import { attachmentsAvailable } from './attachments-store.js';
import { confirmDialog, lockBackgroundScroll, openButtonChoiceModal } from './dialogs.js';
import { commitAndRender } from './editing.js';
import { buildPriorityFieldGroup, buildTimestampFieldGroup } from './field-groups.js';
import { withKeyboardFocusPreserved } from './keyboard-focus.js';
import { keepOverlayInVisibleViewport, menuButton, tableActionButton, textInputStyle, wizardButton } from './ui-widgets.js';
import { aggregateAgendaDocs } from './agenda-files.js';
import { suggestTags, suggestPropertyKeys } from '../src/completion.js';

/** The documents completion draws on: the open one plus every agenda file already loaded. */
function completionDocs() {
  try {
    return aggregateAgendaDocs().map((entry) => entry.doc);
  } catch {
    return [];
  }
}

/** Structured tag editor: existing tags shown as removable chips, plus
 *  an input+button to add a new one. Working state is local to this
 *  group (not committed to `heading` until the general editor's own
 *  Save button reads getTags()) -- same uncommitted-until-Save pattern
 *  buildTimestampFieldGroup already uses, so Cancel genuinely discards
 * @param {Heading} heading
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
  /** @param {any} [raw] */
  const addTag = (raw) => {
    const val = String(raw).trim().replace(/:/g, '');
    if (val && !currentTags.includes(val)) {
      currentTags.push(val);
      addInput.value = '';
      renderChips();
    }
  };
  const addBtn = wizardButton('Add', () => addTag(addInput.value));
  addBtn.style.flex = '0 0 auto';
  addInput.setAttribute('autocapitalize', 'off');
  addInput.setAttribute('autocomplete', 'off');
  addInput.setAttribute('enterkeyhint', 'done');
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(addInput.value);
    }
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

  // Completion: tags already used (most used first) and any declared on a
  // #+TAGS: line, narrowed by what's typed. One tap adds one.
  const docsForCompletion = completionDocs();
  const suggestionsRow = document.createElement('div');
  suggestionsRow.setAttribute('data-tag-suggestions', '');
  suggestionsRow.style.display = 'flex';
  suggestionsRow.style.flexWrap = 'wrap';
  suggestionsRow.style.gap = '6px';
  suggestionsRow.style.marginTop = '8px';
  wrap.appendChild(suggestionsRow);
  function renderSuggestions() {
    suggestionsRow.innerHTML = '';
    for (const tag of suggestTags({ docs: docsForCompletion, applied: currentTags, query: addInput.value })) {
      const chip = document.createElement('button');
      chip.textContent = '+ ' + tag;
      chip.setAttribute('data-tag-suggestion', tag);
      chip.setAttribute('aria-label', 'Add tag ' + tag);
      chip.style.fontSize = '13px';
      chip.style.padding = '5px 10px';
      chip.style.borderRadius = '12px';
      chip.style.border = '1px dashed var(--border-strong)';
      chip.style.background = 'transparent';
      chip.style.color = 'var(--fg)';
      chip.onclick = () => addTag(tag);
      suggestionsRow.appendChild(chip);
    }
  }
  addInput.addEventListener('input', renderSuggestions);

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
    renderSuggestions();
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
 * @param {Heading} heading
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

  const currentProps = heading.propertyOrder.map((/** @type {string} */ key) => ({ key, value: heading.properties[key] ?? '' }));

  // Habit (org-habit): the STYLE property set to habit. It also needs an open TODO state and a repeating SCHEDULED date.
  const habitLabel = document.createElement('label');
  habitLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:14px;';
  const habitBox = document.createElement('input');
  habitBox.type = 'checkbox';
  habitBox.setAttribute('data-habit-switch', '');
  const isHabitRow = (/** @type {any} */ p) => p.key.trim().toLowerCase() === 'style';
  habitBox.checked = currentProps.some((p) => isHabitRow(p) && String(p.value).trim() === 'habit');
  habitBox.onchange = () => {
    const at = currentProps.findIndex(isHabitRow);
    if (habitBox.checked) {
      if (at >= 0) currentProps[at].value = 'habit';
      else currentProps.push({ key: 'STYLE', value: 'habit' });
    } else if (at >= 0 && String(currentProps[at].value).trim() === 'habit') {
      currentProps.splice(at, 1);
    }
    renderRows();
  };
  habitLabel.append(habitBox, document.createTextNode('Habit \u2014 track how consistently this gets done'));
  wrap.appendChild(habitLabel);
  const habitHint = document.createElement('div');
  habitHint.textContent = 'Sets STYLE: habit. A habit also needs an open TODO state and a repeating SCHEDULED date, such as .+2d/4d (Dates tab).';
  habitHint.style.cssText = 'font-size:12px;opacity:0.65;margin-bottom:10px;';
  wrap.appendChild(habitHint);

  const rowsContainer = document.createElement('div');
  wrap.appendChild(rowsContainer);

  // Key completion: keys already used on any heading, then the ones this
  // app itself writes or reads; not the ones this heading already has.
  const keyListId = 'property-keys-' + Math.random().toString(36).slice(2, 8);
  const keyList = document.createElement('datalist');
  keyList.id = keyListId;
  wrap.appendChild(keyList);
  const docsForCompletion = completionDocs();
  function refreshKeyList() {
    keyList.innerHTML = '';
    const current = currentProps.map((/** @type {any} */ p) => p.key).filter(Boolean);
    for (const key of suggestPropertyKeys({ docs: docsForCompletion, applied: current })) {
      const option = document.createElement('option');
      option.value = key;
      keyList.appendChild(option);
    }
  }

  function renderRows() {
    refreshKeyList();
    habitBox.checked = currentProps.some((p) => isHabitRow(p) && String(p.value).trim() === 'habit');
    rowsContainer.innerHTML = '';
    currentProps.forEach((/** @type {any} */ prop, /** @type {number} */ idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.marginBottom = '6px';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      textInputStyle(keyInput);
      keyInput.style.flex = '1 1 40%';
      keyInput.placeholder = 'Key';
      keyInput.setAttribute('list', keyListId);
      keyInput.setAttribute('autocapitalize', 'off');
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
        /** @type {any} */ (properties)[trimmedKey] = value;
      }
      return { properties, propertyOrder };
    },
  };
}

/** The heading-details editor: a modal with five tabs (Dates, Tags, Props, Files, More), so nothing is a long scroll, and
 *  Cancel/Reset/OK pinned underneath. Nothing touches `heading` until OK: each group keeps its own working copy, and Reset
 *  just builds the groups again from the untouched heading. A tab with edits shows a dot, and the footer names the tabs that
 *  changed. Files is the exception to "nothing until OK": an attachment opens or is deleted at once, as everywhere else.
 * @param {Heading} heading */
export function openGeneralEditor(heading) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-overlay';
  overlay.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.classList.add('ui-container');
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.padding = '0';
  modal.style.width = '100%';
  modal.style.maxWidth = '420px';
  modal.style.height = 'min(600px, 100%)';
  modal.style.overscrollBehavior = 'contain';
  modal.style.boxSizing = 'border-box';
  overlay.appendChild(modal);

  const titleBox = document.createElement('div');
  titleBox.style.padding = '16px 18px 10px';
  const titleEl = document.createElement('div');
  titleEl.textContent = 'Edit heading details';
  titleEl.style.fontWeight = '700';
  titleEl.style.fontSize = '15px';
  const subtitleEl = document.createElement('div');
  subtitleEl.textContent = heading.title || '(untitled)';
  subtitleEl.style.fontSize = '13px';
  subtitleEl.style.opacity = '0.7';
  subtitleEl.style.marginTop = '2px';
  subtitleEl.style.whiteSpace = 'nowrap';
  subtitleEl.style.overflow = 'hidden';
  subtitleEl.style.textOverflow = 'ellipsis';
  titleBox.appendChild(titleEl);
  titleBox.appendChild(subtitleEl);
  modal.appendChild(titleBox);

  const tabBar = document.createElement('div');
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', 'Heading details');
  tabBar.style.display = 'flex';
  tabBar.style.gap = '2px';
  tabBar.style.padding = '0 12px';
  tabBar.style.borderBottom = '1px solid var(--border-strong)';
  modal.appendChild(tabBar);

  const fieldsContainer = document.createElement('div');
  fieldsContainer.style.flex = '1 1 auto';
  fieldsContainer.style.minHeight = '0';
  fieldsContainer.style.overflowY = 'auto';
  fieldsContainer.style.padding = '14px 18px';
  fieldsContainer.style.overscrollBehavior = 'contain';
  modal.appendChild(fieldsContainer);

  const TABS = [
    { id: 'dates', label: 'Dates' },
    { id: 'tags', label: 'Tags' },
    { id: 'props', label: 'Props' },
    { id: 'files', label: 'Files' },
    { id: 'more', label: 'More' },
  ];
  /** @type {Record<string, HTMLElement>} */ const panes = {};
  /** @type {Record<string, HTMLButtonElement>} */ const tabButtons = {};
  /** @type {Record<string, HTMLSpanElement>} */ const badges = {};
  /** @type {Record<string, HTMLSpanElement>} */ const dots = {};
  let activeTab = 'dates';
  /** @type {string[] | null} */ let attachmentNames = null;

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-details-tab', tab.id);
    btn.id = 'details-tab-' + tab.id;
    btn.style.border = '0';
    btn.style.background = 'transparent';
    btn.style.color = 'var(--fg)';
    btn.style.padding = '10px 8px';
    btn.style.minHeight = '44px';
    btn.style.fontSize = '13px';
    btn.style.borderBottom = '3px solid transparent';
    btn.style.borderRadius = '0';
    const text = document.createElement('span');
    text.textContent = tab.label;
    const badge = document.createElement('span');
    badge.style.fontSize = '11px';
    badge.style.marginLeft = '4px';
    badge.style.padding = '1px 6px';
    badge.style.borderRadius = '9px';
    badge.style.background = 'var(--surface)';
    badge.style.border = '0.5px solid var(--border-strong)';
    const dot = document.createElement('span');
    dot.textContent = '●';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.color = 'var(--accent)';
    dot.style.fontSize = '10px';
    dot.style.marginLeft = '3px';
    dot.style.visibility = 'hidden';
    btn.append(text, badge, dot);
    btn.onclick = () => selectTab(tab.id);
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const at = TABS.findIndex((t) => t.id === tab.id);
      const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      selectTab(next.id);
      tabButtons[next.id].focus();
    });
    tabBar.appendChild(btn);
    tabButtons[tab.id] = btn;
    badges[tab.id] = badge;
    dots[tab.id] = dot;
    const pane = document.createElement('div');
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', btn.id);
    pane.setAttribute('data-details-pane', tab.id);
    panes[tab.id] = pane;
    fieldsContainer.appendChild(pane);
  }

  function selectTab(/** @type {string} */ id) {
    activeTab = id;
    for (const tab of TABS) {
      const on = tab.id === id;
      panes[tab.id].style.display = on ? 'block' : 'none';
      tabButtons[tab.id].setAttribute('aria-selected', String(on));
      tabButtons[tab.id].tabIndex = on ? 0 : -1;
      tabButtons[tab.id].style.fontWeight = on ? '700' : '400';
      tabButtons[tab.id].style.borderBottomColor = on ? 'var(--accent)' : 'transparent';
    }
  }

  /** @type {any} */ let scheduledGroup;
  /** @type {any} */ let deadlineGroup;
  /** @type {any} */ let plainGroup;
  /** @type {any} */ let tagsGroup;
  /** @type {any} */ let priorityGroup;
  /** @type {any} */ let propsGroup;
  /** @type {Record<string, string> | null} */
  let initialSections = null;

  /** One comparable string per tab, so a tab is "changed" when its string differs from the one taken on entry. */
  function sectionSnapshots() {
    return {
      dates: JSON.stringify([scheduledGroup.getRawValue(), deadlineGroup.getRawValue(), plainGroup.getRawValue()]),
      tags: JSON.stringify(tagsGroup.getTags()),
      props: JSON.stringify(propsGroup.getProperties()),
      more: JSON.stringify(priorityGroup.getPriority()),
    };
  }

  function changedTabs() {
    if (!initialSections) return [];
    const now = /** @type {Record<string, string>} */ (sectionSnapshots());
    return TABS.filter((t) => initialSections && t.id in now && now[t.id] !== initialSections[t.id]);
  }

  function hasPendingChanges() {
    return changedTabs().length > 0;
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

  const changedNote = document.createElement('div');
  changedNote.setAttribute('data-details-changed', '');
  changedNote.setAttribute('aria-live', 'polite');
  changedNote.style.flex = '1 1 auto';
  changedNote.style.fontSize = '12px';
  changedNote.style.alignSelf = 'center';
  changedNote.style.minWidth = '0';
  /** @type {HTMLButtonElement | null} */ let resetBtn = null;

  /** The counts and the change markers: tabs, footer note, and whether Reset has anything to do. */
  function updateIndicators() {
    const count = (/** @type {string | null} */ v) => (v ? 1 : 0);
    badges.dates.textContent = String(count(scheduledGroup.getRawValue()) + count(deadlineGroup.getRawValue()) + count(plainGroup.getRawValue()));
    badges.tags.textContent = String(tagsGroup.getTags().length);
    badges.props.textContent = String(Object.keys(propsGroup.getProperties().properties).length);
    badges.files.textContent = attachmentNames ? String(attachmentNames.length) : '';
    badges.files.style.display = attachmentNames ? '' : 'none';
    badges.more.textContent = '';
    badges.more.style.display = 'none';
    const changed = changedTabs();
    for (const tab of TABS) {
      const on = changed.some((t) => t.id === tab.id);
      dots[tab.id].style.visibility = on ? 'visible' : 'hidden';
      tabButtons[tab.id].setAttribute('data-changed', String(on));
      tabButtons[tab.id].setAttribute('aria-label', tab.label + (badges[tab.id].textContent && badges[tab.id].style.display !== 'none' ? ', ' + badges[tab.id].textContent : '') + (on ? ', changed' : ''));
    }
    changedNote.textContent = changed.length ? 'Changed: ' + changed.map((t) => t.label).join(', ') : '';
    changedNote.style.color = 'var(--accent)';
    if (resetBtn) resetBtn.disabled = changed.length === 0;
  }

  function buildFields() {
    for (const tab of TABS) panes[tab.id].innerHTML = '';
    scheduledGroup = buildTimestampFieldGroup('SCHEDULED', heading.planning.scheduled);
    deadlineGroup = buildTimestampFieldGroup('DEADLINE', heading.planning.deadline);
    plainGroup = buildTimestampFieldGroup('Plain timestamp (not scheduled/deadline)', getPlainTimestampInTitle(heading));
    tagsGroup = buildTagsFieldGroup(heading);
    priorityGroup = buildPriorityFieldGroup(heading);
    propsGroup = buildPropertiesFieldGroup(heading);
    panes.dates.append(scheduledGroup.container, deadlineGroup.container, plainGroup.container);
    panes.tags.appendChild(tagsGroup.container);
    panes.props.appendChild(propsGroup.container);
    panes.more.appendChild(priorityGroup.container);
    panes.more.appendChild(buildTableActions());
    panes.files.appendChild(buildFilesPane());
    initialSections = sectionSnapshots();
    selectTab(activeTab);
    updateIndicators();
  }

  /** The Files tab: the heading's attachments, read from the attachment folder. They are acted on at once, not at OK. */
  function buildFilesPane() {
    const box = document.createElement('div');
    const header = document.createElement('div');
    header.textContent = 'Attached to this heading';
    header.style.fontWeight = '600';
    header.style.fontSize = '14px';
    header.style.marginBottom = '10px';
    box.appendChild(header);
    const list = document.createElement('div');
    list.setAttribute('data-details-files', '');
    box.appendChild(list);
    const note = document.createElement('div');
    note.style.fontSize = '12px';
    note.style.opacity = '0.7';
    note.style.margin = '8px 0';
    note.textContent = 'Opening or deleting a file happens right away, not at OK.';
    box.appendChild(note);
    box.appendChild(
      tableActionButton('+ Attach a file', () => {
        proceedWithAction(() => openAttachChoicePrompt(heading));
      })
    );

    async function refresh() {
      list.innerHTML = '';
      const say = (/** @type {string} */ text) => {
        const line = document.createElement('div');
        line.textContent = text;
        line.style.fontSize = '13px';
        line.style.opacity = '0.75';
        list.appendChild(line);
      };
      if (!attachmentsAvailable()) {
        attachmentNames = null;
        say('Attachments need GitHub or WebDAV connected (or the org-pwa folder on a device that has one).');
        updateIndicators();
        return;
      }
      say('Loading…');
      const names = await attachmentFiles(heading);
      list.innerHTML = '';
      attachmentNames = names;
      if (!names) say("Couldn't read the attachment folder.");
      else if (names.length === 0) say('No attachments yet.');
      else {
        for (const filename of names) {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.padding = '8px 10px';
          row.style.marginBottom = '6px';
          row.style.border = '0.5px solid var(--border-strong)';
          row.style.borderRadius = '8px';
          const name = document.createElement('div');
          name.textContent = filename;
          name.style.flex = '1 1 auto';
          name.style.minWidth = '0';
          name.style.overflowWrap = 'anywhere';
          name.style.fontSize = '14px';
          const open = menuButton('Open', () => performAttachmentAction(heading, filename, 'open'));
          open.style.minHeight = '40px';
          const del = menuButton('✕', async () => {
            await performAttachmentAction(heading, filename, 'delete');
            refresh();
          });
          del.setAttribute('aria-label', 'Delete ' + filename);
          del.style.minWidth = '40px';
          del.style.minHeight = '40px';
          row.append(name, open, del);
          list.appendChild(row);
        }
      }
      updateIndicators();
    }
    refresh();
    return box;
  }

  /** Add table / Delete table: they act at once (on the heading's text), after the usual unsaved-changes prompt. */
  function buildTableActions() {
    const box = document.createElement('div');
    box.style.marginTop = '14px';
    const header = document.createElement('div');
    header.textContent = "Table in this heading's text";
    header.style.fontWeight = '600';
    header.style.fontSize = '14px';
    header.style.marginBottom = '8px';
    box.appendChild(header);
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '8px';
    const existingTable = lastTableInBody(heading);
    row.appendChild(
      tableActionButton('Add table', () => {
        proceedWithAction(() => {
          withKeyboardFocusPreserved(heading, () => insertTable(heading, {}));
          commitAndRender('Added table');
        });
      })
    );
    row.appendChild(
      tableActionButton(
        'Delete table',
        async () => {
          const table = lastTableInBody(heading);
          if (!table) return; // shouldn't happen -- disabled when there's nothing to delete -- but never act on nothing
          if (!(await confirmDialog("Delete this table? This can’t be undone."))) return;
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
    box.appendChild(row);
    return box;
  }

  // Any typing or tapping inside the tabs may have changed something: refresh the markers after the field has updated.
  for (const type of ['input', 'change', 'click', 'keydown']) fieldsContainer.addEventListener(type, () => setTimeout(updateIndicators, 0));

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);

  function close() {
    stopTrackingViewport();
    unlockScroll();
    document.body.removeChild(overlay);
    S.editingGeneral = null;
  }

  /** @param {any} [action] */
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

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.alignItems = 'center';
  footer.style.gap = '8px';
  footer.style.padding = '12px 18px';
  footer.style.borderTop = '1px solid var(--border-strong)';
  footer.appendChild(changedNote);
  modal.appendChild(footer);

  footer.appendChild(menuButton('Cancel', () => close()));
  resetBtn = menuButton('Reset', () => {
    buildFields();
  });
  footer.appendChild(resetBtn);
  footer.appendChild(
    menuButton('OK', () => {
      close();
      applyFieldsToHeading();
      commitAndRender('Edited heading details');
    })
  );

  buildFields();
  document.body.appendChild(overlay);
  return overlay;
}
