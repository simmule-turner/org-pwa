// @ts-check
// What the Agenda's queries (Match, Search, custom commands) need of the settings and the open files.
import { agendaSkipper } from '../src/agenda-skip.js';
import { getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getPropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { aggregateAgendaDocs } from './agenda-files.js';
import { S } from './app-state.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';

/** What the queries need of the settings and the open files. */
export function queryOptions() {
  const vars = S.state.localVariables;
  const sequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const truthy = (/** @type {string | undefined} */ v) => !!v && v.trim() !== 'nil' && v.trim() !== '';
  return {
    skipArchived: getAgendaSkipArchivedTrees(vars),
    skipCommented: getAgendaSkipCommentTrees(vars),
    doneKeywords: sequence.doneKeywords,
    todoKeywords: sequence.todoKeywords,
    tagInheritance: getUseTagInheritance(vars),
    propertyInheritance: getPropertyInheritance(vars),
    sortingStrategy: vars['org-agenda-sorting-strategy'] || null,
    localVariables: vars,
    skipEntry: agendaSkipper(vars, aggregateAgendaDocs(), { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords }),
    documentOrder: aggregateAgendaDocs().map((d) => d.documentId),
    alwaysBoolean: truthy(vars['org-agenda-search-view-always-boolean']),
    forceFullWords: truthy(vars['org-agenda-search-view-force-full-words']),
    maxLevel: Math.max(0, parseInt(vars['org-agenda-search-view-max-outline-level'] || '0', 10) || 0),
  };
}
