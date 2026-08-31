import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { searchDocument, parseFilterQuery, effectiveTags, effectivePropertyValue } from '../src/search.js';

function sampleDoc() {
  return parseOrg(
    [
      '* Projects',
      '** NRP :urgent:',
      'A paragraph about thumbnail caching.',
      '- [ ] fix the caching bug',
      '- [X] add tests',
      '|Date|Value|',
      '|2025-01-01|caching worked|',
      '** RPN calculator',
      'Nothing relevant here.',
      '* Reading list',
      'Book about caching strategies.',
    ].join('\n')
  );
}

test('finds a match in a heading title', () => {
  const results = searchDocument(sampleDoc(), 'RPN');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'heading');
  assert.equal(results[0].heading.title, 'RPN calculator');
});

test('finds a match in a tag', () => {
  const results = searchDocument(sampleDoc(), 'urgent');
  assert.equal(results.length, 1);
  assert.equal(results[0].heading.title, 'NRP');
});

test('finds matches in paragraph text, list items, and table cells, all belonging to the right heading', () => {
  const results = searchDocument(sampleDoc(), 'caching');
  const types = results.map((r) => r.type).sort();
  assert.deepEqual(types, ['list-item', 'paragraph', 'paragraph', 'table']);
  assert.ok(results.every((r) => r.heading.title === 'NRP' || r.heading.title === 'Reading list'));
});

test('search is case-insensitive', () => {
  const results = searchDocument(sampleDoc(), 'CACHING');
  assert.ok(results.length > 0);
});

test('THE POINT OF THIS FEATURE: finds matches inside a folded/collapsed heading, since search must not depend on current fold state', () => {
  const doc = sampleDoc();
  doc.children[0].collapsed = true; // "Projects" fully folded — NRP and its content are hidden from the outline
  const results = searchDocument(doc, 'thumbnail');
  assert.equal(results.length, 1);
  assert.equal(results[0].heading.title, 'NRP');
});

test('finds matches inside a heading whose body is hidden via bodyHidden (content mode)', () => {
  const doc = sampleDoc();
  doc.children[0].children[0].bodyHidden = true; // NRP's body text hidden
  const results = searchDocument(doc, 'thumbnail');
  assert.equal(results.length, 1);
});

test('empty or whitespace-only query returns no results rather than matching everything', () => {
  assert.deepEqual(searchDocument(sampleDoc(), ''), []);
  assert.deepEqual(searchDocument(sampleDoc(), '   '), []);
});

test('no matches returns an empty array, not null/undefined', () => {
  const results = searchDocument(sampleDoc(), 'nonexistentxyz');
  assert.deepEqual(results, []);
});

test('snippet centers roughly on the match rather than always showing the start of the text', () => {
  const doc = parseOrg(
    ['* Notes', 'A very long line of text padding padding padding padding TARGETWORD more padding after it too'].join(
      '\n'
    )
  );
  const results = searchDocument(doc, 'TARGETWORD');
  assert.match(results[0].snippet.text, /TARGETWORD/);
  assert.ok(results[0].snippet.text.length < 100); // actually trimmed, not the whole line
});

test('results are in document order', () => {
  const doc = parseOrg(['* First match', '* Second match', '* Third match'].join('\n'));
  const results = searchDocument(doc, 'match');
  assert.deepEqual(
    results.map((r) => r.heading.title),
    ['First match', 'Second match', 'Third match']
  );
});

// ---- regex mode ----------------------------------------------------------

test('regex mode: a pattern matches text a literal query never could', () => {
  const doc = parseOrg('* A\nCall me at 555-1234 or 555-5678.');
  const plainResults = searchDocument(doc, '\\d{3}-\\d{4}');
  assert.equal(plainResults.length, 0, 'plain mode treats regex metacharacters as literal text');

  const regexResults = searchDocument(doc, '\\d{3}-\\d{4}', { useRegex: true });
  assert.equal(regexResults.length, 1);
});

test('regex mode: "." matches any character, unlike plain mode where it is literal', () => {
  const doc = parseOrg('* Heading\ncatXdog catzdog cat dog (no direct match)');
  const plain = searchDocument(doc, 'catXdog');
  assert.equal(plain.length, 1); // literal match only

  const regex = searchDocument(doc, 'cat.dog', { useRegex: true });
  assert.equal(regex.length, 1);
  assert.match(regex[0].snippet.text, /cat.dog/);
});

