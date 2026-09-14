/** Real org-mode's tag/property match-query grammar (the language behind
 *  C-c / m, "Match Query", and org-make-tags-matcher generally) --
 *  confirmed directly against actual Emacs 29.3 + org-mode 9.6.15, not
 *  assumed or inferred from documentation alone, after an earlier,
 *  separate function in this same investigation (org-contacts-filter's
 *  own tags-match) turned out NOT to support this grammar despite reading
 *  similarly on paper. Every precedence/combination rule encoded here was
 *  independently reproduced as a real, run `org-make-tags-matcher` call
 *  against a real fixture file before being written into this parser --
 *  see the accompanying test file, where each test's own description
 *  names the exact empirical result it reproduces.
 *
 *  Grammar, precisely as verified:
 *  - `|` is the lowest-precedence operator: splits the whole expression
 *    into OR'd groups. Confirmed: "family+work|ex_colleague" matched
 *    (family AND work) OR (ex_colleague) -- Carol and Dave specifically,
 *    not a flatter "family AND (work OR ex_colleague)" reading.
 *  - Within one `|`-separated group, conditions are joined by simple
 *    juxtaposition: each new `+` or `-` marks the start of the next
 *    condition, implicitly AND-ed with the one before. Confirmed:
 *    "+family-work" matched Alice only (has family, lacks work) --
 *    Carol, who has both, was correctly excluded.
 *  - A condition with no leading `+`/`-` at all (the very first one in a
 *    group) means "require" -- the same as an explicit leading `+`.
 *    Confirmed: "family" and "+family" produced identical results.
 *  - `-` means "must NOT have this tag / must NOT satisfy this
 *    property comparison" -- confirmed via "work-ex_colleague" matching
 *    Bob and Carol (both have work, neither has ex_colleague) while
 *    excluding Dave (has both).
 *  - A condition is either a bare tag name, or a PROPERTY<op>VALUE
 *    comparison (op one of =, <>, <=, >=, <, >), where PROPERTY may be a
 *    real property name or one of org's own pseudo-properties (TODO,
 *    LEVEL, PRIORITY, CATEGORY are the ones this module recognizes).
 *    Confirmed via "PRIORITY_TEST=\"A\"" and "work+PRIORITY_TEST=\"B\""
 *    both matching correctly, mixing a tag condition and a property
 *    condition in the same AND-group.
 */

const CONDITION_TOKEN_RE = /([+-]?)([A-Za-z_][A-Za-z0-9_]*)(?:(<>|<=|>=|=|<|>)"([^"]*)")?/y;

/** Parses one match-query string into a list of OR'd groups, each group
 *  being a list of { negate, kind: 'tag'|'property', name, op, value }
 *  conditions that must all hold (AND) for that group to match. Throws a
 *  clear error on a condition this parser doesn't recognize, rather than
 *  silently treating malformed input as "matches nothing" or "matches
 *  everything" -- either of those would be a worse failure mode for a
 *  filter someone is actively relying on to scope an export. */
function parseMatchQuery(query) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('Match query cannot be empty');
  return trimmed.split('|').map((groupText) => parseGroup(groupText.trim()));
}

function parseGroup(groupText) {
  if (!groupText) throw new Error('Empty group in match query (found next to a "|" with nothing on one side)');
  const conditions = [];
  CONDITION_TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < groupText.length) {
    CONDITION_TOKEN_RE.lastIndex = pos;
    const m = CONDITION_TOKEN_RE.exec(groupText);
    if (!m || m.index !== pos || m[0].length === 0) {
      throw new Error(`Could not parse match query condition starting at "${groupText.slice(pos)}"`);
    }
    const [, sign, name, op, value] = m;
    const negate = sign === '-';
    if (op !== undefined) {
      conditions.push({ negate, kind: 'property', name: name.toUpperCase(), op, value });
    } else {
      conditions.push({ negate, kind: 'tag', name });
    }
    pos += m[0].length;
  }
  return conditions;
}

const PSEUDO_PROPERTIES = new Set(['TODO', 'LEVEL', 'PRIORITY', 'CATEGORY']);

/** Reads one condition's own comparison value out of `entry` -- a real
 *  property lookup for an ordinary property name, or the corresponding
 *  computed value for one of the recognized pseudo-properties. Returns
 *  undefined when the entry has no value at all for this name (an
 *  ordinary, expected case -- a `-` condition should still correctly
 *  exclude in that case, and a plain `=` condition should correctly not
 *  match). */
function readEntryValue(entry, name) {
  if (name === 'TODO') return entry.todo || undefined;
  if (name === 'LEVEL') return String(entry.level);
  if (name === 'PRIORITY') return entry.priority || undefined;
  if (name === 'CATEGORY') return entry.category || undefined;
  return entry.properties ? entry.properties[name] : undefined;
}

function compareValues(actual, op, expected) {
  if (actual === undefined) return false;
  if (op === '=') return actual === expected;
  if (op === '<>') return actual !== expected;
  const actualNum = Number(actual);
  const expectedNum = Number(expected);
  const bothNumeric = !Number.isNaN(actualNum) && !Number.isNaN(expectedNum);
  const cmp = bothNumeric ? actualNum - expectedNum : actual < expected ? -1 : actual > expected ? 1 : 0;
  if (op === '<') return cmp < 0;
  if (op === '>') return cmp > 0;
  if (op === '<=') return cmp <= 0;
  if (op === '>=') return cmp >= 0;
  throw new Error(`Unknown comparison operator "${op}"`);
}

function evaluateCondition(condition, entry) {
  let holds;
  if (condition.kind === 'tag') {
    holds = (entry.tags || []).includes(condition.name);
  } else {
    holds = compareValues(readEntryValue(entry, condition.name), condition.op, condition.value);
  }
  return condition.negate ? !holds : holds;
}

/** Evaluates a pre-parsed match query (from parseMatchQuery) against one
 *  entry: { tags: string[], todo, priority, category, level, properties }.
 *  True if ANY OR'd group has EVERY one of its own AND'd conditions hold. */
function evaluateMatchQuery(parsedGroups, entry) {
  return parsedGroups.some((group) => group.every((condition) => evaluateCondition(condition, entry)));
}

export { parseMatchQuery, evaluateMatchQuery };
