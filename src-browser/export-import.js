// Extracted from app.js: export import.
import { exportToAscii } from '../src/export-ascii.js';
import { exportToHtml } from '../src/export-html.js';
import { exportToIcalendar } from '../src/export-icalendar.js';
import { prepareBabelExport } from '../src/babel-export.js';
import { expandIncludes } from '../src/export-include.js';
import { exportToMarkdown } from '../src/export-markdown.js';
import { exportToOdt } from '../src/export-odt.js';
import { exportAsOrg } from '../src/export-org.js';
import { exportToVcard } from '../src/export-vcard.js';
import { importIcalendarAsOrgText } from '../src/import-icalendar.js';
import { importVcardsAsOrgText } from '../src/import-vcard.js';
import { getAsciiTextWidth, getContactsBirthdayProperty, getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { aggregateAgendaDocs, aggregateContactsDocs, ensureContactsFilesLoadedAndWait, loadContactsDocsForSync, waitForAgendaFilesLoaded } from './agenda-files.js';
import { exportAgendaToIcalendar } from '../src/calendar-from-agenda.js';
import { S } from './app-state.js';
import { allHeadingsInOrder, headingsInSubtree, icalendarBodyHeadingsIn, vcardBodyHeadingsIn } from './doc-helpers.js';
import { createNewUnsavedDocument, suggestedSaveAsName } from './documents-io.js';
import { morePanel } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter } from './external-sync.js';
import { renderMoreMenu } from './menus.js';
import { render } from './render.js';
import { agendaFilesCache, contactsFilesCache } from './singletons.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, menuButton, menuDivItem } from './ui-widgets.js';
import { platform } from './platform.js';
import { saveOut } from './save-out.js';

/** Resolves a raw #+INCLUDE: path (see src/export-include.js's own
 *  docs for the full directive syntax this feeds into) against this
 *  app's own storage. An explicit "github:"/"webdav:"/"local:" prefix -- the
 *  same scheme:path convention org-agenda-files/org-refile-targets
 *  already use -- reads from that specific adapter regardless of
 *  what's currently open; a bare path instead resolves against the
 *  CURRENTLY OPEN document's own storage, the closest equivalent this
 *  app's own storage model has to real org's own "relative to the
 *  current file" behavior. Returns null (not a throw) for anything
 *  unresolvable -- expandIncludes itself already treats that as "skip
 *  this one include," not a reason to fail the whole export. */
export async function resolveIncludePath(path) {
  const colonIndex = path.indexOf(':');
  const scheme = colonIndex === -1 ? null : path.slice(0, colonIndex);
  if (scheme === 'github') return githubAdapter.read(path.slice(colonIndex + 1));
  if (scheme === 'webdav') return webdavAdapter.read(path.slice(colonIndex + 1));
  if (scheme === 'local') return filesystemAdapter.read(path.slice(colonIndex + 1)); // opened here earlier, or in the org-pwa folder
  return activeDiskAdapter().read(path);
}

/** Generates the export text for `format`/`scope` and triggers a
 *  download -- the actual terminal step of the export flow, closing
 *  the file menu and resetting its state back to the top level once
 *  done. */