test('regex mode is case-insensitive, matching plain mode\u2019s own behavior', () => {
  const doc = parseOrg('* A\nHello WORLD');
  const results = searchDocument(doc, '[wW]orld', { useRegex: true }); // a single term deliberately -- a space would split into two separately-required keywords under the new keyword-search design, which isn't what this test is actually about
  assert.equal(results.length, 1);
});

test('regex mode: an invalid pattern throws a clear, catchable error rather than silently matching nothing', () => {
  const doc = parseOrg('* A\nsome text');
  assert.throws(() => searchDocument(doc, '(unclosed', { useRegex: true }), /Invalid regex/);
});

test('regex mode: an empty query still returns no results without throwing', () => {
  const doc = parseOrg('* A\nsome text');
  assert.deepEqual(searchDocument(doc, '', { useRegex: true }), []);
  assert.deepEqual(searchDocument(doc, '   ', { useRegex: true }), []);
});

test('plain mode is unaffected by the useRegex option defaulting to false when omitted entirely', () => {
  const doc = parseOrg('* A (parenthetical) heading');
  const results = searchDocument(doc, '(parenthetical)');
  assert.equal(results.length, 1, 'a literal paren in the query must match a literal paren in the text, not be treated as a regex group');
});

// ---- properties -----------------------------------------------------------

test('finds a match in a property KEY', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:');
  const results = searchDocument(doc, 'spouse');
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
  assert.equal(propResult.snippet.text, 'spouse: Jennifer');
});

test('finds a match in a property VALUE', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:');
  const results = searchDocument(doc, 'Jennifer');
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
  assert.equal(propResult.heading.title, 'Simmule');
});

test('only matching properties produce results, not every property on the heading', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:fname: Simmule\n:lname: Turner\n:city: Durham\n:END:');
  const results = searchDocument(doc, 'Turner');
  const propResults = results.filter((r) => r.type === 'property');
  assert.equal(propResults.length, 1);
  assert.equal(propResults[0].snippet.text, 'lname: Turner');
});

test('property search respects regex mode too', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:dob: 1965-01-27\n:END:');
  const results = searchDocument(doc, '\\d{4}-\\d{2}-\\d{2}', { useRegex: true });
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
});

// ---- TODO keyword / priority -----------------------------------------------

test('finds a match on a heading\u2019s TODO keyword', () => {
  const doc = parseOrg('* TODO Buy milk\n* Just a regular heading');
  const results = searchDocument(doc, 'TODO');
  const headingResults = results.filter((r) => r.type === 'heading');
  assert.equal(headingResults.length, 1);
  assert.equal(headingResults[0].heading.title, 'Buy milk');
});

test('finds a match on a heading\u2019s priority, even when title/tags don\u2019t match', () => {
  const doc = parseOrg('* TODO [#C] Urgent work\n* TODO Regular work');
  const results = searchDocument(doc, 'C');
  const headingResults = results.filter((r) => r.type === 'heading');
  assert.equal(headingResults.length, 1, 'only the [#C] heading should match -- neither title contains a "C" of its own');
  assert.equal(headingResults[0].heading.title, 'Urgent work');
});

test('TODO/priority matches produce a "heading" type result, not a separate type', () => {
  const doc = parseOrg('* TODO [#B] Something');
  const results = searchDocument(doc, 'TODO');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'heading');
});

// ---- SCHEDULED/DEADLINE planning -------------------------------------------

test('finds a match in a SCHEDULED timestamp', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri>');
  const results = searchDocument(doc, '2026-05-15');
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
  assert.equal(planningResult.snippet.text, 'SCHEDULED: <2026-05-15 Fri>');
});

test('finds a match in a DEADLINE timestamp', () => {
  const doc = parseOrg('* A task\nDEADLINE: <2026-06-01 Mon>');
  const results = searchDocument(doc, '2026-06-01');
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
  assert.equal(planningResult.snippet.text, 'DEADLINE: <2026-06-01 Mon>');
});

test('a heading with both SCHEDULED and DEADLINE produces two separate planning results when both match', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri> DEADLINE: <2026-05-20 Wed>');
  const results = searchDocument(doc, '2026-05');
  const planningResults = results.filter((r) => r.type === 'planning');
  assert.equal(planningResults.length, 2);
});

