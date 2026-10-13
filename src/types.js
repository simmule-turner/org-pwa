// @ts-check
// Shapes shared across the app, for JSDoc: a file brings one in with
//   /** @typedef {import('./types.js').Heading} Heading */
// (the path is ../src/types.js from src-browser). Nothing here runs.

/**
 * One heading as org-parser.js reads it. The index signature is there because other modules hang their own fields on it.
 * @typedef {{
 *   type: string,
 *   level: number,
 *   todo: string | null,
 *   priority: string | null,
 *   title: string,
 *   tags: string[],
 *   planning: { scheduled: string | null, deadline: string | null, closed: string | null },
 *   properties: Record<string, string>,
 *   propertyOrder: string[],
 *   logbookLines: string[],
 *   bodyLines: string[],
 *   collapsed: boolean,
 *   bodyHidden: boolean,
 *   children: Heading[],
 *   [key: string]: any,
 * }} Heading
 */

/** @typedef {{ key: string, value: string, [k: string]: any }} Keyword */

/**
 * A parsed document: the keywords and body lines before the first heading, then the top-level headings.
 * @typedef {{ type: string, keywords: Keyword[], bodyLines: string[], children: Heading[], [key: string]: any }} Doc
 */

/** The key-value store behind the document cache and settings: one value per string key. */
/** @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<any>, delete(key: string): Promise<any> }} KvAdapter */

/** The file-local variables of a document (`# -*- ... -*-` and `Local Variables:`), by name. */
/** @typedef {Record<string, any>} LocalVars */

/**
 * One line of a table: a data row, or a horizontal rule (`type: 'rule'`, which has no cells).
 * @typedef {{ type: string, cells: string[], cellsInline?: any[], [key: string]: any }} TableRow
 */

/**
 * A table as the body parser reads it. Other modules hang their own fields on it.
 * @typedef {{ type: string, rows: TableRow[], tblfm: string | null, lineIndex: number, lineCount: number, [key: string]: any }} Table
 */

/** The key sequence being typed in god mode: the chord so far, a pending `g`/`G` prefix, and the sticky literal and C-c flags. */
/** @typedef {{ chordString: string, pendingModifier: string | null, literalActive: boolean, inCcChain: boolean }} GodState */

/** @typedef {{ token: string, owner: string, repo: string, branch: string }} GithubConfig */
/** @typedef {{ baseUrl: string, username: string, password: string }} WebdavConfig */
/** @typedef {{ url: string, contactsUrl: string, username: string, password: string }} CaldavConfig */

export {};
