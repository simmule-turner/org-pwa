/**
 * Command palette search: given a list of commands and what the person
 * has typed, decides which commands match and in what order. Pure -- no
 * DOM, no app state -- so the ranking rules are unit tested; app.js owns
 * the registry of what each command actually does.
 *
 * A command is `{ id, label, orgName?, group?, keywords? }`:
 *   label     what it's called here ("Set effort estimate")
 *   orgName   the real Org/Emacs command it corresponds to ("org-set-effort"),
 *             so someone who thinks in M-x can type that
 *   group     a heading it's filed under ("Heading", "Clocking", ...)
 *   keywords  extra words that should find it ("schedule", "deadline")
 *
 * Matching: the query is split on whitespace; EVERY word must match
 * somewhere in the command (a substring of its label, org name or a
 * keyword, or the start of a word in its group), case-insensitively.
 * Hyphens and underscores count as spaces on both sides, but a hyphenated
 * word stays ONE word: "org-clock-in" must appear as that phrase (so it
 * finds org-clock-in and not org-clock-out), while "clock in" typed with
 * a space is two separate words that may match anywhere. Nothing fuzzy
 * beyond that: a command that doesn't contain what was typed doesn't
 * match.
 *
 * Order: a word that starts the label beats one that starts a word in it,
 * which beats one that's merely inside it; org name and keyword matches
 * rank below label matches, group matches last. Ties go to the most
 * recently used command, then to the order the commands were listed in.
 * With nothing typed, recently used commands come first and the rest keep
 * their listed order.
 */

function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function startsAWord(haystack, token) {
  return haystack.startsWith(token) || haystack.includes(' ' + token);
}

/** Lower is better; null when `token` matches nothing in the command. */
function scoreToken(token, fields) {
  let best = null;
  const consider = (score) => {
    if (best === null || score < best) best = score;
  };
  if (fields.label.startsWith(token)) consider(0);
  else if (startsAWord(fields.label, token)) consider(1);
  else if (fields.label.includes(token)) consider(3);

  if (fields.orgName) {
    if (startsAWord(fields.orgName, token)) consider(2);
    else if (fields.orgName.includes(token)) consider(4);
  }
  for (const keyword of fields.keywords) {
    if (startsAWord(keyword, token)) consider(3);
    else if (keyword.includes(token)) consider(5);
  }
  // A group is a category name: matching the START of one of its words is
  // useful ("clock" -> Clocking), matching inside a word ("in" in
  // "Clocking") is only noise.
  if (fields.group && startsAWord(fields.group, token)) consider(5);
  return best;
}

function fieldsOf(command) {
  return {
    label: normalize(command.label),
    orgName: normalize(command.orgName),
    group: normalize(command.group),
    keywords: (command.keywords || []).map(normalize),
  };
}

/**
 * Returns the commands matching `query`, best first, as
 * `{ command, recent }` (`recent` is true for a command in `recentIds`).
 * `recentIds` is most-recent-first.
 */
function searchCommands(commands, query, { recentIds = [] } = {}) {
  const tokens = String(query == null ? '' : query)
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);
  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const rankOf = (command) => (recentRank.has(command.id) ? recentRank.get(command.id) : Infinity);

  if (tokens.length === 0) {
    const recent = commands.filter((c) => recentRank.has(c.id)).sort((a, b) => rankOf(a) - rankOf(b));
    const rest = commands.filter((c) => !recentRank.has(c.id));
    return [...recent.map((command) => ({ command, recent: true })), ...rest.map((command) => ({ command, recent: false }))];
  }

  const scored = [];
  commands.forEach((command, index) => {
    const fields = fieldsOf(command);
    let total = 0;
    for (const token of tokens) {
      const score = scoreToken(token, fields);
      if (score === null) return;
      total += score;
    }
    scored.push({ command, total, index, recent: recentRank.has(command.id) });
  });
  scored.sort((a, b) => a.total - b.total || rankOf(a.command) - rankOf(b.command) || a.index - b.index);
  return scored.map(({ command, recent }) => ({ command, recent }));
}

/** `recentIds` with `id` moved to the front, deduplicated and capped. */
function pushRecent(recentIds, id, max = 8) {
  return [id, ...recentIds.filter((existing) => existing !== id)].slice(0, max);
}

export { normalize, searchCommands, pushRecent };