test('planning search respects regex mode too', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri +1y>');
  const results = searchDocument(doc, '\\+\\d+y', { useRegex: true });
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
});

// ---- parseFilterQuery: the token parser itself -----------------------------

test('parseFilterQuery: a bare word becomes a required keyword filter', () => {
  const { filters } = parseFilterQuery('computer');
  assert.deepEqual(filters, [{ type: 'keyword', mode: 'include', value: 'computer' }]);
});

test('parseFilterQuery: +word means exactly the same as a bare word', () => {
  const { filters } = parseFilterQuery('+computer');
  assert.deepEqual(filters, [{ type: 'keyword', mode: 'include', value: 'computer' }]);
});

test('parseFilterQuery: -word is a keyword exclusion, with no dependency on any + appearing anywhere', () => {
  const { filters } = parseFilterQuery('-ethernet');
  assert.deepEqual(filters, [{ type: 'keyword', mode: 'exclude', value: 'ethernet' }]);
});

test('parseFilterQuery: recognizes todo: and priority: as reserved keys', () => {
  const { filters } = parseFilterQuery('todo:WAITING priority:A');
  assert.deepEqual(filters, [
    { type: 'todo', mode: 'include', values: ['WAITING'] },
    { type: 'priority', mode: 'include', values: ['A'] },
  ]);
});

test('parseFilterQuery: any other key:value becomes a property filter', () => {
  const { filters } = parseFilterQuery('spouse:Jennifer');
  assert.deepEqual(filters, [{ type: 'property', mode: 'include', key: 'spouse', values: ['Jennifer'] }]);
});

test('parseFilterQuery: multiple keyword and structured filter tokens all combine', () => {
  const { filters } = parseFilterQuery('+computer todo:WAITING -ethernet');
  assert.deepEqual(filters, [
    { type: 'keyword', mode: 'include', value: 'computer' },
    { type: 'todo', mode: 'include', values: ['WAITING'] },
    { type: 'keyword', mode: 'exclude', value: 'ethernet' },
  ]);
});

test('parseFilterQuery: multiple filter tokens combine -- structured filters and keyword terms alike', () => {
  const { filters } = parseFilterQuery('+work todo:WAITING budget review');
  assert.equal(filters.length, 4); // keyword "work", todo:WAITING, keyword "budget", keyword "review"
  assert.equal(filters.filter((f) => f.type === 'keyword').length, 3);
  assert.equal(filters.filter((f) => f.type === 'todo').length, 1);
});

test('parseFilterQuery: a bare "+" or "-" with nothing after it is a literal keyword, not a sign', () => {
  const { filters } = parseFilterQuery('+ -');
  assert.deepEqual(filters, [
    { type: 'keyword', mode: 'include', value: '+' },
    { type: 'keyword', mode: 'include', value: '-' },
  ]);
});

test('parseFilterQuery: an http(s):// URL becomes a keyword term, not a key:value property filter', () => {
  const { filters } = parseFilterQuery('see https://example.com/page for details');
  const urlFilter = filters.find((f) => f.type === 'keyword' && f.value.includes('example.com'));
  assert.ok(urlFilter, 'the URL must fall through to keyword search, not become a filter on a property literally named "https"');
  assert.equal(urlFilter.mode, 'include');
});

test('parseFilterQuery: "10:30" (a time) is a keyword term, not key:value -- a key must start with a letter, not a digit', () => {
  const { filters } = parseFilterQuery('meeting at 10:30 today');
  assert.ok(filters.some((f) => f.type === 'keyword' && f.value === '10:30'));
  assert.ok(filters.every((f) => f.type === 'keyword'), 'none of these words look like a structured filter');
});

test('parseFilterQuery: an empty query produces no filters at all', () => {
  const { filters } = parseFilterQuery('');
  assert.deepEqual(filters, []);
});

test('parseFilterQuery: a plain multi-word phrase becomes one separate required keyword per word, not one combined phrase', () => {
  const { filters } = parseFilterQuery('just a normal search phrase');
  assert.deepEqual(
    filters,
    ['just', 'a', 'normal', 'search', 'phrase'].map((value) => ({ type: 'keyword', mode: 'include', value }))
  );
});

// ---- searchDocument: filter-token integration ------------------------------

