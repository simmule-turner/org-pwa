// The case corpus for the todo-log-clock oracle (tools/gen-oracle-todo-log-clock.mjs makes the Emacs results;
// test/oracle-todo-log-clock.test.js holds the app to them). Every case is plain data: {kind, name, org, ...parameters}.
// `lisp` is the Emacs form that produces the expected text; the app side reads the same parameters.

export const NOW = '2026-10-11 16:30:00';
export const TZ = 'America/New_York';

/** @typedef {{ kind: string, name: string, org: string, now?: string, [k: string]: any }} Case */

/** @type {() => Case[]} */
export function buildCases() {
  /** @type {Case[]} */
  const cases = [];
  cycleCases(cases);
  logCases(cases);
  priorityCases(cases);
  clockCases(cases);
  durationCases(cases);
  planningCases(cases);
  clocktableCases(cases);
  return cases;
}

// ---------------------------------------------------------------- cycling a TODO state (org-todo with no argument)
function cycleCases(/** @type {Case[]} */ out) {
  const configs = [
    ['default', ''],
    ['todo-next-done', '#+TODO: TODO NEXT | DONE\n'],
    ['two-done', '#+TODO: TODO NEXT | DONE CANCELLED\n'],
    ['fast-keys', '#+TODO: TODO(t) WAIT(w) | DONE(d) CANC(c)\n'],
    ['two-sequences', '#+TODO: TODO | DONE\n#+TODO: BUG FIXING | FIXED\n'],
    ['typ', '#+TYP_TODO: Fred Sara Lucy\n'],
    ['seq-no-bar', '#+SEQ_TODO: A B C\n'],
    ['only-done', '#+TODO: | DONE\n'],
    ['bar-last-empty', '#+TODO: TODO NEXT |\n'],
    ['single', '#+TODO: ONLY\n'],
    ['three-three', '#+TODO: A B C | D E F\n'],
    ['seq-then-type', '#+SEQ_TODO: TODO | DONE\n#+TYP_TODO: Fred Sara | Lucy\n'],
    ['three-sequences', '#+TODO: A | B\n#+TODO: C | D\n#+TODO: E | F\n'],
  ];
  for (const [cname, header] of configs) {
    const kws = [...header.matchAll(/^#\+(?:TODO|SEQ_TODO|TYP_TODO):(.*)$/gm)].flatMap((m) => m[1].replace(/\(.*?\)/g, '').replace('|', ' ').trim().split(/\s+/).filter(Boolean));
    const starts = ['', ...(kws.length ? kws : ['TODO', 'DONE'])];
    for (const start of starts) {
      if (start === '' && (header.match(/^#\+(?:TODO|SEQ_TODO|TYP_TODO):/gm) || []).length > 1) continue; // Emacs asks which sequence (a prompt), as the app's picker does
      for (const dir of ['right']) {
        for (const times of [1, 2, kws.length + 1 || 3]) {
          // with several sequences Emacs remembers the last sequence it left (a global), so a run through "no state" is left out
          const lines = header.match(/^#\+(?:TODO|SEQ_TODO|TYP_TODO):(.*)$/gm) || [];
          const own = lines.find((l) => l.split(/[\s|]+/).includes(start));
          const ownCount = own ? own.replace(/^#\+\w+:/, '').replace('|', ' ').trim().split(/\s+/).length : 0;
          const ownIdx = own ? own.replace(/^#\+\w+:/, '').replace('|', ' ').trim().split(/\s+/).indexOf(start) : -1;
          if (lines.length > 1 && times > ownCount - ownIdx) continue;
          out.push({
            kind: 'cycle',
            name: `cycle ${cname} from ${start || 'none'} ${dir} x${times}`,
            org: `${header}* ${start ? start + ' ' : ''}Task\n`,
            dir,
            times,
            lisp: `(let ((org-use-fast-todo-selection nil)) (goto-char (point-min)) (re-search-forward "^\\\\*+ ") (beginning-of-line) (dotimes (_ ${times}) (org-todo)) (buffer-string))`,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------- logging when the state changes
function logCases(/** @type {Case[]} */ out) {
  const heads = {
    plain: '* TODO Task\n',
    body: '* TODO Task\nSome text\nmore text\n',
    sched: '* TODO Task\nSCHEDULED: <2026-10-12 Mon>\n',
    repeat: '* TODO Task\nSCHEDULED: <2026-10-05 Mon +1w>\n',
    repeatBody: '* TODO Task\nSCHEDULED: <2026-10-05 Mon +1w>\nbody\n',
    logbook: '* TODO Task\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 09:00] \\\\\n  earlier\n:END:\n',
    props: '* TODO Task\n:PROPERTIES:\n:FOO: bar\n:END:\n',
    propsBody: '* TODO Task\n:PROPERTIES:\n:FOO: bar\n:END:\ntext\n',
    child: '* TODO Task\n** TODO Child\n',
    sibling: '* TODO Task\n* TODO Other\n',
    last: 'intro line\n* TODO Task',
    done: '* DONE Task\nCLOSED: [2026-10-10 Sat 10:00]\n',
    tags: '* TODO Task :a:b:\n',
  };
  const keywordLines = {
    plain: '#+TODO: TODO NEXT | DONE CANC\n',
    stamps: '#+TODO: TODO(t) NEXT(n!) | DONE(d!) CANC(c!)\n',
    notes: '#+TODO: TODO(t) NEXT(n@) | DONE(d@) CANC(c@)\n',
    leave: '#+TODO: TODO(t) NEXT(n/!) | DONE(d) CANC(c)\n',
    both: '#+TODO: TODO(t) NEXT(n@/!) | DONE(d!/@) CANC(c)\n',
    leaveNote: '#+TODO: TODO(t) NEXT(n/@) | DONE(d) CANC(c)\n',
    mixed: '#+TODO: TODO(t) NEXT(n@) | DONE(d!) CANC(c@/!)\n',
  };
  const startups = ['', '#+STARTUP: logdone\n', '#+STARTUP: lognotedone\n', '#+STARTUP: logdrawer\n', '#+STARTUP: logdone logdrawer\n', '#+STARTUP: lognotedone logdrawer\n'];
  const transitions = [['TODO', 'NEXT'], ['TODO', 'DONE'], ['NEXT', 'DONE'], ['NEXT', 'TODO'], ['DONE', 'TODO'], ['TODO', 'CANC'], ['NEXT', 'CANC'], ['DONE', 'NEXT']];
  const note = 'Typed note';
  const add = (/** @type {string} */ name, /** @type {string} */ org, /** @type {string} */ to, /** @type {Record<string, string>} */ vars = {}, /** @type {string | null} */ noteText = note, /** @type {string | null} */ find = null) => {
    const letBindings = Object.entries(vars).map(([k, v]) => `(${k} ${v})`).join(' ');
    out.push({
      kind: 'log', name, org, to, vars, note: noteText, find,
      lisp: `(let (${letBindings}) (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t))) (goto-char (point-min)) ${find ? `(re-search-forward ${JSON.stringify('^\\*+ \\(?:[A-Z]+ \\)?' + find)})` : '(re-search-forward "^\\\\*+ ")'} (beginning-of-line) (let ((inhibit-message t) (message-log-max nil)) (org-todo ${to === '' ? "'none" : JSON.stringify(to)}) (run-hooks 'post-command-hook) (let ((b (get-buffer "*Org Note*"))) (when (and b ${noteText === null ? 'nil' : 't'}) (with-current-buffer b (insert ${JSON.stringify(noteText ?? '')}) (org-store-log-note))))) (buffer-string)))`,
    });
  };
  // 1. keyword specs x transitions on a plain heading and one with a body, under the usual startup words
  for (const [kn, kl] of Object.entries(keywordLines)) {
    for (const [from, to] of transitions) {
      for (const [hn, hd] of [['plain', heads.plain], ['body', heads.body], ['logbook', heads.logbook], ['repeat', heads.repeat]]) {
        const org = kl + hd.replace(/^\* TODO/m, `* ${from}`);
        add(`${kn}: ${hn} ${from}->${to}`, org, to);
      }
    }
  }
  // 2. startup words x headings x destination
  for (const st of startups) {
    for (const [hn, hd] of Object.entries(heads)) {
      for (const to of ['NEXT', 'DONE', 'TODO']) {
        const from = hn === 'done' ? 'DONE' : 'TODO';
        if (from === to) continue;
        add(`startup ${JSON.stringify(st)}: ${hn} ->${to}`, st + keywordLines.plain + hd, to);
      }
    }
  }
  // 3. variables set instead of STARTUP words
  const varSets = [
    { 'org-log-done': "'time" },
    { 'org-log-done': "'note" },
    { 'org-log-done': 'nil' },
    { 'org-log-into-drawer': 't' },
    { 'org-log-into-drawer': '"NOTES"' },
    { 'org-log-into-drawer': '"LOGBOOK"' },
    { 'org-log-into-drawer': 'nil' },
    { 'org-log-done': "'time", 'org-log-into-drawer': 't' },
    { 'org-log-done': "'note", 'org-log-into-drawer': '"NOTES"' },
    { 'org-log-repeat': 'nil' },
    { 'org-log-repeat': "'note" },
    { 'org-log-repeat': "'time", 'org-log-into-drawer': 't' },
    { 'org-log-repeat': "'note", 'org-log-into-drawer': 't' },
    { 'org-log-repeat': 'nil', 'org-log-done': "'time" },
  ];
  for (const vars of varSets) {
    for (const [hn, hd] of [['plain', heads.plain], ['body', heads.body], ['repeat', heads.repeat], ['logbook', heads.logbook], ['props', heads.props], ['last', heads.last]]) {
      for (const to of ['DONE', 'NEXT']) add(`vars ${JSON.stringify(vars)}: ${hn} ->${to}`, keywordLines.plain + hd, to, vars);
      add(`vars ${JSON.stringify(vars)} with notes: ${hn} ->DONE`, keywordLines.mixed + hd, 'DONE', vars);
    }
  }
  // 4. the notes typed: empty, long, several lines, with markup, blank lines
  const notes = ['', 'one', 'two\nlines', 'three\nline\nnote', 'with *bold* and [[link]]', '  leading spaces', 'trailing  ', 'a\n\nb', '* looks like a heading', 'back\\\\slash', 'colon: :tag:'];
  for (const n of notes) {
    add(`note ${JSON.stringify(n)} on a state with @`, keywordLines.notes + heads.plain, 'NEXT', {}, n);
    add(`note ${JSON.stringify(n)} on closing`, '#+STARTUP: lognotedone\n' + keywordLines.plain + heads.body, 'DONE', {}, n);
    add(`note ${JSON.stringify(n)} in a drawer`, '#+STARTUP: logdrawer\n' + keywordLines.notes + heads.props, 'NEXT', {}, n);
    add(`note ${JSON.stringify(n)} on a repeating task`, '#+STARTUP: lognoterepeat\n' + keywordLines.plain + heads.repeat, 'DONE', {}, n);
  }
  // 5. the LOGGING and LOG_INTO_DRAWER properties, inherited from a parent
  const loggings = ['logdone', 'lognotedone', 'nologdone', 'nil', 'logrepeat', 'lognoterepeat', 'nologrepeat', 'logdone logdrawer', 'TODO(!) NEXT(@)', 'logdone NEXT(@/!)', 'DONE(!)'];
  for (const l of loggings) {
    for (const to of ['DONE', 'NEXT']) {
      add(`LOGGING ${l} on the parent ->${to}`, `${keywordLines.plain}* Parent\n:PROPERTIES:\n:LOGGING: ${l}\n:END:\n** TODO Task\n`, to, {}, note, 'Task');
      add(`LOGGING ${l} on the heading ->${to}`, `${keywordLines.plain}* TODO Task\n:PROPERTIES:\n:LOGGING: ${l}\n:END:\n`, to);
      add(`LOGGING ${l} over keyword settings ->${to}`, `${keywordLines.stamps}* TODO Task\n:PROPERTIES:\n:LOGGING: ${l}\n:END:\n`, to);
      add(`LOGGING ${l} over keyword notes ->${to}`, `${keywordLines.notes}* TODO Task\n:PROPERTIES:\n:LOGGING: ${l}\n:END:\n`, to);
      add(`LOGGING ${l} with a repeater ->${to}`, `${keywordLines.plain}* TODO Task\nSCHEDULED: <2026-10-05 Mon +1w>\n:PROPERTIES:\n:LOGGING: ${l}\n:END:\n`, to);
    }
  }
  for (const d of ['t', 'nil', 'NOTES', 'LOGBOOK', '"quoted"']) {
    for (const to of ['NEXT', 'DONE']) {
      add(`LOG_INTO_DRAWER ${d} on the parent ->${to}`, `${keywordLines.stamps}* Parent\n:PROPERTIES:\n:LOG_INTO_DRAWER: ${d}\n:END:\n** TODO Task\n`, to, {}, note, 'Task');
      add(`LOG_INTO_DRAWER ${d} on the heading ->${to}`, `${keywordLines.stamps}* TODO Task\n:PROPERTIES:\n:LOG_INTO_DRAWER: ${d}\n:END:\n`, to);
      add(`LOG_INTO_DRAWER ${d} with a body ->${to}`, `${keywordLines.stamps}* TODO Task\n:PROPERTIES:\n:LOG_INTO_DRAWER: ${d}\n:END:\nbody\n`, to);
    }
  }
  // 6. a keyword that is not in the file, going to none, and the same state again
  for (const st of ['', '#+STARTUP: logdone\n']) {
    for (const to of ['', 'TODO']) add(`${JSON.stringify(st)} to ${JSON.stringify(to)} from DONE with CLOSED`, st + keywordLines.stamps + heads.done, to);
    add(`${JSON.stringify(st)} same state TODO->TODO`, st + keywordLines.stamps + heads.plain, 'TODO');
    add(`${JSON.stringify(st)} none->DONE`, st + keywordLines.stamps + '* Task\n', 'DONE');
    add(`${JSON.stringify(st)} none->NEXT`, st + keywordLines.stamps + '* Task\n', 'NEXT');
  }
}

// ---------------------------------------------------------------- priorities
function priorityCases(/** @type {Case[]} */ out) {
  const ranges = [['default', ''], ['A-E', '#+PRIORITIES: A E C\n'], ['A-C d=A', '#+PRIORITIES: A C A\n'], ['A-C d=C', '#+PRIORITIES: A C C\n'], ['1-5', '#+PRIORITIES: 1 5 3\n'], ['A-Z', '#+PRIORITIES: A Z M\n'], ['A-B', '#+PRIORITIES: A B B\n'], ['B-D', '#+PRIORITIES: B D C\n']];
  const heads = [['none', '* TODO Task\n'], ['A', '* TODO [#A] Task\n'], ['B', '* TODO [#B] Task\n'], ['C', '* TODO [#C] Task\n'], ['D', '* TODO [#D] Task\n'], ['E', '* TODO [#E] Task\n'], ['3', '* TODO [#3] Task\n'], ['out-of-range Z', '* TODO [#Z] Task\n'], ['no todo', '* [#B] Task\n'], ['tags', '* TODO [#B] Task :x:y:\n'], ['plain', '* Task\n']];
  for (const [rn, rl] of ranges) {
    for (const [hn, hd] of heads) {
      for (const op of ['up', 'down']) {
        for (const startDefault of [true, false]) {
          for (const times of [1, 2, 4]) {
            if (!startDefault && times > 2) continue;
            out.push({
              kind: 'priority', name: `priority ${op} x${times} on ${hn} in ${rn}${startDefault ? '' : ' (no start-with-default)'}`,
              org: rl + hd, op, times, startDefault,
              lisp: `(let ((org-priority-start-cycle-with-default ${startDefault ? 't' : 'nil'})) (goto-char (point-min)) (re-search-forward "^\\\\*+ ") (beginning-of-line) (dotimes (_ ${times}) (org-priority '${op})) (buffer-string))`,
            });
          }
        }
      }
      for (const ch of ['A', 'B', 'C', 'E', 'Z', '1', '3']) {
        out.push({
          kind: 'priority', name: `priority set ${ch} on ${hn} in ${rn}`, org: rl + hd, op: 'set', char: ch,
          lisp: `(progn (goto-char (point-min)) (re-search-forward "^\\\\*+ ") (beginning-of-line) (org-priority ${/\d/.test(ch) ? ch : '?' + ch}) (buffer-string))`,
        });
      }
      if (/\[#/.test(hd)) out.push({
        kind: 'priority', name: `priority remove on ${hn} in ${rn}`, org: rl + hd, op: 'remove',
        lisp: `(progn (goto-char (point-min)) (re-search-forward "^\\\\*+ ") (beginning-of-line) (org-priority 'remove) (buffer-string))`,
      });
    }
  }
}

// ---------------------------------------------------------------- clock in and out
function clockCases(/** @type {Case[]} */ out) {
  const ctx = {
    plain: '* TODO Task\n',
    body: '* TODO Task\nSome text\n',
    planning: '* TODO Task\nSCHEDULED: <2026-10-12 Mon>\n',
    planBody: '* TODO Task\nSCHEDULED: <2026-10-12 Mon>\nSome text\n',
    props: '* TODO Task\n:PROPERTIES:\n:FOO: bar\n:END:\n',
    propsBody: '* TODO Task\n:PROPERTIES:\n:FOO: bar\n:END:\nSome text\n',
    planProps: '* TODO Task\nSCHEDULED: <2026-10-12 Mon>\n:PROPERTIES:\n:FOO: bar\n:END:\nSome text\n',
    logbook: '* TODO Task\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 09:00] \\\\\n  earlier\n:END:\n',
    oneClock: '* TODO Task\n:LOGBOOK:\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n:END:\n',
    bareClock: '* TODO Task\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n',
    twoClocks: '* TODO Task\n:LOGBOOK:\nCLOCK: [2026-10-10 Sat 11:00]--[2026-10-10 Sat 11:20] =>  0:20\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n:END:\n',
    clockAndNote: '* TODO Task\n:LOGBOOK:\n- State "DONE" from "TODO" [2026-10-10 Sat 12:00]\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n:END:\n',
    child: '* TODO Task\n** Child\n',
    sibling: '* TODO Task\n* Other\n',
    last: 'intro\n* TODO Task',
    tagged: '* TODO [#A] Task :a:b:\n',
    otherDrawer: '* TODO Task\n:MYDRAWER:\nstuff\n:END:\n',
  };
  const starts = ['2026-10-11 09:00', '2026-10-11 16:30', '2026-10-11 00:00', '2026-10-11 23:59'];
  const spans = [0, 1, 5, 59, 60, 61, 90, 125, 600, 1439, 1440, 1500, 3000, 6001];
  const lt = (/** @type {string} */ ts, /** @type {number} */ plus) => {
    const [d, t] = ts.split(' ');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return `(encode-time 0 ${mi + plus} ${h} ${da} ${mo} ${y})`;
  };
  const startStamp = (/** @type {string} */ ts) => lt(ts, 0);
  const find = '(goto-char (point-min)) (re-search-forward "^\\\\*+ .*Task") (beginning-of-line)';
  const mk = (/** @type {string} */ name, /** @type {string} */ org, /** @type {string} */ body, /** @type {Record<string, any>} */ extra = {}) => {
    out.push({ kind: 'clock', name, org, ...extra, lisp: `(let ((org-clock-persist nil) (org-clock-in-switch-to-state nil)) (unwind-protect (progn ${find} ${body} (buffer-string)) (oc-reset)))` });
  };
  // 1. in, then out, for every context (one span)
  for (const [cn, org] of Object.entries(ctx)) {
    mk(`clock in+out in ${cn}`, org, `(org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], 125)})`, { start: starts[0], span: 125 });
    mk(`clock in only in ${cn}`, org, `(org-clock-in nil ${startStamp(starts[0])})`, { start: starts[0], span: null });
    mk(`clock in then cancel in ${cn}`, org, `(org-clock-in nil ${startStamp(starts[0])}) (org-clock-cancel)`, { start: starts[0], span: null, cancel: true });
  }
  // 2. durations for every start, in a plain heading
  for (const s of starts) for (const span of spans) mk(`clock span ${span} min from ${s}`, ctx.plain, `(org-clock-in nil ${startStamp(s)}) (org-clock-out nil nil ${lt(s, span)})`, { start: s, span });
  // 3. a second session on a heading that already has clocks
  for (const base of ['oneClock', 'twoClocks', 'bareClock', 'clockAndNote']) {
    for (const span of [15, 90, 1500]) mk(`second session ${span} min after ${base}`, ctx[base], `(org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], span)})`, { start: starts[0], span });
  }
  // 4. clock-into-drawer settings, every value in every context
  ctx.twoBare = '* TODO Task\nCLOCK: [2026-10-10 Sat 11:00]--[2026-10-10 Sat 11:20] =>  0:20\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n';
  ctx.bareAfterText = '* TODO Task\nSome text\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n';
  ctx.planClock = '* TODO Task\nSCHEDULED: <2026-10-12 Mon>\n:PROPERTIES:\n:FOO: bar\n:END:\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\nSome text\n';
  ctx.clockingDrawer = '* TODO Task\n:CLOCKING:\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n:END:\n';
  ctx.bothDrawers = '* TODO Task\n:CLOCKING:\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 10:30] =>  1:30\n:END:\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 09:00] \\\\\n  earlier\n:END:\n';
  ctx.nextHeading = '* TODO Task\nSome text\n\n* Next\n';
  for (const d of ['nil', 't', '"CLOCKING"', '"LOGBOOK"', '"logbook"', '0', '1', '2', '3', '4']) {
    for (const base of ['plain', 'body', 'planning', 'planBody', 'oneClock', 'bareClock', 'twoClocks', 'twoBare', 'bareAfterText', 'planClock', 'logbook', 'props', 'propsBody', 'clockAndNote', 'clockingDrawer', 'bothDrawers', 'otherDrawer', 'child', 'nextHeading']) {
      out.push({
        kind: 'clock', name: `org-clock-into-drawer ${d} in ${base}`, org: ctx[/** @type {keyof typeof ctx} */ (base)], start: starts[0], span: 30, drawer: d,
        lisp: `(let ((org-clock-persist nil) (org-clock-into-drawer ${d})) (unwind-protect (progn ${find} (org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], 30)}) (buffer-string)) (oc-reset)))`,
      });
    }
  }
  // the CLOCK_INTO_DRAWER property overrides the variable, and is inherited
  for (const [pv, d] of [['nil', 't'], ['t', 'nil'], ['CLOCKING', 'nil'], ['2', 't'], ['1', 'nil'], ['nil', '"CLOCKING"']]) {
    for (const where of ['own', 'parent']) {
      const org = where === 'own' ? `* TODO Task\n:PROPERTIES:\n:CLOCK_INTO_DRAWER: ${pv}\n:END:\n` : `* Parent\n:PROPERTIES:\n:CLOCK_INTO_DRAWER: ${pv}\n:END:\n** TODO Task\n`;
      out.push({
        kind: 'clock', name: `CLOCK_INTO_DRAWER ${pv} (${where}) with variable ${d}`, org, start: starts[0], span: 30, drawer: d, prop: pv,
        lisp: `(let ((org-clock-persist nil) (org-clock-into-drawer ${d})) (unwind-protect (progn ${find} (org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], 30)}) (buffer-string)) (oc-reset)))`,
      });
    }
  }
  // 5. org-log-into-drawer set (clock lines follow it when org-clock-into-drawer is t or a number)
  for (const base of ['plain', 'oneClock', 'logbook', 'bareClock']) {
    for (const [ld, d] of [['t', 't'], ['"NOTES"', 't'], ['"NOTES"', '1'], ['"NOTES"', '2'], ['"NOTES"', 'nil'], ['"NOTES"', '"CLOCKING"'], ['nil', 't']]) {
      out.push({
        kind: 'clock', name: `org-log-into-drawer ${ld} with clock-into-drawer ${d} in ${base}`, org: ctx[/** @type {keyof typeof ctx} */ (base)], start: starts[0], span: 30, logDrawer: ld, drawer: d,
        lisp: `(let ((org-clock-persist nil) (org-log-into-drawer ${ld}) (org-clock-into-drawer ${d})) (unwind-protect (progn ${find} (org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], 30)}) (buffer-string)) (oc-reset)))`,
      });
    }
  }
  // 6. clocking a second heading while the first runs (the first is clocked out at the same moment)
  out.push({
    kind: 'clockswitch', name: 'clock in on a second heading clocks the first out', org: '* TODO One\n* TODO Two\n', start: starts[0], at: '2026-10-11 10:15',
    lisp: `(let ((org-clock-persist nil)) (unwind-protect (progn (goto-char (point-min)) (org-clock-in nil ${startStamp(starts[0])}) (re-search-forward "^\\\\* TODO Two") (beginning-of-line) (org-clock-in nil) (buffer-string)) (oc-reset)))`,
  });
  out.push({
    kind: 'clockswitch', name: 'clock in on a second heading with clocks on both', org: '* TODO One\n:LOGBOOK:\nCLOCK: [2026-10-09 Fri 09:00]--[2026-10-09 Fri 10:00] =>  1:00\n:END:\n* TODO Two\n:LOGBOOK:\nCLOCK: [2026-10-09 Fri 11:00]--[2026-10-09 Fri 11:30] =>  0:30\n:END:\n', start: starts[0], at: '2026-10-11 10:15',
    lisp: `(let ((org-clock-persist nil)) (unwind-protect (progn (goto-char (point-min)) (org-clock-in nil ${startStamp(starts[0])}) (re-search-forward "^\\\\* TODO Two") (beginning-of-line) (org-clock-in nil) (buffer-string)) (oc-reset)))`,
  });
  // 7. a state change on clock out
  const switchOrgs = {
    todo: '#+TODO: TODO NEXT | DONE\n* TODO Task\n', next: '#+TODO: TODO NEXT | DONE\n* NEXT Task\n', done: '#+TODO: TODO NEXT | DONE\n* DONE Task\n',
    none: '#+TODO: TODO NEXT | DONE\n* Task\n', two: '#+TODO: TODO NEXT | DONE\n#+TODO: A B | C\n* A Task\n', logged: '#+TODO: TODO(t) NEXT(n!) | DONE(d@)\n* TODO Task\n',
    lognote: '#+STARTUP: lognotedone\n#+TODO: TODO NEXT | DONE\n* TODO Task\n', logdone: '#+STARTUP: logdone\n#+TODO: TODO NEXT | DONE\n* TODO Task\n', plainSeq: '* TODO Task\n', repeater: '* TODO Task\nSCHEDULED: <2026-10-05 Mon +1w>\n',
  };
  for (const [sn, org] of Object.entries(switchOrgs)) {
    for (const state of ['"DONE"', '"NEXT"', '"TODO"', '"C"', 'nil']) {
      out.push({
        kind: 'clock', name: `org-clock-out-switch-to-state ${state} on ${sn}`, org, start: starts[0], span: 30, switchTo: state,
        lisp: `(let ((org-clock-persist nil) (org-clock-out-switch-to-state ${state}) (org-use-fast-todo-selection nil)) (unwind-protect (progn ${find} (org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], 30)}) (buffer-string)) (oc-reset)))`,
      });
    }
  }
  // 8. org-clock-out-remove-zero-time-clocks
  for (const base of ['plain', 'body', 'planning', 'props', 'oneClock', 'bareClock', 'logbook', 'twoClocks', 'nextHeading']) {
    for (const [span, d] of [[0, 't'], [1, 't'], [0, 'nil'], [0, '"CLOCKING"'], [0, '2']]) {
      out.push({
        kind: 'clock', name: `remove-zero-time-clocks span ${span} (drawer ${d}) in ${base}`, org: ctx[/** @type {keyof typeof ctx} */ (base)], start: starts[0], span, removeZero: true, drawer: d,
        lisp: `(let ((org-clock-persist nil) (org-clock-into-drawer ${d}) (org-clock-out-remove-zero-time-clocks t)) (unwind-protect (progn ${find} (org-clock-in nil ${startStamp(starts[0])}) (org-clock-out nil nil ${lt(starts[0], span)}) (buffer-string)) (oc-reset)))`,
      });
    }
  }
}

// ---------------------------------------------------------------- org-duration
function durationCases(/** @type {Case[]} */ out) {
  const texts = [
    '', '0', '1', '45', '90', '1.5', '0.5', '-5', '1:30', '0:05', '12:00', '100:30', '1:30:30', '0:0:30', '1h', '2h', '2.35h', '1.5h', '45min', '45m', '90min', '1d', '1d 3h', '1d 3h 15min', '3h 15min', '1w', '2w 1d', '1m', '1y', '1y 2m', '1h30min', '1 h 30 min', '1H', '1D', '1day', '2hours', '30 minutes', '1:30h', 'abc', '1x', '1:', ':30', '1:60', '1:99', '1.5.2h', '1,5h', '.5h', '5.h', '+3h', '3h+', '1d2h', '10 min 5 h', '1h 1h', '1:30 2h', '  2h  ', '2 h', '2\t h', '1e2', '0x10', '００', '1_000', '1h 30', '24:00', '48:30', '0.0001h', '1000d', '1d 1d', '9999999', '1:1', '01:05', '0:00', '00:00:00', '2:5', '2h 5', '1.25d', '0.25w', '.25', '1/2', '1/2h',
  ];
  for (const t of texts) {
    out.push({ kind: 'duration-to-minutes', name: `org-duration-to-minutes ${JSON.stringify(t)}`, org: '', text: t, lisp: `(condition-case e (let ((r (org-duration-to-minutes ${JSON.stringify(t)}))) (format "%S" r)) (error (concat "ERROR " (error-message-string e))))` });
  }
  const minutes = [0, 1, 5, 9, 10, 59, 60, 61, 90, 119, 120, 125, 599, 600, 1439, 1440, 1441, 1500, 2879, 2880, 3000, 6001, 10000, 60000, 100000];
  for (const m of minutes) {
    out.push({ kind: 'duration-from-minutes', name: `org-duration-from-minutes ${m}`, org: '', minutes: m, lisp: `(condition-case e (org-duration-from-minutes ${m} 'h:mm) (error (concat "ERROR " (error-message-string e))))` });
  }
}

// ---------------------------------------------------------------- scheduling and deadlines
function planningCases(/** @type {Case[]} */ out) {
  const existing = [
    '', 'SCHEDULED: <2026-10-05 Mon>', 'SCHEDULED: <2026-10-05 Mon 09:00>', 'SCHEDULED: <2026-10-05 Mon 09:00-10:30>', 'SCHEDULED: <2026-10-05 Mon +1w>', 'SCHEDULED: <2026-10-05 Mon ++1d>', 'SCHEDULED: <2026-10-05 Mon .+2d/3d>',
    'SCHEDULED: <2026-10-05 Mon 09:00 +1w -2d>', 'DEADLINE: <2026-10-20 Tue -3d>', 'DEADLINE: <2026-10-20 Tue +1m -3d>', 'DEADLINE: <2026-10-20 Tue 17:00>', 'DEADLINE: <2026-10-20 Tue> SCHEDULED: <2026-10-05 Mon>',
    'CLOSED: [2026-10-10 Sat 10:00] SCHEDULED: <2026-10-05 Mon>', 'SCHEDULED: <2026-10-05 Mon +1w> DEADLINE: <2026-10-20 Tue ++1w>',
  ];
  const picks = ['2026-10-25', '2026-12-31', '2026-02-28', '2024-02-29', '2026-10-11']; // the app's date picker has no time to give
  for (const e of existing) {
    for (const kind of ['SCHEDULED', 'DEADLINE']) {
      for (const p of picks) {
        out.push({
          kind: 'planning', name: `org-${kind === 'SCHEDULED' ? 'schedule' : 'deadline'} ${p} over ${JSON.stringify(e)}`, org: `* TODO Task\n${e ? e + '\n' : ''}Body text\n`, which: kind, pick: p,
          lisp: `(progn (goto-char (point-min)) (let ((inhibit-message t) (message-log-max nil)) (${kind === 'SCHEDULED' ? 'org-schedule' : 'org-deadline'} nil ${JSON.stringify(p)})) (buffer-string))`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------- clock tables
function clocktableCases(/** @type {Case[]} */ out) {
  const org =
    '* Project Alpha\n:PROPERTIES:\n:CATEGORY: alpha\n:END:\n** Task 1 :work:\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 11:00] =>  2:00\nCLOCK: [2026-08-09 Sun 09:00]--[2026-08-09 Sun 09:45] =>  0:45\n:END:\n' +
    '** Task 2 [[https://example.com][link]]\n:LOGBOOK:\nCLOCK: [2026-08-02 Sun 14:00]--[2026-08-02 Sun 16:15] =>  2:15\n:END:\n*** Deep :work:\n:LOGBOOK:\nCLOCK: [2026-08-02 Sun 17:00]--[2026-08-02 Sun 17:30] =>  0:30\n:END:\n**** Deeper\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 08:00]--[2026-08-03 Mon 08:20] =>  0:20\n:END:\n' +
    '* Administrative\n:LOGBOOK:\nCLOCK: [2026-08-04 Tue 09:00]--[2026-08-04 Tue 09:10] =>  0:10\n:END:\n** Team meeting\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 10:00]--[2026-08-03 Mon 11:30] =>  1:30\n:END:\n* Running\n:LOGBOOK:\nCLOCK: [2026-08-05 Wed 09:00]\n:END:\n* Empty\n';
  const paramsList = [
    ':maxlevel 1', ':maxlevel 2', ':maxlevel 3', ':maxlevel 4', ':maxlevel 9', ':maxlevel 0',
    ':maxlevel 2 :tstart "2026-08-01" :tend "2026-08-07"', ':maxlevel 2 :tstart "2026-08-02" :tend "2026-08-03"', ':maxlevel 3 :tstart "2026-08-01 10:00" :tend "2026-08-02 15:00"', ':tstart "2026-08-02"', ':tend "2026-08-03"',
    ':maxlevel 2 :tstart "2026-08-03" :tend "2026-08-03"', ':maxlevel 2 :tstart "2026-09-01" :tend "2026-09-30"', ':maxlevel 2 :tstart "2026-08-04 09:05" :tend "2026-08-04 09:08"',
    ':scope file', ':scope tree', ':scope subtree', ':scope file-with-archives',
    ':maxlevel 2 :hidefiles t', ':maxlevel 2 :compact t', ':maxlevel 3 :compact t', ':maxlevel 2 :link t', ':maxlevel 2 :tags t', ':maxlevel 2 :tags "work"', ':maxlevel 2 :match "work"', ':maxlevel 2 :narrow 10!', ':maxlevel 2 :narrow 20',
    ':maxlevel 2 :formula %', ':maxlevel 2 :formula "$2*2"', ':maxlevel 2 :properties ("CATEGORY")', ':maxlevel 2 :properties ("CATEGORY" "FOO")', ':maxlevel 2 :indent nil', ':maxlevel 2 :emphasize t', ':maxlevel 2 :level t',
    ':maxlevel 2 :step day :tstart "2026-08-01" :tend "2026-08-05"', ':maxlevel 2 :step week :tstart "2026-08-01" :tend "2026-08-15"', ':maxlevel 2 :block 2026-08', ':maxlevel 2 :block 2026', ':maxlevel 2 :block 2026-W32', ':maxlevel 2 :block 2026-08-03',
    ':maxlevel 2 :stepskip0 t :step day :tstart "2026-08-01" :tend "2026-08-06"', ':maxlevel 2 :fileskip0 t', ':maxlevel 2 :timestamp t', ':maxlevel 2 :tcolumns 2', ':maxlevel 2 :wstart 1', ':maxlevel 2 :mstart 1',
  ];
  for (const p of paramsList) out.push({ kind: 'clocktable', name: `clocktable ${p}`, org, params: p });
  // blocks, ranges and steps over clocks around "now" (2026-10-11 16:30)
  const clk = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ dur) => `:LOGBOOK:\nCLOCK: [${a}]--[${b}] =>  ${dur}\n:END:\n`;
  const nowOrg =
    `* Today\n${clk('2026-10-11 Sun 09:00', '2026-10-11 Sun 10:30', '1:30')}* Yesterday\n${clk('2026-10-10 Sat 14:00', '2026-10-10 Sat 15:00', '1:00')}* This week\n${clk('2026-10-06 Tue 08:00', '2026-10-06 Tue 08:45', '0:45')}` +
    `* Last week\n${clk('2026-09-30 Wed 10:00', '2026-09-30 Wed 12:00', '2:00')}* Last month\n${clk('2026-09-20 Sun 09:00', '2026-09-20 Sun 09:20', '0:20')}* Q3\n${clk('2026-07-15 Wed 09:00', '2026-07-15 Wed 11:00', '2:00')}` +
    `* Q2\n${clk('2026-04-10 Fri 09:00', '2026-04-10 Fri 09:10', '0:10')}* Last year\n${clk('2025-12-31 Wed 23:00', '2026-01-01 Thu 01:00', '2:00')}* Midnight\n${clk('2026-10-04 Sun 23:30', '2026-10-05 Mon 00:30', '1:00')}* Last\n`;
  const absDay = (/** @type {string} */ iso) => {
    const d = new Date(Date.UTC(2000, 0, 1));
    d.setUTCFullYear(1, 0, 1);
    return Math.round((Date.parse(iso + 'T00:00:00Z') - d.getTime()) / 86400000) + 1;
  };
  const rangeParams = [
    ':block today', ':block yesterday', ':block thisweek', ':block lastweek', ':block thismonth', ':block lastmonth', ':block thisyear', ':block lastyear', ':block untilnow', ':block thisq', ':block lastq',
    ':block quarter', ':block thisq-1', ':block thisq-2', ':block thisq-3', ':block quarter-1', ':block 2026-Q3', ':block 2026-Q2', ':block 2026-q4', ':block today-1', ':block today-5', ':block today+1', ':block thisweek-1', ':block thisweek-2', ':block thisweek+1',
    ':block thismonth-1', ':block thismonth-2', ':block thismonth+1', ':block thisyear-1', ':block yesterday-1', ':block lastweek-1', ':block 2026', ':block 2025', ':block 2026-10', ':block 2026-09', ':block 2026-9', ':block 2026-W41', ':block 2026-w40', ':block 2026-W1',
    ':block 2026-10-11', ':block 2026-10-4', ':block bogus', ':block thisquarter', ':block thisweek :wstart 0', ':block thisweek :wstart 3', ':block thisweek :wstart 6', ':block thisweek :wstart 7', ':block lastweek :wstart 0', ':block thismonth :mstart 5', ':block thismonth :mstart 15', ':block lastmonth :mstart 10', ':block 2026-10 :mstart 3', ':block 2026-W41 :wstart 4',
    ':block nil', ':block today :tstart "2026-01-01"',
    ':tstart "<now>"', ':tstart "<today>"', ':tend "<today>"', ':tend "<tomorrow>"', ':tstart "<yesterday>" :tend "<today>"', ':tstart "<-1w>"', ':tstart "<-2d>" :tend "<+1d>"', ':tstart "<-1m>"', ':tstart "<-6h>"', ':tstart "<-1y>"', ':tstart "<2026-10-05 Mon>" :tend "<2026-10-12 Mon>"',
    ':tstart "2026-10-05 Mon" :tend "2026-10-12"', ':tstart "2026-10-05 09:00" :tend "2026-10-11 10:00"', ':tstart "2026-10-11 9:30" :tend "2026-10-11 10:00"', ':tstart "[2026-10-05]"', ':tstart "foo"', ':tstart ""', ':tend ""', ':tstart "2026-10-1"', ':tend "2026-10-11 09:45"',
    `:tstart ${absDay('2026-10-05')} :tend ${absDay('2026-10-08')}`, ':tstart "2026-10-05" :tend "2026-10-05"', ':tstart "2026-10-08" :tend "2026-10-05"',
    ':step day :tstart "2026-10-08" :tend "2026-10-12"', ':step week :tstart "2026-09-28" :tend "2026-10-12"', ':step week :tstart "2026-09-28" :tend "2026-10-12" :wstart 0', ':step week :tstart "2026-09-28" :tend "2026-10-12" :wstart 3', ':step month :tstart "2026-07-01" :tend "2026-11-01"', ':step month :tstart "2026-07-10" :tend "2026-11-01" :mstart 10',
    ':step year :tstart "2025-01-01" :tend "2027-01-01"', ':step quarter :tstart "2026-01-01" :tend "2026-12-31"', ':step semimonth :tstart "2026-09-10" :tend "2026-10-20"',
    ':step day :block thisweek', ':step day :block lastweek :stepskip0 t', ':step week :block thismonth', ':step week :block lastmonth :stepskip0 t', ':step month :block thisyear', ':step month :block thisyear :stepskip0 t', ':step day :block 2026-10-11', ':step week :block 2026-W41', ':step quarter :block thisyear', ':step day :block today-3 :stepskip0 t',
    ':step day :stepskip0 t :tstart "2026-10-01" :tend "2026-10-12"', ':step day :tstart "2026-10-05" :tend "2026-10-09" :link t :tags t', ':step bogus :tstart "2026-10-05" :tend "2026-10-09"', ':step day', ':step day :tstart "2026-10-05"', ':step day :tend "2026-10-05"', ':step week :block untilnow', ':step year :block untilnow :stepskip0 t',
    ':maxlevel 1 :step day :tstart "2026-10-10" :tend "2026-10-12"', ':step day :tstart "2026-10-10" :tend "2026-10-12" :formula %', ':step day :tstart "2026-10-10" :tend "2026-10-12" :level t :compact t', ':step week :tstart "2026-10-05" :tend "2026-10-12" :header "#+CAPTION: x\\n"',
  ];
  for (const p of rangeParams) out.push({ kind: 'clocktable', name: `clocktable now ${p}`, org: nowOrg, params: p });
  // scope: the block lives in the last heading
  const deepOrg = `* A\n${clk('2026-10-01 Thu 09:00', '2026-10-01 Thu 10:00', '1:00')}** B\n${clk('2026-10-02 Fri 09:00', '2026-10-02 Fri 09:30', '0:30')}*** C\n${clk('2026-10-03 Sat 09:00', '2026-10-03 Sat 09:15', '0:15')}**** D\n${clk('2026-10-04 Sun 09:00', '2026-10-04 Sun 09:05', '0:05')}`;
  const twoTops = `* First\n${clk('2026-10-01 Thu 09:00', '2026-10-01 Thu 10:00', '1:00')}* Second\n${clk('2026-10-02 Fri 09:00', '2026-10-02 Fri 09:30', '0:30')}** Child\n${clk('2026-10-03 Sat 09:00', '2026-10-03 Sat 09:15', '0:15')}`;
  for (const [nm, o] of [['deep', deepOrg], ['two', twoTops]]) {
    for (const sc of ['file', 'tree', 'subtree', 'tree1', 'tree2', 'tree3', 'tree9', 'tree0', 'file-with-archives', 'nil', 'bogus', 'agenda', 'agenda-with-archives', 'treex']) out.push({ kind: 'clocktable', name: `clocktable scope ${sc} in ${nm}`, org: o, params: `:maxlevel 4 :scope ${sc}` });
  }
  // more than one file
  const org2 = `#+TITLE: The other file\n* Elsewhere\n${clk('2026-10-05 Mon 09:00', '2026-10-05 Mon 10:00', '1:00')}** Deeper\n${clk('2026-10-06 Tue 09:00', '2026-10-06 Tue 09:20', '0:20')}* Idle\n`;
  const org1 = `#+TITLE: The first file\n* Here\n${clk('2026-10-05 Mon 14:00', '2026-10-05 Mon 14:40', '0:40')}** Sub :t:\n${clk('2026-10-07 Wed 09:00', '2026-10-07 Wed 09:30', '0:30')}* Nothing\n`;
  const multi = [
    ':scope agenda', ':scope agenda-with-archives', ':scope agenda :maxlevel 3', ':scope agenda :hidefiles t', ':scope agenda :fileskip0 t', ':scope agenda :filetitle t', ':scope agenda :level t', ':scope agenda :tags t', ':scope agenda :timestamp t', ':scope agenda :properties ("CATEGORY")',
    ':scope agenda :formula %', ':scope agenda :compact t', ':scope agenda :emphasize t', ':scope agenda :link t', ':scope agenda :tcolumns 1', ':scope agenda :maxlevel 1', ':scope agenda :maxlevel 0', ':scope agenda :tstart "2026-10-06"', ':scope agenda :tstart "2026-12-01"', ':scope agenda :tstart "2026-10-06" :fileskip0 t',
    ':scope agenda :step day :tstart "2026-10-05" :tend "2026-10-08"', ':scope agenda :block 2026-10 :fileskip0 t :filetitle t', ':scope agenda :narrow 10!', ':scope agenda :narrow 30', ':scope agenda :match "t"', ':scope agenda :level t :tags t :timestamp t :properties ("CATEGORY" "TODO") :formula %', ':scope agenda :indent nil', ':scope agenda :lang de',
    ':scope file', ':scope subtree',
  ];
  for (const p of multi) out.push({ kind: 'clocktable', name: `clocktable two files ${p}`, org: org1, org2, params: p });
  // content of headings: tags, TODO, properties, timestamps
  const richOrg =
    `#+FILETAGS: :ft:\n* TODO [#A] Alpha [1/2] :a:b:\nSCHEDULED: <2026-10-12 Mon>\n:PROPERTIES:\n:FOO: parent\n:CATEGORY: cat1\n:END:\n${clk('2026-10-01 Thu 09:00', '2026-10-01 Thu 10:00', '1:00')}** NEXT Beta :c:\nDEADLINE: <2026-10-20 Tue>\n:PROPERTIES:\n:BAR: 1\n:END:\n${clk('2026-10-02 Fri 09:00', '2026-10-02 Fri 09:30', '0:30')}Some text <2026-11-01 Sun> and [2026-10-01 Thu]\n` +
    `*** Gamma [50%]\nText <2026-12-25 Fri>\n${clk('2026-10-03 Sat 09:00', '2026-10-03 Sat 09:15', '0:15')}* DONE Delta :d:\nCLOSED: [2026-10-04 Sun 10:00]\n${clk('2026-10-04 Sun 09:00', '2026-10-04 Sun 09:45', '0:45')}* COMMENT Epsilon\n${clk('2026-10-05 Mon 09:00', '2026-10-05 Mon 09:10', '0:10')}* [[https://x.org][Linked]] heading\n${clk('2026-10-06 Tue 09:00', '2026-10-06 Tue 09:12', '0:12')}* [[https://x.org][Only a link]]\n${clk('2026-10-07 Wed 09:00', '2026-10-07 Wed 09:03', '0:03')}* Last\n`;
  const rich = [
    ':maxlevel 3', ':maxlevel 3 :tags t', ':maxlevel 3 :level t', ':maxlevel 3 :timestamp t', ':maxlevel 3 :link t', ':maxlevel 3 :link t :compact t', ':maxlevel 3 :link t :narrow 12!', ':maxlevel 3 :narrow 12!', ':maxlevel 3 :narrow 12', ':maxlevel 3 :narrow 12 :link t', ':maxlevel 3 :narrow 5!', ':maxlevel 3 :narrow 0!', ':maxlevel 3 :narrow 3!',
    ':maxlevel 3 :properties ("FOO")', ':maxlevel 3 :properties ("FOO" "BAR")', ':maxlevel 3 :properties ("FOO") :inherit-props t', ':maxlevel 3 :properties ("BAR") :inherit-props t', ':maxlevel 3 :properties ("CATEGORY" "TODO" "PRIORITY" "ITEM" "TAGS" "ALLTAGS" "FILE")', ':maxlevel 3 :properties ("SCHEDULED" "DEADLINE" "CLOSED" "TIMESTAMP" "TIMESTAMP_IA")', ':maxlevel 3 :properties ("foo")', ':maxlevel 3 :properties ()',
    ':maxlevel 3 :match "a"', ':maxlevel 3 :match "a|c"', ':maxlevel 3 :match "a+b"', ':maxlevel 3 :match "-a"', ':maxlevel 3 :match "ft"', ':maxlevel 3 :match "TODO=\\"NEXT\\""', ':maxlevel 3 :match "TODO=\\"DONE\\"|c"', ':maxlevel 3 :match "LEVEL=2"', ':maxlevel 3 :match "LEVEL>1"', ':maxlevel 3 :match "{^[ab]$}"', ':maxlevel 3 :match "FOO=\\"parent\\""', ':maxlevel 3 :match "PRIORITY=\\"A\\""', ':maxlevel 3 :match ""', ':maxlevel 3 :match nil', ':maxlevel 3 :match "nothing"', ':maxlevel 3 :match "a" :tags t', ':maxlevel 3 :match "c" :level t',
    ':maxlevel 3 :emphasize t :level t :tags t', ':maxlevel 3 :indent nil :level t', ':maxlevel 3 :indent t', ':maxlevel 3 :level t :compact t', ':maxlevel 3 :tcolumns 0', ':maxlevel 3 :tcolumns 1', ':maxlevel 3 :tcolumns 2', ':maxlevel 3 :tcolumns 3', ':maxlevel 3 :tcolumns 9', ':maxlevel 9', ':maxlevel 1 :tcolumns 3', ':maxlevel 2 :tcolumns 2', ':maxlevel nil', ':maxlevel -1', ':maxlevel 3 :formula %', ':maxlevel 3 :formula % :level t', ':maxlevel 3 :formula "$2=$2" ', ':maxlevel 3 :formula "@>$2=vsum(@I..@II)"', ':maxlevel 3 :formula "$4=$2+1"', ':maxlevel 3 :formula t', ':maxlevel 3 :formula foo', ':maxlevel 3 :formula ""', ':maxlevel 3 :formula nil',
    ':maxlevel 3 :header "#+CAPTION: Mine\\n"', ':maxlevel 3 :header ""', ':maxlevel 3 :header nil', ':maxlevel 3 :lang de', ':maxlevel 3 :lang fr :level t :timestamp t', ':maxlevel 3 :lang es :tags t', ':maxlevel 3 :lang nl', ':maxlevel 3 :lang "DE"', ':maxlevel 3 :lang xx',
    ':maxlevel 3 :sort (1 . ?a)', ':maxlevel 3 :sort (1 . ?A)', ':maxlevel 3 :sort (2 . ?n)', ':maxlevel 3 :sort (2 . ?N)', ':maxlevel 3 :sort (2 . ?t)', ':maxlevel 3 :sort (2 . ?T)',
    ':maxlevel 3 :tags t :properties ("FOO") :level t :timestamp t', ':maxlevel 3 :compact t :tags t :properties ("FOO")', ':maxlevel 3 :tstart "2026-10-02" :tend "2026-10-05" :tags t', ':maxlevel 3 :scope subtree :tags t', ':maxlevel 3 :unknown 5', ':maxlevel 3 :narrow',
  ];
  for (const p of rich) out.push({ kind: 'clocktable', name: `clocktable rich ${p}`, org: richOrg, params: p });
  // heading shapes
  const shapes = [
    '* TODO [#A] Task [1/2] :a:\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n',
    '* Heading with *bold* and =code=\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n',
    '* Heading with a very long title that goes on and on and on and on and on and on and on and on and on\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n',
    '* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-02 Sun 09:00] =>  24:00\n:END:\n',
    '* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-04 Tue 11:30] =>  74:30\n:END:\n',
    '* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 09:00] =>  0:00\n:END:\n',
    '* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 09:01] =>  0:01\n:END:\n',
    '* A\n** B\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n* C\n** D\n*** E\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n',
    '* A\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n',
    '* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\nCLOCK: [2026-08-01 Sat 11:00]--[2026-08-01 Sat 12:00] =>  1:00\n:END:\n* A\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 13:00]--[2026-08-01 Sat 13:30] =>  0:30\n:END:\n',
    '* Zeta\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 10:00] =>  1:00\n:END:\n* Alpha\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 12:00] =>  3:00\n:END:\n',
  ];
  shapes.forEach((s, i) => {
    for (const p of [':maxlevel 2', ':maxlevel 3 :tstart "2026-08-01" :tend "2026-08-02"', ':maxlevel 3 :link t', ':maxlevel 3 :tags t :level t :narrow 20!']) out.push({ kind: 'clocktable', name: `clocktable shape ${i} ${p}`, org: s, params: p });
  });
}
