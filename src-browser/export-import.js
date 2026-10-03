// Extracted from app.js: export import.
import { exportToAscii } from '../src/export-ascii.js';
import { exportToHtml } from '../src/export-html.js';
import { exportToIcalendar } from '../src/export-icalendar.js';
import { expandIncludes } from '../src/export-include.js';
import { exportToMarkdown } from '../src/export-markdown.js';
import { exportToOdt } from '../src/export-odt.js';
import { exportAsOrg } from '../src/export-org.js';
import { exportToVcard } from '../src/export-vcard.js';
import { importVcardsAsOrgText } from '../src/import-vcard.js';
import { getAsciiTextWidth, getContactsBirthdayProperty, getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { githubAdapter, webdavAdapter } from './adapters.js';
import { aggregateAgendaDocs, aggregateContactsDocs, ensureContactsFilesLoadedAndWait, waitForAgendaFilesLoaded } from './agenda-files.js';
import { S } from './app-state.js';
import { allHeadingsInOrder, headingsInSubtree, vcardBodyHeadingsIn } from './doc-helpers.js';
import { createNewUnsavedDocument, suggestedSaveAsName } from './documents-io.js';
import { morePanel } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter } from './external-sync.js';
import { renderMoreMenu } from './menus.js';
import { render } from './render.js';
import { agendaFilesCache, contactsFilesCache } from './singletons.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, menuButton, menuDivItem } from './ui-widgets.js';
import { platform } from './platform.js';

/** Resolves a raw #+INCLUDE: path (see src/export-include.js's own
 *  docs for the full directive syntax this feeds into) against this
 *  app's own storage. An explicit "github:"/"webdav:" prefix -- the
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
    const doc = await expandIncludes(S.state.doc, resolveIncludePath, parseOrg);
    if (format === 'ascii') {
      platform.saveFile(baseName + '.txt', exportToAscii(doc, scope, getAsciiTextWidth(S.state.localVariables)), 'text/plain');
    } else if (format === 'markdown') {
      platform.saveFile(baseName + '.md', exportToMarkdown(doc, scope), 'text/markdown');
    } else if (format === 'html') {
      platform.saveFile(baseName + '.html', exportToHtml(doc, scope), 'text/html');
    } else {
      platform.saveFile(baseName + '.odt', exportToOdt(doc, scope), 'application/vnd.oasis.opendocument.text');
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
    platform.saveFile(baseName + '.vcf', vcf, 'text/vcard');
  } else {
    const docs = scope === 'agenda-files' ? aggregateAgendaDocs() : [{ documentId: S.state.documentId, doc: S.state.doc }];
    const icsScope = scope && typeof scope === 'object' ? scope : null;
    platform.saveFile(baseName + '.ics', exportToIcalendar(docs, { scope: icsScope }), 'text/calendar');
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
    result = await exportAsOrg(S.state.doc, resolveIncludePath, parseOrg, { minlevel: 1 });
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

export function renderImportFlow() {
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
      row.onclick = () => importVcardFromHeadings(headingsInSubtree(heading), heading.title || '(untitled)');
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
  label.textContent = 'Import Contacts (.vcf) from:';
  morePanel.appendChild(label);

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

  const newBufferRow = document.createElement('label');
  newBufferRow.style.display = 'flex';
  newBufferRow.style.alignItems = 'center';
  newBufferRow.style.gap = '6px';
  newBufferRow.style.fontSize = '13px';
  newBufferRow.style.marginBottom = '10px';
  newBufferRow.style.cursor = 'pointer';
  const newBufferCheckbox = document.createElement('input');
  newBufferCheckbox.type = 'checkbox';
  newBufferCheckbox.checked = S.importVcardToNewBuffer;
  newBufferCheckbox.onchange = () => {
    S.importVcardToNewBuffer = newBufferCheckbox.checked;
  };
  newBufferRow.appendChild(newBufferCheckbox);
  newBufferRow.appendChild(document.createTextNode('To: *new buffer*'));
  morePanel.appendChild(newBufferRow);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.vcf,text/vcard';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    let vcardText;
    try {
      vcardText = await file.text();
    } catch (err) {
      setStatus(`Could not read "${file.name}": ${err.message}`);
      return;
    }
    await importVcardFile(vcardText);
  });
  morePanel.appendChild(fileInput);

  const pickRow = document.createElement('div');
  pickRow.className = 'panel-row';
  pickRow.appendChild(menuButton('Choose vCard file\u2026', () => fileInput.click()));
  morePanel.appendChild(pickRow);

  morePanel.appendChild(
    menuDivItem('Choose a heading\u2026', () => {
      S.importPickingHeading = true;
      renderMoreMenu();
    })
  );
  morePanel.appendChild(
    menuDivItem('This file', () => importVcardFromHeadings(allHeadingsInOrder(S.state.doc), 'this file'))
  );

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
