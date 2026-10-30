// Cases where the app still differs from Emacs 29.3 (see test/oracle-babel.test.js). A rule names what Emacs does and what the app
// does instead; the test fails when a rule no longer matches any case, so the list only shrinks.
/** @type {{ kind: string, id: string, reason: string, match: (c: any) => boolean }[]} */
export const BABEL_RULES = [
  {
    kind: 'blocks',
    id: 'empty-header-args-with-plus',
    reason: 'Emacs quirk (kept as in the app by decision): a heading with an empty `:header-args:` value and a `:header-args+:` line mangles the first two characters of the appended arguments (":tangle yes" becomes "angle yes"); the app appends them intact.',
    match: (c) => /^:header-args(?::\S+)?:[ \t]*$/m.test(c.text) && /^:header-args(?::\S+)?\+:/m.test(c.text),
  },
  {
    kind: 'blocks',
    id: 'heading-line-inside-block',
    reason: 'Emacs ends the section at a line that looks like a heading, so a source block holding one is not a block; the app keeps the block (its parser knows source blocks).',
    match: (c) => /#\+begin_src[^\n]*\n(?:[^\n]*\n)*?\*+ /i.test(c.text) && Array.isArray(c.emacs) && c.emacs.length === 0,
  },
  {
    kind: 'blocks',
    id: 'crlf-block',
    reason: 'Emacs does not close a block whose `#+end_src` ends in a carriage return, so finds none; the app reads CRLF text like LF.',
    match: (c) => c.text.includes('\r\n') && Array.isArray(c.emacs) && c.emacs.length === 0,
  },
  {
    kind: 'blocks',
    id: 'block-in-logbook',
    reason: 'Emacs finds a source block written inside a :LOGBOOK: drawer; the app keeps drawer lines out of the body it scans.',
    match: (c) => /:LOGBOOK:\n#\+begin_src/.test(c.text),
  },
  {
    kind: 'tangle',
    id: 'emacs-stops-in-batch',
    reason: 'Emacs stops these documents in batch mode (a prompt it cannot answer, or a reference that loops until Lisp nests too deep); the app tangles them.',
    match: (c) => typeof c.emacs === 'string',
  },
  {
    kind: 'tangle',
    id: 'js-var-declarations',
    reason: 'Feature beyond Emacs 29.3: ob-js adds no `var name=value;` lines when tangling, so Emacs writes the body alone; the app writes the declarations for JavaScript blocks.',
    match: (c) => /#\+begin_src (?:js|javascript)\b[^\n]*:var /i.test(c.text) || /header-args(?::js(?:avascript)?)?\+?:? [^\n]*:var /i.test(c.text),
  },
  {
    kind: 'noweb',
    id: 'js-block-called-from-reference',
    reason: 'Infeasible here: `<<name()>>` on a JavaScript block runs it; the app runs JavaScript in an asynchronous sandbox that Noweb expansion cannot wait for, so it reports an error. Emacs Lisp blocks are run.',
    match: (c) => typeof c.got === 'string' && c.got.includes('only Emacs Lisp blocks can be run'),
  },
];

/** @param {any} c */
export const ruleFor = (c) => BABEL_RULES.find((r) => r.kind === c.kind && r.match(c)) || null;