function taggedDoc() {
  return parseOrg(
    [
      '#+TODO: TODO WAITING | DONE',
      '* TODO [#A] Fix the bug :work:urgent:',
      'Some notes about the bug.',
      '* TODO Someday maybe :work:someday:',
      'Low priority idea.',
      '* WAITING On vendor reply :work:',
      'Waiting for a response.',
      '* Personal errand :home:',
      'Buy groceries.',
    ].join('\n')
  );
}

// ---- THE FEATURE: org-search-view-style keyword boolean search ------------

test('THE FEATURE: +computer +wifi -ethernet -- the exact example, matches an entry with both required words and lacking the excluded one', () => {
  const doc = parseOrg('* Networking notes\nNeed a new computer with wifi built in.\n* Office setup\nRan ethernet to the computer, no wifi needed.');
  const results = searchDocument(doc, '+computer +wifi -ethernet');
  const headings = new Set(results.map((r) => r.heading.title));
  assert.deepEqual([...headings], ['Networking notes']); // has both computer and wifi, no ethernet; the other entry has ethernet, so it's excluded even though it also mentions computer
});

test('THE FEATURE: bar -foo -- the exact clarifying example, no + needed anywhere for either term to work', () => {
  const doc = parseOrg('* Match\nThis note mentions bar but not the other word.\n* No match, has foo\nThis note has both bar and foo.\n* No match, no bar\nThis note only has foo.');
  const results = searchDocument(doc, 'bar -foo');
  const headings = new Set(results.map((r) => r.heading.title));
  assert.deepEqual([...headings], ['Match']);
});

test('THE FEATURE: a bare word and an explicit +word behave identically', () => {
  const doc = parseOrg('* A\nContains budget talk.\n* B\nNothing relevant here.');
  const bare = searchDocument(doc, 'budget').map((r) => r.heading.title);
  const explicit = searchDocument(doc, '+budget').map((r) => r.heading.title);
  assert.deepEqual(bare, explicit);
});

test('THE FEATURE: -word alone (no + anywhere in the query) still excludes on its own', () => {
  const doc = parseOrg('* Keep\nNothing bad here.\n* Drop\nHas the excluded word ethernet.');
  const results = searchDocument(doc, '-ethernet');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Keep']);
});

test('THE FEATURE: multiple required keywords matching in DIFFERENT fields each produce their own separately-highlighted result row', () => {
  const doc = parseOrg('* Widget project :urgent:\nTalk to the vendor about pricing.');
  const results = searchDocument(doc, '+urgent +vendor');
  // "urgent" matches the tag (a heading-type result), "vendor" matches the body paragraph -- two rows, not one merged row.
  assert.equal(results.length, 2);
  const types = results.map((r) => r.type).sort();
  assert.deepEqual(types, ['heading', 'paragraph']);
});

test('THE FEATURE: keyword search covers the same full breadth as everything else here -- title, tags, TODO, priority, properties, planning, body', () => {
  const title = parseOrg('* Alpha budget review\n');
  assert.equal(searchDocument(title, '+budget').length, 1);

  const tag = parseOrg('* A :budget:\n');
  assert.equal(searchDocument(tag, '+budget').length, 1);

  const todo = parseOrg('#+TODO: BUDGET DONE\n* BUDGET Something\n');
  assert.equal(searchDocument(todo, '+budget').length, 1);

  const property = parseOrg('* A\n:PROPERTIES:\n:category: budget\n:END:\n');
  assert.equal(searchDocument(property, '+budget').length, 1);

  const planning = parseOrg('* A\nSCHEDULED: <2026-05-15 Fri budget-review>\n');
  assert.equal(searchDocument(planning, '+budget').length, 1);

  const body = parseOrg('* A\nThis paragraph mentions the budget.\n');
  assert.equal(searchDocument(body, '+budget').length, 1);
});

test('THE FEATURE: highlight range points at the actual matched substring within the snippet text', () => {
  const doc = parseOrg('* A\nThis paragraph mentions the budget explicitly.');
  const results = searchDocument(doc, '+budget');
  const para = results.find((r) => r.type === 'paragraph');
  const { text, highlightStart, highlightLength } = para.snippet;
  assert.equal(text.slice(highlightStart, highlightStart + highlightLength).toLowerCase(), 'budget');
});

