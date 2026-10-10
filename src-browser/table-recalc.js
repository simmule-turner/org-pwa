// Extracted from app.js: table recalc.
import { allTablesInBody, commitLines, serializeTable } from '../src/body-edit.js';
import { getOrgTableDurationHourZeroPadding } from '../src/local-variables.js';
import { parseTableConstants, recalculateTable } from '../src/table-formula.js';
import { S } from './app-state.js';
import { allHeadingsInOrder } from './doc-helpers.js';
import { commitAndRender, setStatus } from './editing.js';
import { tableFunctionsActive, tableUserCall, warmTableFunctions } from './extension-flow.js';
import { render } from './render.js';

/** Recalculates a single table's own #+TBLFM: formulas (if any) and
 *  commits the result, if anything actually changed -- the shared
 *  primitive both the per-table Calc button (renderTableRow, below in
 *  this file) and the whole-document org-table-recalculate-buffer-
 *  tables sweep are built on. Returns 'no-formula' (nothing to do --
 *  the table has no #+TBLFM: at all), 'unchanged' (formulas exist but
 *  every computed value already matched what was there), 'changed'
 *  (committed), or 'error' (a malformed formula or out-of-range
 *  reference -- table.rows is left completely untouched in this case,
 *  see table-formula.js's own recalculateTable for why: the whole
 *  recalculation is abandoned, never partially applied). Callers
 *  decide for themselves how to report each of these -- a single
 *  table's own Calc button and a whole-document sweep reasonably want
 *  different status wording for the same underlying result. */
export function recalculateOneTable(heading, table) {
  if (!table.tblfm || !table.tblfm.trim()) return { result: 'no-formula' };
  try {
    const newRows = recalculateTable(table, {
      hourZeroPad: getOrgTableDurationHourZeroPadding(S.state.localVariables),
      constants: parseTableConstants(S.state.doc),
      userCall: tableUserCall,
    });
    if (!newRows || JSON.stringify(newRows) === JSON.stringify(table.rows)) {
      return { result: 'unchanged' };
    }
    table.rows = newRows;
    commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
    const hasError = newRows.some((row) => (row.cells || []).includes('#ERROR'));
    return { result: 'changed', hasError };
  } catch (err) {
    return { result: 'error', message: err.message };
  }
}

/** org-xx-extra-menu's own 'org-table-recalculate-buffer-tables
 *  function reference -- real org's own actual, distinct command
 *  (org-table-recalculate-buffer-tables, confirmed directly against
 *  the Org Manual: "Recompute all tables in the current buffer" is
 *  its own separate entry, not reachable via any C-c C-c prefix
 *  chain at all -- C-u C-c C-c only recomputes the entire CURRENT
 *  table, "line by line," per the manual's own wording). This app
 *  has no "point"/cursor concept the way Emacs does, so there's no
 *  single-table equivalent to bind here at all -- see renderTableRow
 *  below for the per-table Calc button, which fills that role
 *  instead, matching real org's own actual two-command structure
 *  (a per-table command and a separate, distinct whole-buffer one)
 *  rather than one command escalated by a prefix argument.
 *
 *  Walks every heading top-to-bottom, recalculating every table that
 *  has a #+TBLFM: line via recalculateOneTable above. Within one
 *  heading with more than one such table, tables are re-found BY
 *  POSITION after each individual commit rather than holding onto
 *  object references across commits -- committing one table's own
 *  change re-parses that heading's entire body (see body-edit.js's
 *  own commitLines), which invalidates any OTHER table reference
 *  taken from the stale, pre-commit parse. Pure cell-value changes
 *  never add or remove a row, so re-finding "the Nth table in this
 *  heading" by position after a re-parse still correctly lands on
 *  the same logical table.
 *
 *  A malformed formula in one table is reported and that ONE table is
 *  skipped, rather than aborting recalculation of every other,
 *  correctly-written table in the document -- one typo shouldn't take
 *  out a whole document's worth of otherwise-working formulas. Every
 *  actually-changed table is committed together as a single undo
 *  step, not one per table or per cell. */
export async function recalculateAllTables() {
  if (!S.state.doc) return;
  if (tableFunctionsActive()) {
    const tables = [];
    for (const { heading } of allHeadingsInOrder(S.state.doc)) tables.push(...allTablesInBody(heading));
    setStatus('Asking the script\u2026');
    await warmTableFunctions(tables);
    if (!S.state.doc) return;
  }
  let anyChanged = false;
  const failedHeadingTitles = [];
  const erroredHeadingTitles = [];
  for (const { heading } of allHeadingsInOrder(S.state.doc)) {
    let tableIndex = 0;
    while (true) {
      const tables = allTablesInBody(heading); // freshly re-derived every iteration -- see this function's own docs above for why
      if (tableIndex >= tables.length) break;
      const table = tables[tableIndex];
      const { result, hasError } = recalculateOneTable(heading, table);
      if (result === 'changed') anyChanged = true;
      if (result === 'error') failedHeadingTitles.push(heading.title || '(untitled)');
      if (result === 'changed' && hasError) erroredHeadingTitles.push(heading.title || '(untitled)');
      tableIndex++;
    }
  }

  if (failedHeadingTitles.length > 0) {
    const shown = failedHeadingTitles.slice(0, 3).join(', ');
    const rest = failedHeadingTitles.length > 3 ? `, +${failedHeadingTitles.length - 3} more` : '';
    const noun = failedHeadingTitles.length === 1 ? 'a formula' : 'formulas';
    const verb = failedHeadingTitles.length === 1 ? 'was' : 'were';
    setStatus(`Recalculated tables, but ${noun} under "${shown}${rest}" had an error and ${verb} skipped.`);
  } else if (erroredHeadingTitles.length > 0) {
    const shown = erroredHeadingTitles.slice(0, 3).join(', ');
    const rest = erroredHeadingTitles.length > 3 ? `, +${erroredHeadingTitles.length - 3} more` : '';
    setStatus(`Recalculated all table formulas -- one or more cells under "${shown}${rest}" has #ERROR.`);
  } else if (anyChanged) {
    setStatus('Recalculated all table formulas.');
  } else {
    setStatus('No table formulas to recalculate.');
  }

  if (anyChanged) {
    commitAndRender('Recalculated table formulas');
  } else {
    render();
  }
}