export async function performExport(format, scope) {
  const rawName = scope && typeof scope === 'object' ? scope.title : suggestedSaveAsName('export').replace(/\.[a-zA-Z0-9]+$/, '');
  const baseName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  if (format === 'ascii' || format === 'markdown' || format === 'html' || format === 'odt') {
    const doc = prepareBabelExport(await expandIncludes(S.state.doc, resolveIncludePath, parseOrg));
    if (format === 'ascii') {
      saveOut(baseName + '.txt', exportToAscii(doc, scope, getAsciiTextWidth(S.state.localVariables)), 'text/plain');
    } else if (format === 'markdown') {
      saveOut(baseName + '.md', exportToMarkdown(doc, scope), 'text/markdown');
    } else if (format === 'html') {
      saveOut(baseName + '.html', exportToHtml(doc, scope), 'text/html');
    } else {
      saveOut(baseName + '.odt', exportToOdt(doc, scope), 'application/vnd.oasis.opendocument.text');
    }
  } else if (format === 'vcard') {
    const docs = scope === 'contacts-files' ? aggregateContactsDocs() : [{ documentId: S.state.documentId, doc: S.state.doc }];
    let vcardScope;
    if (scope && typeof scope === 'object') {
      vcardScope = scope; // "Choose a heading" -- an explicit, single-heading scope, unaffected by narrow state
    } else if (scope === null && S.narrowedHeading) {
      vcardScope = S.narrowedHeading; // "This file" while subtree-narrowed -- respect it rather than exporting the whole file behind it
    } else if (scope === null && S.sparseNarrowScope) {
      vcardScope = Array.from(S.sparseNarrowScope.matched); // "This file" while Search's own Narrow is active -- respect exactly those matches
    } else {
      vcardScope = null; // no narrow restriction active -- the whole file (or, for "This file + Contacts Files", every aggregated document)
    }
    let vcf;
    try {
      vcf = exportToVcard(docs, {
        scope: vcardScope,
        birthdayProperty: getContactsBirthdayProperty(S.state.localVariables),
        style: S.vcardStyle,
      });
    } catch (err) {
      setStatus(err.message);
      renderMoreMenu();
      return;
    }
    if (S.exportVcardToNewBuffer) {
      const count = (vcf.match(/^BEGIN:VCARD/gim) || []).length;
      const rawText = `#+TITLE: *scratch*\n* vCard(s)\n${vcf.replace(/\r\n/g, '\n')}`;
      S.moreOpen = false;
      S.moreMenuStep = null;
      S.exportFormat = null;
      S.exportPickingHeading = false;
      await createNewUnsavedDocument(rawText, `Exported ${count} contact${count === 1 ? '' : 's'} to Contacts (.vcf) in a new buffer.`);
      renderMoreMenu();
      return;
    }
    saveOut(baseName + '.vcf', vcf, 'text/vcard');
  } else {
    const birthdayProperty = getContactsBirthdayProperty(S.state.localVariables);
    if (scope === 'agenda') {
      // what View > Agenda shows, in the window the CalDAV mirror uses (see calendar-from-agenda.js)
      const agendaDocs = aggregateAgendaDocs().filter((d) => d.doc);
      saveOut(baseName + '.ics', exportAgendaToIcalendar(agendaDocs, { birthdayProperty, contactsDocs: await loadContactsDocsForSync(agendaDocs) }), 'text/calendar');
    } else {
      const docs = scope === 'agenda-files' ? aggregateAgendaDocs() : [{ documentId: S.state.documentId, doc: S.state.doc }];
      const icsScope = scope && typeof scope === 'object' ? scope : null;
      // for the agenda files, the contacts are those of org-contacts-files, as in the agenda
      const contactsDocs = scope === 'agenda-files' ? await loadContactsDocsForSync(docs.filter((d) => d.doc)) : null;
      saveOut(baseName + '.ics', exportToIcalendar(docs, { scope: icsScope, birthdayProperty, contactsDocs }), 'text/calendar');
    }
  }
  S.moreOpen = false;
  S.moreMenuStep = null;
  S.exportFormat = null;
  S.exportPickingHeading = false;
  setStatus(
    `Exported to ${format === 'ascii' ? 'ASCII' : format === 'markdown' ? 'Markdown' : format === 'html' ? 'HTML' : format === 'odt' ? 'ODT' : format === 'vcard' ? 'Contacts (.vcf)' : 'Calendar (.ics)'}.`
  );
  renderMoreMenu();
  render();
}

/** The shared implementation behind both the Export menu's own
 *  "As-org" entry and the org-xx-extra-menu's own
 *  'org-org-export-as-org function reference -- neither duplicates
 *  the other's own logic. See src/export-org.js's own top-level doc
 *  comment for exactly which of real org-mode's own documented steps
 *  this actually performs (and the one it deliberately can't: code-
 *  block execution). Operates on the whole current document, not a
 *  narrowed subtree -- this command's own real, documented behavior
 *  never mentions scoping, reading as "process my current working
 *  file" rather than a view-level narrow's own separate concern.
 *  Opens the result in a brand-new, unsaved buffer (reusing
 *  createNewUnsavedDocument, the same primitive vCard's own "To: *new
 *  buffer*" already uses) titled "*Org ORG Export*" -- the ORIGINAL
 *  document is never touched at all, matching real org's own actual
 *  behavior exactly ("your original working file remains completely
 *  untouched"). */