test('THE FEATURE: highlight length in regex mode reflects the ACTUAL matched text, not the pattern string\u2019s own length', () => {
  const doc = parseOrg('* A\nCall 555-123456 for details.');
  const results = searchDocument(doc, '+\\d{3}-\\d+', { useRegex: true });
  const para = results.find((r) => r.type === 'paragraph');
  const { text, highlightStart, highlightLength } = para.snippet;
  assert.equal(text.slice(highlightStart, highlightStart + highlightLength), '555-123456');
  assert.notEqual(highlightLength, '\\d{3}-\\d+'.length); // the pattern string itself is a different length than what it actually matched
});

test('THE FEATURE: a structured tag: filter combines with a keyword term as AND, same as before', () => {
  const results = searchDocument(taggedDoc(), 'tag:work vendor');
  const headings = results.filter((r) => r.type === 'heading' || r.type === 'paragraph').map((r) => r.heading.title);
  assert.ok(headings.includes('On vendor reply'));
  assert.ok(!headings.includes('Fix the bug'), 'tagged work but has no "vendor" text anywhere, so must not match');
});

test('THE FEATURE: no results when a required keyword is absent everywhere, not an error', () => {
  const doc = parseOrg('* A\nSome text.\n* B\nMore text.');
  assert.deepEqual(searchDocument(doc, '+nonexistentword'), []);
});

test('THE FEATURE: an exclude-only query (no include keywords at all) still returns headings that pass, with no snippet to highlight', () => {
  const doc = parseOrg('* Keep\nFine.\n* Drop\nHas the bad word.');
  const results = searchDocument(doc, '-bad');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'heading');
  assert.equal(results[0].snippet.highlightStart, -1);
});

test('a tag: filter finds only headings with that tag', () => {
  const results = searchDocument(taggedDoc(), 'tag:home');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Personal errand']);
});

test('a -tag: filter excludes headings with that tag', () => {
  const results = searchDocument(taggedDoc(), 'tag:work -tag:someday');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ['Fix the bug', 'On vendor reply'].sort());
});

test('a todo: filter matches the TODO keyword exactly, not as a substring', () => {
  const results = searchDocument(taggedDoc(), 'todo:WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['On vendor reply']);
});

test('todo: filter is case-insensitive', () => {
  const results = searchDocument(taggedDoc(), 'todo:waiting');
  assert.equal(results.filter((r) => r.type === 'heading').length, 1);
});

test('a priority: filter finds only that exact priority', () => {
  const results = searchDocument(taggedDoc(), 'priority:A');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Fix the bug']);
});

test('a generic key:value filter matches a property', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:\n* Someone else\n:PROPERTIES:\n:spouse: Robert\n:END:');
  const results = searchDocument(doc, 'spouse:Jennifer');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Simmule']);
});

// ---- THE FEATURE: unified tag:/todo:/priority:/key: syntax, negation, and | (OR) ----

test('THE FEATURE: tag:X (bare) is the same as +tag', () => {
  const results = searchDocument(taggedDoc(), 'tag:home');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Personal errand']);
});

test('THE FEATURE: +tag:X is the same as +tag', () => {
  const results = searchDocument(taggedDoc(), '+tag:home');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Personal errand']);
});

test('THE FEATURE: -tag:X excludes headings with that tag', () => {
  const results = searchDocument(taggedDoc(), 'tag:work -tag:someday');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ['Fix the bug', 'On vendor reply'].sort());
});

test('THE FEATURE: +todo:X is the same as bare todo:X', () => {
  const results = searchDocument(taggedDoc(), '+todo:WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['On vendor reply']);
});

test('THE FEATURE: -todo:X excludes that TODO state -- genuinely new, no way to express this before', () => {
  const results = searchDocument(taggedDoc(), '-todo:WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  // "Fix the bug" (TODO) and "Someday maybe" (TODO) pass; "On vendor
  // reply" (WAITING) is excluded; "Personal errand" has NO todo keyword
  // at all and still passes -- absence isn't "WAITING", same principle
  // as -tag already had for a heading with no tags.
  assert.deepEqual(headings.sort(), ['Fix the bug', 'Someday maybe', 'Personal errand'].sort());
});

test('THE FEATURE: +priority:X is the same as bare priority:X', () => {
  const results = searchDocument(taggedDoc(), '+priority:A');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Fix the bug']);
});

test('THE FEATURE: -priority:X excludes that priority, headings with no priority at all still pass', () => {
  const results = searchDocument(taggedDoc(), '-priority:A');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ['Someday maybe', 'On vendor reply', 'Personal errand'].sort());
});

test('THE FEATURE: -key:value excludes a property value, missing the property entirely still passes', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:\n* Robert\'s partner\n:PROPERTIES:\n:spouse: Robert\n:END:\n* No spouse property at all\n');
  const results = searchDocument(doc, '-spouse:Jennifer');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ["Robert's partner", 'No spouse property at all'].sort());
});

