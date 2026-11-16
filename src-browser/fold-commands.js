// @ts-check
/** The visibility commands that work on a parsed document, whichever screen asked: S-TAB's overview / show all toggle. */
import { applyStartupVisibility } from '../src/fold-state.js';
import { getCycleOpenArchivedTrees } from '../src/local-variables.js';
import { S } from './app-state.js';

/** S-TAB (`org-global-cycle`): overview, then everything. @param {import('../src/types.js').Doc} doc @returns {string} the visibility it left */
export function cycleGlobalFolds(doc) {
  const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
  S.lastGlobalFoldState = S.lastGlobalFoldState === 'overview' ? 'showeverything' : 'overview';
  applyStartupVisibility(doc, { visibility: S.lastGlobalFoldState }, archiveVisibility);
  return S.lastGlobalFoldState;
}