export async function performOrgOrgExport() {
  if (!S.state.doc) return;
  setStatus('Exporting\u2026');
  let result;
  try {
    result = await exportAsOrg(prepareBabelExport(S.state.doc), resolveIncludePath, parseOrg, { minlevel: 1 });
  } catch (err) {
    setStatus(`Couldn't export: ${err.message}`);
    render();
    return;
  }
  const serialized = serializeOrg(result)
    .split('\n')
    .filter((line) => !/^\s*#\+TITLE:/i.test(line))
    .join('\n');
  const rawText = '#+TITLE: *Org ORG Export*\n' + serialized;
  await createNewUnsavedDocument(rawText, 'Exported to *Org ORG Export* in a new buffer \u2014 your original document is untouched.');
}

export function renderExportFlow() {
  if (S.exportFormat === null) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Export as:';
    morePanel.appendChild(label);

    const exportMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).export;
    const asciiBtn = aliasedMenuDivItem(exportMenuAliases, 'ASCII', () => {
      S.exportFormat = 'ascii';
      renderMoreMenu();
    });
    const icsBtn = aliasedMenuDivItem(exportMenuAliases, 'Calendar (.ics)', () => {
      S.exportFormat = 'icalendar';
      renderMoreMenu();
    });
    const vcardBtn = aliasedMenuDivItem(exportMenuAliases, 'Contacts (.vcf)', () => {
      S.exportFormat = 'vcard';
      renderMoreMenu();
    });
    const htmlBtn = aliasedMenuDivItem(exportMenuAliases, 'HTML', () => {
      S.exportFormat = 'html';
      renderMoreMenu();
    });
    const mdBtn = aliasedMenuDivItem(exportMenuAliases, 'Markdown', () => {
      S.exportFormat = 'markdown';
      renderMoreMenu();
    });
    const odtBtn = aliasedMenuDivItem(exportMenuAliases, 'ODT', () => {
      S.exportFormat = 'odt';
      renderMoreMenu();
    });
    const orgexportBtn = aliasedMenuDivItem(exportMenuAliases, 'As-org', async () => {
      S.moreOpen = false;
      S.moreMenuStep = null;
      S.exportFormat = null;
      renderMoreMenu();
      await performOrgOrgExport();
      renderMoreMenu();
    });
    appendMenuButtonsInOrder(morePanel, exportMenuAliases, [
      { label: 'ASCII', btn: asciiBtn },
      { label: 'As-org', btn: orgexportBtn },
      { label: 'Calendar (.ics)', btn: icsBtn },
      { label: 'Contacts (.vcf)', btn: vcardBtn },
      { label: 'HTML', btn: htmlBtn },
      { label: 'Markdown', btn: mdBtn },
      { label: 'ODT', btn: odtBtn },
    ]);
    const backRow = document.createElement('div');
    backRow.className = 'panel-row';
    backRow.style.marginTop = '6px';
    backRow.appendChild(
      menuButton('\u2039 Back', () => {
        S.moreMenuStep = null;
        renderMoreMenu();
      })
    );
    morePanel.appendChild(backRow);
    return;
  }

  if ((S.exportFormat === 'icalendar' || S.exportFormat === 'vcard') && !S.exportPickingHeading) {
    const isVcard = S.exportFormat === 'vcard';

    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = `Export ${isVcard ? 'Contacts (.vcf)' : 'Calendar (.ics)'} for:`;
    morePanel.appendChild(label);

    if (isVcard) {
      const styleRow = document.createElement('div');
      styleRow.style.display = 'flex';
      styleRow.style.border = '1px solid var(--border-strong)';
      styleRow.style.borderRadius = '8px';
      styleRow.style.overflow = 'hidden';
      styleRow.style.marginBottom = '8px';
      for (const [value, text] of [
        ['flat', 'Flat'],
        ['tree', 'Tree'],
      ]) {
        const styleBtn = document.createElement('button');
        styleBtn.textContent = text;
        styleBtn.style.flex = '1';
        styleBtn.style.border = 'none';
        styleBtn.style.borderLeft = value === 'tree' ? '1px solid var(--border-strong)' : 'none';
        styleBtn.style.padding = '8px 4px';
        styleBtn.style.fontSize = '13px';
        styleBtn.style.background = S.vcardStyle === value ? 'var(--fill-ghost-selected, rgba(127,127,127,0.15))' : 'transparent';
        styleBtn.style.color = 'var(--fg)';
        styleBtn.onclick = () => {
          S.vcardStyle = value;
          renderMoreMenu();
        };
        styleRow.appendChild(styleBtn);
      }
      morePanel.appendChild(styleRow);

      const newBufferRow = document.createElement('label');
      newBufferRow.style.display = 'flex';
      newBufferRow.style.alignItems = 'center';
      newBufferRow.style.gap = '6px';
      newBufferRow.style.fontSize = '13px';
      newBufferRow.style.marginBottom = '10px';
      newBufferRow.style.cursor = 'pointer';
      const newBufferCheckbox = document.createElement('input');
      newBufferCheckbox.type = 'checkbox';
      newBufferCheckbox.checked = S.exportVcardToNewBuffer;
      newBufferCheckbox.onchange = () => {
        S.exportVcardToNewBuffer = newBufferCheckbox.checked;
      };
      newBufferRow.appendChild(newBufferCheckbox);
      newBufferRow.appendChild(document.createTextNode('To: *new buffer*'));
      morePanel.appendChild(newBufferRow);

      const narrowStatus = S.narrowedHeading || S.sparseNarrowScope ? document.createElement('div') : null;
      if (narrowStatus) {
        narrowStatus.style.fontSize = '12px';
        narrowStatus.style.opacity = '0.7';
        narrowStatus.style.marginBottom = '8px';
        narrowStatus.textContent = S.narrowedHeading
          ? `"This file" will export just "${S.narrowedHeading.title || '(untitled)'}" \u2014 the outline is currently narrowed to it.`
          : `"This file" will export just the ${S.sparseNarrowScope.matched.size} heading${S.sparseNarrowScope.matched.size === 1 ? '' : 's'} currently narrowed to via Search.`;
        morePanel.appendChild(narrowStatus);
      }
    }

    morePanel.appendChild(
      menuDivItem('Choose a heading\u2026', () => {
        S.exportPickingHeading = true;
        renderMoreMenu();
      })
    );
    morePanel.appendChild(menuDivItem('This file', () => performExport(S.exportFormat, null)));
    if (isVcard ? S.contactsFilesConfig.length > 0 : S.agendaFilesConfig.length > 0) {
      morePanel.appendChild(
        menuDivItem(`This file + ${isVcard ? 'Contacts Files' : 'Agenda Files'}`, async () => {
          setStatus(`Loading ${isVcard ? 'contacts' : 'agenda'} files\u2026`);
          if (isVcard) {
            contactsFilesCache.clear();
            S.contactsFilesCacheLoadedFor = null;
            await ensureContactsFilesLoadedAndWait();
          } else {
            agendaFilesCache.clear();
            S.agendaFilesCacheLoadedFor = null;
            await waitForAgendaFilesLoaded();
          }
          await performExport(S.exportFormat, isVcard ? 'contacts-files' : 'agenda-files');
        })
      );
    }
    if (!isVcard) {
      // what View > Agenda shows, as events (the rows above write every dated item of a file or heading, with no window)
      morePanel.appendChild(
        menuDivItem('Agenda (as displayed)', async () => {
          setStatus('Loading agenda files\u2026');
          await waitForAgendaFilesLoaded();
          await performExport(S.exportFormat, 'agenda');
        })
      );
    }

    const backRow = document.createElement('div');
    backRow.className = 'panel-row';
    backRow.style.marginTop = '6px';
    backRow.appendChild(
      menuButton('\u2039 Back', () => {
        S.exportFormat = null;
        renderMoreMenu();
      })
    );
    morePanel.appendChild(backRow);
    return;
  }

  if (S.exportPickingHeading) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Choose a heading:';
    morePanel.appendChild(label);

    const list = document.createElement('div');
    list.style.maxHeight = '260px';
    list.style.overflowY = 'auto';
    list.style.overscrollBehavior = 'contain';
    // For Tree-style vCard export specifically, only real contacts (a
    // :KIND: property set) are worth listing -- their own
    // sub-headings (email/phone/address entries) aren't independently
    // exportable as a vCard at all, and including them meant
    // scrolling through hundreds of irrelevant rows to find an actual
    // contact. Flat style never sets :KIND: at all (a flat contact is
    // one heading with EMAIL/PHONE/ADDRESS as plain properties, not
    // separate sub-headings), so it has no real sub-heading pollution
    // to filter out in the first place -- every heading is already a
    // potential top-level contact, so it keeps the unfiltered list.
    // Every other export format (HTML, Markdown, iCalendar, etc.)
    // also keeps the unfiltered list, since any heading is a
    // legitimate target for those.
    const isTreeVcard = S.exportFormat === 'vcard' && S.vcardStyle === 'tree';
    const allHeadings = allHeadingsInOrder(S.state.doc);
    const headings = isTreeVcard ? allHeadings.filter(({ heading }) => heading.properties.KIND) : allHeadings;
    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.6';
      empty.style.padding = '8px 0';
      empty.textContent = isTreeVcard ? 'This file has no contacts yet.' : 'This file has no headings yet.';
      list.appendChild(empty);
    }
    for (const { heading, depth } of headings) {
      const row = document.createElement('div');
      row.className = 'menu-list-item';
      row.style.paddingLeft = 14 + (isTreeVcard ? 0 : depth * 16) + 'px'; // Tree vCard's own list is already flat (contacts only, no real hierarchy to indent)
      row.textContent = heading.title || '(untitled)';
      row.onclick = () => performExport(S.exportFormat, heading);
      list.appendChild(row);
    }
    morePanel.appendChild(list);

    const backRow = document.createElement('div');
    backRow.className = 'panel-row';
    backRow.style.marginTop = '6px';
    backRow.appendChild(
      menuButton('\u2039 Back', () => {
        S.exportPickingHeading = false;
        renderMoreMenu();
      })
    );
    morePanel.appendChild(backRow);
    return;
  }

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = `Export ${S.exportFormat === 'ascii' ? 'ASCII' : S.exportFormat === 'markdown' ? 'Markdown' : S.exportFormat === 'html' ? 'HTML' : S.exportFormat === 'odt' ? 'ODT' : 'Calendar (.ics)'} for:`;
  morePanel.appendChild(label);

  morePanel.appendChild(
    menuDivItem('Choose a heading\u2026', () => {
      S.exportPickingHeading = true;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(menuDivItem('This file', () => performExport(S.exportFormat, null)));

  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Back', () => {
      S.exportFormat = null;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(backRow);
}

/** Contacts (.vcf) import's own options: the Flat or Tree style the contacts are written in, and cleaning up Google's and Apple's own
 *  non-standard vCard quirks. (iCalendar has neither.) */
function appendVcardImportOptions() {
  const styleRow = document.createElement('div');
  styleRow.style.display = 'flex';
  styleRow.style.border = '1px solid var(--border-strong)';
  styleRow.style.borderRadius = '8px';
  styleRow.style.overflow = 'hidden';
  styleRow.style.marginBottom = '8px';
  for (const [value, text] of [
    ['flat', 'Flat'],
    ['tree', 'Tree'],
  ]) {
    const styleBtn = document.createElement('button');
    styleBtn.textContent = text;
    styleBtn.style.flex = '1';
    styleBtn.style.border = 'none';
    styleBtn.style.borderLeft = value === 'tree' ? '1px solid var(--border-strong)' : 'none';
    styleBtn.style.padding = '8px 4px';
    styleBtn.style.fontSize = '13px';
    styleBtn.style.background = S.importStyle === value ? 'var(--fill-ghost-selected, rgba(127,127,127,0.15))' : 'transparent';
    styleBtn.style.color = 'var(--fg)';
    styleBtn.onclick = () => {
      S.importStyle = value;
      renderMoreMenu();
    };
    styleRow.appendChild(styleBtn);
  }
  morePanel.appendChild(styleRow);

  const cleanRow = document.createElement('label');
  cleanRow.style.display = 'flex';
  cleanRow.style.alignItems = 'center';
  cleanRow.style.gap = '6px';
  cleanRow.style.fontSize = '13px';
  cleanRow.style.marginBottom = '6px';
  cleanRow.style.cursor = 'pointer';
  const cleanCheckbox = document.createElement('input');
  cleanCheckbox.type = 'checkbox';
  cleanCheckbox.checked = S.importCleanMode;
  cleanCheckbox.onchange = () => {
    S.importCleanMode = cleanCheckbox.checked;
  };
  cleanRow.appendChild(cleanCheckbox);
  cleanRow.appendChild(document.createTextNode('Clean data (Google, Apple)'));
  morePanel.appendChild(cleanRow);
}

// What differs between the formats the Import menu reads. The panel, the heading picker and where the result goes are the same.
const IMPORT_FORMATS = {
  vcard: {
    heading: 'Import Contacts (.vcf) from:',
    accept: '.vcf,text/vcard',
    chooseLabel: 'Choose vCard file\u2026',
    newBufferField: 'importVcardToNewBuffer',
    importText: (text) => importVcardFile(text),
    importHeadings: (headings, sourceLabel) => importVcardFromHeadings(headings, sourceLabel),
  },
  icalendar: {
    heading: 'Import iCalendar (.ics) from:',
    accept: '.ics,text/calendar',
    chooseLabel: 'Choose iCalendar file\u2026',
    newBufferField: 'importIcalendarToNewBuffer',
    importText: (text) => importIcalendarFile(text),
    importHeadings: (headings, sourceLabel) => importIcalendarFromHeadings(headings, sourceLabel),
  },
};

/** More > Import: the formats it reads, as a list, the way Export lists its own. */
function renderImportList() {
  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = 'Import:';
  morePanel.appendChild(label);

  const importMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).import;
  const vcardBtn = aliasedMenuDivItem(importMenuAliases, 'Contacts (.vcf)', () => {
    S.importFormat = 'vcard';
    renderMoreMenu();
  });
  const icsBtn = aliasedMenuDivItem(importMenuAliases, 'iCalendar (.ics)', () => {
    S.importFormat = 'icalendar';
    renderMoreMenu();
  });
  appendMenuButtonsInOrder(morePanel, importMenuAliases, [
    { label: 'Contacts (.vcf)', btn: vcardBtn },
    { label: 'iCalendar (.ics)', btn: icsBtn },
  ]);
  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Back', () => {
      S.moreMenuStep = null;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(backRow);
}

export function renderImportFlow() {
  const format = IMPORT_FORMATS[S.importFormat];
  if (!format) {
    renderImportList();
    return;
  }
  if (S.importPickingHeading) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Choose a heading:';
    morePanel.appendChild(label);

    const list = document.createElement('div');
    list.style.maxHeight = '260px';
    list.style.overflowY = 'auto';
    list.style.overscrollBehavior = 'contain';
    const headings = allHeadingsInOrder(S.state.doc);
    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.6';
      empty.style.padding = '8px 0';
      empty.textContent = 'This file has no headings yet.';
      list.appendChild(empty);
    }
    for (const { heading, depth } of headings) {
      const row = document.createElement('div');
      row.className = 'menu-list-item';
      row.style.paddingLeft = 14 + depth * 16 + 'px';
      row.textContent = heading.title || '(untitled)';
      row.onclick = () => format.importHeadings(headingsInSubtree(heading), heading.title || '(untitled)');
      list.appendChild(row);
    }
    morePanel.appendChild(list);

    const backRow = document.createElement('div');
    backRow.className = 'panel-row';
    backRow.style.marginTop = '6px';
    backRow.appendChild(
      menuButton('\u2039 Back', () => {
        S.importPickingHeading = false;
        renderMoreMenu();
      })
    );
    morePanel.appendChild(backRow);
    return;
  }

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = format.heading;
  morePanel.appendChild(label);

  if (S.importFormat === 'vcard') appendVcardImportOptions();

  const newBufferRow = document.createElement('label');
  newBufferRow.style.display = 'flex';
  newBufferRow.style.alignItems = 'center';
  newBufferRow.style.gap = '6px';
  newBufferRow.style.fontSize = '13px';
  newBufferRow.style.marginBottom = '10px';
  newBufferRow.style.cursor = 'pointer';
  const newBufferCheckbox = document.createElement('input');
  newBufferCheckbox.type = 'checkbox';
  newBufferCheckbox.checked = S[format.newBufferField];
  newBufferCheckbox.onchange = () => {
    S[format.newBufferField] = newBufferCheckbox.checked;
  };
  newBufferRow.appendChild(newBufferCheckbox);
  newBufferRow.appendChild(document.createTextNode('To: *new buffer*'));
  morePanel.appendChild(newBufferRow);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = format.accept;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    let fileText;
    try {
      fileText = await file.text();
    } catch (err) {
      setStatus(`Could not read "${file.name}": ${err.message}`);
      return;
    }
    await format.importText(fileText);
  });
  morePanel.appendChild(fileInput);

  const pickRow = document.createElement('div');
  pickRow.className = 'panel-row';
  pickRow.appendChild(menuButton(format.chooseLabel, () => fileInput.click()));
  morePanel.appendChild(pickRow);

  morePanel.appendChild(
    menuDivItem('Choose a heading\u2026', () => {
      S.importPickingHeading = true;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(
    menuDivItem('This file', () => format.importHeadings(allHeadingsInOrder(S.state.doc), 'this file'))
  );

  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Back', () => {
      S.importFormat = null;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(backRow);
}

/** Parses `vcardText` (one or more VCARD blocks) via importVcardsAsOrgText
 *  (the currently-selected importStyle), then appends the resulting
 *  headings as new top-level headings at the end of the current
 *  document -- the simplest, least-surprising placement, since it
 *  doesn't require a specific heading to already be focused and never
 *  risks overwriting anything already in the file. A file with no
 *  valid (FN-bearing) contacts produces a clear status message rather
 *  than silently doing nothing. */
export async function importVcardFromHeadings(headings, sourceLabel) {
  const bodies = vcardBodyHeadingsIn(headings);
  if (bodies.length === 0) {
    setStatus(`No vCard data found in ${sourceLabel} \u2014 looking for a heading whose own body starts with "BEGIN:VCARD".`);
    return;
  }
  await importVcardFile(bodies.join('\n'));
}

export async function importVcardFile(vcardText) {
  const unmappedProperties = [];
  let embeddedPhotoCount = 0;
  const orgText = importVcardsAsOrgText(vcardText, {
    style: S.importStyle,
    cleanMode: S.importCleanMode,
    onUnmappedProperty: (name) => unmappedProperties.push(name),
    onEmbeddedPhotoImported: () => embeddedPhotoCount++,
  });
  if (!orgText) {
    setStatus('No valid contacts found in that file \u2014 each vCard needs at least a name (FN) to import.');
    return;
  }
  const parsed = parseOrg(orgText);
  const importedHeadings = parsed.children;
  const count = importedHeadings.length;
  const warning = unmappedProperties.length
    ? ` ${unmappedProperties.length} unrecognized propert${unmappedProperties.length === 1 ? 'y was' : 'ies were'} skipped: ${unmappedProperties.join(', ')}.`
    : '';
  const photoNote = embeddedPhotoCount ? ` ${embeddedPhotoCount} embedded photo${embeddedPhotoCount === 1 ? '' : 's'} imported.` : '';
  S.moreOpen = false;
  S.moreMenuStep = null;
  S.importFormat = null;
  S.importPickingHeading = false;
  if (S.importVcardToNewBuffer) {
    renderMoreMenu();
    await createNewUnsavedDocument(orgText, `Imported ${count} contact${count === 1 ? '' : 's'} from vCard in a new buffer.${warning}${photoNote}`);
    return;
  }
  S.state.doc.children.push(...importedHeadings);
  renderMoreMenu();
  commitAndRender(`Imported ${count} contact${count === 1 ? '' : 's'} from vCard`);
  setStatus(`Imported ${count} contact${count === 1 ? '' : 's'} from vCard.${warning}${photoNote}`);
}

/** The iCalendar twin of importVcardFromHeadings: reads the iCalendar text found in the bodies of `headings` (a heading whose own
 *  body starts with "BEGIN:VCALENDAR", as Export > Calendar (.ics) > To: *new buffer* leaves it). */
export async function importIcalendarFromHeadings(headings, sourceLabel) {
  const bodies = icalendarBodyHeadingsIn(headings);
  if (bodies.length === 0) {
    setStatus(`No iCalendar data found in ${sourceLabel} \u2014 looking for a heading whose own body starts with "BEGIN:VCALENDAR".`);
    return;
  }
  await importIcalendarFile(bodies.join('\n'));
}

/** Parses `icsText` via importIcalendarAsOrgText, then places the headings exactly as importVcardFile does: appended as new
 *  top-level headings at the end of the open document (nothing already there is touched), or, with "To: *new buffer*", in a new
 *  unsaved one. Times are shown in this device's own time zone. Says what was not carried over, as the vCard import does. */
export async function importIcalendarFile(icsText) {
  const unmappedProperties = [];
  const keptRecurrences = [];
  const unknownZones = [];
  const { orgText, eventCount, todoCount } = importIcalendarAsOrgText(icsText, {
    onUnmappedProperty: (name) => {
      if (!unmappedProperties.includes(name)) unmappedProperties.push(name);
    },
    onRecurrenceKept: (summary) => keptRecurrences.push(summary),
    onUnknownTimeZone: (name) => {
      if (!unknownZones.includes(name)) unknownZones.push(name);
    },
  });
  if (!orgText) {
    setStatus('No events or tasks found in that file \u2014 each needs a start (DTSTART) to import, or to be a task (VTODO).');
    return;
  }
  const importedHeadings = parseOrg(orgText).children;
  const what = [eventCount ? `${eventCount} event${eventCount === 1 ? '' : 's'}` : '', todoCount ? `${todoCount} task${todoCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const notes = [];
  if (unmappedProperties.length) notes.push(`${unmappedProperties.length} unrecognized propert${unmappedProperties.length === 1 ? 'y was' : 'ies were'} skipped: ${unmappedProperties.join(', ')}.`);
  if (keptRecurrences.length) notes.push(`${keptRecurrences.length} recurring event${keptRecurrences.length === 1 ? '' : 's'} could not become a repeater (an end date, several weekdays, ...) and ${keptRecurrences.length === 1 ? 'was' : 'were'} imported once, with the rule in an :RRULE: property.`);
  if (unknownZones.length) notes.push(`Times in an unknown time zone (${unknownZones.join(', ')}) were kept as written.`);
  const warning = notes.length ? ` ${notes.join(' ')}` : '';
  S.moreOpen = false;
  S.moreMenuStep = null;
  S.importFormat = null;
  S.importPickingHeading = false;
  if (S.importIcalendarToNewBuffer) {
    renderMoreMenu();
    await createNewUnsavedDocument(orgText, `Imported ${what} from iCalendar in a new buffer.${warning}`);
    return;
  }
  S.state.doc.children.push(...importedHeadings);
  renderMoreMenu();
  commitAndRender(`Imported ${what} from iCalendar`);
  setStatus(`Imported ${what} from iCalendar.${warning}`);
}