test('THE FEATURE: | is OR within one filter\'s own value list -- todo:A|B matches either', () => {
  const results = searchDocument(taggedDoc(), 'todo:TODO|WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ['Fix the bug', 'Someday maybe', 'On vendor reply'].sort());
});

test('THE FEATURE: | works for tag: too -- tag:a|b matches either tag', () => {
  const results = searchDocument(taggedDoc(), 'tag:urgent|home');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings.sort(), ['Fix the bug', 'Personal errand'].sort());
});

test('THE FEATURE: a negated OR means "neither of these" -- -todo:TODO|WAITING excludes both states', () => {
  const results = searchDocument(taggedDoc(), '-todo:TODO|WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Personal errand']); // the only heading with neither TODO nor WAITING
});

test('THE FEATURE: a malformed value list (nothing but a pipe) falls through to a literal keyword term rather than matching nothing', () => {
  const { filters } = parseFilterQuery('todo:|');
  assert.deepEqual(filters, [{ type: 'keyword', mode: 'include', value: 'todo:|' }]);
});

test('combined filters apply as AND, not OR', () => {
  const results = searchDocument(taggedDoc(), 'tag:work todo:WAITING');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['On vendor reply']); // NOT "Fix the bug" -- that one is TODO, not WAITING
});

test('a structured filter combined with a keyword term requires BOTH to match', () => {
  const results = searchDocument(taggedDoc(), 'tag:work vendor');
  const headings = results.filter((r) => r.type === 'heading' || r.type === 'paragraph').map((r) => r.heading.title);
  assert.ok(headings.includes('On vendor reply'));
  assert.ok(!headings.includes('Fix the bug'), 'tagged work but has no "vendor" text anywhere, so must not match');
});

test('a pure structured-filter query (no keyword terms) produces a heading result for every heading that passes, even with nothing to highlight', () => {
  const results = searchDocument(taggedDoc(), 'tag:work');
  assert.equal(results.length, 3); // three headings tagged work, one result each, no body/property/planning noise
  assert.ok(results.every((r) => r.type === 'heading'));
});

test('tag filters DO inherit to child headings by default, matching real org-use-tag-inheritance\u2019s own default of t', () => {
  const doc = parseOrg('* Parent :work:\n** Child with no tags of its own');
  const results = searchDocument(doc, 'tag:work');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Parent', 'Child with no tags of its own']);
});

test('tag inheritance can be turned off via useTagInheritance: false, restoring the "own tags only" behavior', () => {
  const doc = parseOrg('* Parent :work:\n** Child with no tags of its own');
  const results = searchDocument(doc, 'tag:work', { useTagInheritance: false });
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Parent']);
});

test('inheritance also applies correctly to a -tag: exclusion -- an inherited tag still excludes the child', () => {
  const doc = parseOrg('* Parent :work:\n** Child with no tags of its own');
  const results = searchDocument(doc, '-tag:work');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, [], 'the child inherits :work: so -tag:work must exclude it too, same as it excludes the parent');
});

test('child headings are still independently evaluated and can match on their own', () => {
  const doc = parseOrg('* Parent (no tag)\n** Child :work:');
  const results = searchDocument(doc, 'tag:work');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Child']);
});

test('a structured filter combines correctly with a regex-mode keyword term', () => {
  const doc = parseOrg('* A :work:\nCall 555-1234\n* B :work:\nno phone number here');
  const results = searchDocument(doc, 'tag:work \\d{3}-\\d{4}', { useRegex: true });
  const headings = results.filter((r) => r.type === 'paragraph').map((r) => r.heading.title);
  assert.deepEqual(headings, ['A']);
});

test('a filter with no matching headings at all returns an empty array, not an error', () => {
  const results = searchDocument(taggedDoc(), 'tag:nonexistent-tag');
  assert.deepEqual(results, []);
});

// ---- multi-level tag inheritance ---------------------------------------

test('tag inheritance flows through multiple levels -- a grandchild inherits a grandparent\u2019s tag', () => {
  const doc = parseOrg('* Grandparent :project:\n** Parent (no tag)\n*** Grandchild (no tag)');
  const results = searchDocument(doc, 'tag:project');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Grandparent', 'Parent (no tag)', 'Grandchild (no tag)']);
});

test('a heading\u2019s own tag combines with an inherited one -- both matter independently', () => {
  const doc = parseOrg('* Parent :work:\n** Child :urgent:');
  assert.deepEqual(searchDocument(doc, 'tag:work').map((r) => r.heading.title), ['Parent', 'Child']);
  assert.deepEqual(searchDocument(doc, 'tag:urgent').map((r) => r.heading.title), ['Child']);
});

// ---- property inheritance (opt-in, matching real org's own default) ---

test('property filters do NOT inherit by default, matching real org-use-property-inheritance\u2019s own default of nil', () => {
  const doc = parseOrg(
    ['* Parent', ':PROPERTIES:', ':OWNER: Alice', ':END:', '** Child with no properties of its own'].join('\n')
  );
  const results = searchDocument(doc, 'owner:Alice');
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Parent']);
});

test('property inheritance can be turned on via usePropertyInheritance: true', () => {
  const doc = parseOrg(
    ['* Parent', ':PROPERTIES:', ':OWNER: Alice', ':END:', '** Child with no properties of its own'].join('\n')
  );
  const results = searchDocument(doc, 'owner:Alice', { usePropertyInheritance: true });
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Parent', 'Child with no properties of its own']);
});

test('a heading\u2019s OWN property value always wins over an inherited one, even with inheritance on', () => {
  const doc = parseOrg(
    ['* Parent', ':PROPERTIES:', ':OWNER: Alice', ':END:', '** Child', ':PROPERTIES:', ':OWNER: Bob', ':END:'].join('\n')
  );
  const results = searchDocument(doc, 'owner:Bob', { usePropertyInheritance: true });
  const headings = results.filter((r) => r.type === 'heading').map((r) => r.heading.title);
  assert.deepEqual(headings, ['Child'], 'the child\u2019s own OWNER: Bob must win, not inherit Alice from the parent');
});

// ---- effectiveTags / effectivePropertyValue direct unit tests -----------

test('effectiveTags: without inheritance, only the heading\u2019s own tags', () => {
  const heading = { tags: ['a'] };
  const ancestors = [{ tags: ['b'] }, { tags: ['c'] }];
  assert.deepEqual(effectiveTags(heading, ancestors, false), ['a']);
});

test('effectiveTags: with inheritance, the heading\u2019s own tags plus every ancestor\u2019s', () => {
  const heading = { tags: ['a'] };
  const ancestors = [{ tags: ['b'] }, { tags: ['c'] }];
  assert.deepEqual(effectiveTags(heading, ancestors, true), ['a', 'b', 'c']);
});

test('effectivePropertyValue: the heading\u2019s own value is used when present, inheritance or not', () => {
  const heading = { propertyOrder: ['OWNER'], properties: { OWNER: 'Alice' } };
  const ancestors = [{ propertyOrder: ['OWNER'], properties: { OWNER: 'Bob' } }];
  assert.equal(effectivePropertyValue(heading, ancestors, 'OWNER', true), 'Alice');
  assert.equal(effectivePropertyValue(heading, ancestors, 'OWNER', false), 'Alice');
});

test('effectivePropertyValue: falls back to the NEAREST ancestor that has it, with inheritance on', () => {
  const heading = { propertyOrder: [], properties: {} };
  const ancestors = [
    { propertyOrder: ['OWNER'], properties: { OWNER: 'Grandparent' } },
    { propertyOrder: [], properties: {} }, // parent -- doesn't have it
  ];
  assert.equal(effectivePropertyValue(heading, ancestors, 'OWNER', true), 'Grandparent');
});

test('effectivePropertyValue: returns null when nothing in the chain defines it', () => {
  const heading = { propertyOrder: [], properties: {} };
  const ancestors = [{ propertyOrder: [], properties: {} }];
  assert.equal(effectivePropertyValue(heading, ancestors, 'OWNER', true), null);
  assert.equal(effectivePropertyValue(heading, ancestors, 'OWNER', false), null);
});
