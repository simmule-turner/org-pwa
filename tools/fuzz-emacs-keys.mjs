#!/usr/bin/env node
/**
 * Random key sequences against Emacs 29.3: makes random texts, carets, marks, kill rings and key sequences (motions, kills, yanks, the region,
 * prefix arguments, typed characters, undo, C-q, the Org keys), runs each in Emacs and in the app's own key reader and command runner, and
 * reports where they differ, each shrunk to the shortest keys and text that still differ. Sequences the app says it does not do yet
 * ("... is not available yet") are counted apart, as are the known gaps.
 *
 *   node tools/fuzz-emacs-keys.mjs [--seed N] [--count N] [--max-keys N] [--shrink N]      (needs emacs on the PATH)
 *
 * The seed is printed; the same seed makes the same cases. Failures are also written to /tmp/fuzz-failures.json.
 */
import fs from 'node:fs';
import { runEmacs, sameAsEmacs, typeKeys } from './emacs-keys-lib.mjs';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const seed = option('seed', Math.floor(Math.random() * 1e9));
const count = option('count', 3000);
const from = option('from', 0); // skip the first N cases of the seed, so a later stage runs new ones
const maxKeys = option('max-keys', 8);
const shrinkLimit = option('shrink', 12);

/** @param {number} a a small, seedable random generator */
const mulberry = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry(seed);
const int = (/** @type {number} */ n) => Math.floor(rnd() * n);
const pick = (/** @type {any[]} */ list) => list[int(list.length)];
/** @param {[any, number][]} weighted */
const weighted = (weighted) => {
  let r = rnd() * weighted.reduce((n, [, w]) => n + w, 0);
  for (const [v, w] of weighted) if ((r -= w) < 0) return v;
  return weighted[0][0];
};

// ---- texts
const WORDS = ['foo', 'bar', 'baz', 'Hello,', 'world.', "don't", 'stop_me', 'x.y', 'a-b', 'été', 'Ünï', '日本語', 'words', '*bold*', '/it/', '=v=', 'a', 'I', 'TODO', 'DONE', '1.', '2)'];
const word = () => pick(WORDS);
const line = () => {
  const kind = weighted([['plain', 5], ['heading', 2], ['item', 2], ['table', 2], ['rule', 0.5], ['blank', 1.5], ['indent', 1], ['src', 0.3], ['drawer', 0.3], ['keyword', 0.3]]);
  const words = (/** @type {number} */ n) => Array.from({ length: n }, word).join(pick([' ', ' ', ' ', '  ', '\t']));
  switch (kind) {
    case 'heading': return `${'*'.repeat(1 + int(3))} ${rnd() < 0.4 ? `${pick(['TODO', 'DONE'])} ` : ''}${words(1 + int(3))}${rnd() < 0.3 ? ` :${pick(['a', 'tag', 'x'])}:` : ''}`;
    case 'item': return `${' '.repeat(int(3) * 2)}${pick(['- ', '+ ', '1. ', '2) '])}${rnd() < 0.4 ? pick(['[ ] ', '[X] ']) : ''}${words(1 + int(3))}`;
    case 'table': return `| ${Array.from({ length: 1 + int(3) }, () => (rnd() < 0.2 ? '' : word())).join(' | ')} |`;
    case 'rule': return '|---+---|';
    case 'blank': return rnd() < 0.5 ? '' : '  ';
    case 'indent': return `  ${words(1 + int(3))}`;
    case 'src': return pick(['#+begin_src text', '#+end_src', '#+begin_example']);
    case 'drawer': return pick([':PROPERTIES:', ':END:', ':A: b']);
    case 'keyword': return pick(['#+TITLE: x', '#+TBLFM: $2=$1']);
    default: return words(1 + int(5));
  }
};
const makeText = () => {
  if (rnd() < 0.05) return '';
  const lines = Array.from({ length: 1 + int(8) }, line);
  return lines.join('\n') + (rnd() < 0.6 ? '\n' : '');
};

// ---- keys
const MOTIONS = ['C-f', 'C-b', 'C-n', 'C-p', 'C-a', 'C-e', 'M-f', 'M-b', 'M-<', 'M->', 'M-a', 'M-e', 'C-c C-n', 'C-c C-p', 'C-c C-f', 'C-c C-b', 'C-c C-u'];
const EDITS = ['C-d', 'DEL', 'M-d', 'M-DEL', 'C-k', 'C-w', 'M-w', 'C-y', 'C-o', 'C-t', 'M-t', 'M-u', 'M-l', 'M-c', 'M-\\', 'M-m', 'M-SPC', 'C-x C-o'];
// M-y only follows a yank: elsewhere Emacs asks for a kill in the minibuffer and waits
const YANKS = ['C-y M-y', 'C-y M-y M-y'];
const REGION = ['C-SPC', 'C-x C-x', 'C-x h'];
const UNDO = ['C-/', 'C-?', 'C-_', 'C-x u'];
const ORG = ['M-<up>', 'M-<down>', 'M-<left>', 'M-<right>', 'C-c C-t', 'C-c C-x C-b'];
const CHARS = ['a', 'b', 'x', 'Z', '1', ' ', 'SPC', '.', ',', '-', '*', '|', ':', '[', '_', 'é', '日'];
const PREFIX = ['C-u', 'C-u C-u', 'M-1', 'M-2', 'M-3', 'M-5', 'M-0', 'M--', 'C-u 3', 'C-u 12', 'C-u -', 'C-u - 2', 'M-- 2'];
const key = () => weighted([
  [() => pick(MOTIONS), 6], [() => pick(EDITS), 6], [() => pick(YANKS), 1], [() => pick(REGION), 2], [() => pick(UNDO), 2], [() => pick(ORG), 2],
  [() => pick(CHARS), 5], [() => `C-q ${pick(['a', 'C-a', 'TAB', 'SPC'])}`, 0.3],
])();
const makeKeys = () => {
  const parts = [];
  for (let n = 1 + int(maxKeys); n > 0; n--) parts.push(rnd() < 0.1 ? `${pick(PREFIX)} ${key()}` : key());
  return parts.join(' ');
};
const makeCase = () => {
  const text = makeText();
  const spots = [...Array(text.length + 1).keys()].filter((i) => !/[\udc00-\udfff]/.test(text[i] ?? ''));
  const pos = pick(spots);
  const mark = rnd() < 0.25 ? pick(spots) : undefined;
  const kill = Array.from({ length: int(4) }, () => pick(['k1', 'two words', 'line\nbreak', '* H\n', '', 'x']));
  return { text, pos, ...(mark === undefined ? {} : { mark }), keys: makeKeys(), kill };
};

// ---- comparing
/** @param {any} c @param {any} e @returns {{ kind: 'same' | 'mismatch' | 'unimplemented' | 'known' | 'crash', note?: string, got?: any }} */
function judge(c, e) {
  let got;
  try {
    got = typeKeys(c);
  } catch (err) {
    return { kind: 'crash', note: /** @type {Error} */ (err).message.split('\n')[0] };
  }
  if (sameAsEmacs(got, e)) return { kind: 'same', got };
  const m = got.error && /(not available yet|is not available|is undefined|does not take a prefix argument yet)$/.exec(got.error);
  if (m && (e.error === 'null' || /M-(up|down) here is not available yet/.test(got.error ?? ''))) return { kind: 'unimplemented', note: got.error.replace(/\d+/g, 'N'), got };
  if (/(^|\n)\*+ .*:\w+:\s*$/m.test(c.text) && /(^| )(?:[a-zA-Z0-9.,*|:[_é日-]|SPC)( |$)/.test(c.keys.replace(/C-q \S+|M-\S+|C-\S+/g, ''))) return { kind: 'known', note: 'a typed character in a heading with tags (org-self-insert-command)', got };
  // known gaps (ROADMAP.org): C-c C-t on the headings of an active region, and C-/ with the region active (Emacs undoes inside it)
  if (c.keys.includes('C-c C-t') && /(^|\n)\*+ +(\n|$)/.test(c.text)) return { kind: 'known', note: 'C-c C-t on a heading with no title', got };
  if (c.keys.includes('C-c C-t') && (c.mark !== undefined || /C-SPC|C-x C-x|C-x h/.test(c.keys))) return { kind: 'known', note: 'C-c C-t with the region active (org-todo on each heading in it)', got };
  if (e.error === 'No further undo information for region' || (e.active === 't' && /C-[/_?]|C-x u|C-M-_/.test(c.keys))) return { kind: 'known', note: 'undo with the region active (undo in region)', got };
  if (/M-<(left|right)>/.test(c.keys) && (c.mark !== undefined || /C-SPC|C-x C-x|C-x h/.test(c.keys))) return { kind: 'known', note: 'M-left and M-right with the region active (headings or items in it)', got };
  if (/^[ \t]*\|/m.test(c.text) && /(^| )(?:[a-zA-Z0-9.,*|:[_é日-]|SPC)( |$)/.test(c.keys.replace(/C-q \S+|M-\S+|C-\S+/g, ''))) return { kind: 'known', note: 'a typed character in a table field (org-self-insert-command overwrites spare spaces)', got };
  if (/C-o|M-<(up|down|left|right)>/.test(c.keys) && /^[ \t]*\|[-+|]*\s*$/m.test(c.text) && !/[^|\-+\s]/.test(c.text)) return { kind: 'known', note: 'C-o and the M-arrows in a table made only of rules', got };
  if (/M-[ae]/.test(c.keys) && /^[ \t]*\|[-+|]*\s*$/m.test(c.text) && !/[^|\-+\s]/.test(c.text)) return { kind: 'known', note: 'M-a and M-e in a table made only of rules at the end of the buffer', got };
  if (/C-c C-x C-b/.test(c.keys) && /C-SPC|C-x C-x|C-x h/.test(c.keys + (c.mark !== undefined ? ' C-SPC' : ''))) return { kind: 'known', note: 'C-c C-x C-b with the region active (it toggles every item in it)', got };
  if (/(C-d|DEL)/.test(c.keys) && !c.text.endsWith('\n') && /(^|\n)[ \t]*\|[^\n]*$/.test(c.text)) return { kind: 'known', note: 'C-d or DEL in the last field of a table at the end of the buffer (spare space)', got };
  if (/(C-u -|M--)( \d+)* (C-\/|C-_|C-\?|C-x u)/.test(c.keys)) return { kind: 'known', note: 'undo with a negative prefix', got };
  if (/^Not at an item or heading, and no active region/.test(got.error ?? '') && /C-SPC|C-x C-x|C-x h/.test(c.keys + (c.mark !== undefined ? ' C-SPC' : ''))) return { kind: 'known', note: 'C-c C-x C-b with the region active (it toggles every item in it)', got };
  return { kind: 'mismatch', got };
}

// ---- shrinking
/** Fewer keys, fewer lines, fewer characters, no mark, a shorter kill ring: every one-step reduction of a case. @param {any} c */
function reductions(c) {
  /** @type {any[]} */
  const out = [];
  const tokens = c.keys.split(' ');
  for (let i = 0; i < tokens.length; i++) if (tokens.length > 1) out.push({ ...c, keys: tokens.filter((_, j) => j !== i).join(' ') });
  const cut = (/** @type {number} */ a, /** @type {number} */ b) => {
    const adjust = (/** @type {number} */ p) => (p <= a ? p : p >= b ? p - (b - a) : a);
    return { ...c, text: c.text.slice(0, a) + c.text.slice(b), pos: adjust(c.pos), ...(c.mark === undefined ? {} : { mark: adjust(c.mark) }) };
  };
  let at = 0;
  for (const l of c.text.split('\n')) {
    out.push(cut(at, Math.min(c.text.length, at + l.length + 1)));
    at += l.length + 1;
  }
  for (let i = 0; i < c.text.length; i++) if (!/[\ud800-\udfff]/.test(c.text[i])) out.push(cut(i, i + 1));
  if (c.mark !== undefined) {
    const { mark: _mark, ...rest } = c;
    out.push(rest);
  }
  for (let i = 0; i < c.kill.length; i++) out.push({ ...c, kill: c.kill.filter((_, j) => j !== i) });
  return out;
}

/** @param {any} c the smallest case that still differs from Emacs */
/** Keys that make Emacs wait for input: M-y with no yank just before it asks for a kill in the minibuffer. @param {string} keys */
const waits = (keys) => /(^| )(C-u|C-x|C-c|C-q|M--|M-\d+|C-u( -?\d+)+|M--? ?\d+)$/.test(keys) || /(^| )(C-u|M--?\d*)( -?\d+| -)+$/.test(keys) || keys.split(' ').some((k, i, all) => k === 'M-y' && !/^(C-y|M-y)$/.test(all[i - 1] ?? ''));

function shrink(c) {
  for (let round = 0; round < 40; round++) {
    const candidates = reductions(c).filter((x) => !waits(x.keys));
    if (!candidates.length) return c;
    const results = runEmacs(candidates);
    const i = candidates.findIndex((cand, k) => !(/** @type {any} */ (results[k]).hang) && judge(cand, results[k]).kind === 'mismatch');
    if (i < 0) return c;
    c = candidates[i];
  }
  return c;
}

// ---- the run
console.log(`seed ${seed}, ${count} cases, up to ${maxKeys} key groups`);
const cases = Array.from({ length: from + count }, makeCase).slice(from);
const expected = runEmacs(cases);
const tally = /** @type {Record<string, number>} */ ({});
/** @type {Record<string, number>} */ const notes = {};
const failing = [];
const hangs = [];
cases.forEach((c, i) => {
  if (/** @type {any} */ (expected[i]).hang) {
    tally.hang = (tally.hang ?? 0) + 1;
    hangs.push(c.keys);
    return;
  }
  const j = judge(c, expected[i]);
  tally[j.kind] = (tally[j.kind] ?? 0) + 1;
  if (j.note) notes[`${j.kind}: ${j.note}`] = (notes[`${j.kind}: ${j.note}`] ?? 0) + 1;
  if (j.kind === 'mismatch' || j.kind === 'crash') failing.push(c);
});
console.log('results', JSON.stringify(tally));
for (const [k, n] of Object.entries(notes).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

if (hangs.length) console.log(`Emacs waited for input (not compared): ${JSON.stringify([...new Set(hangs)].slice(0, 12))}`);
const reports = [];
const seen = new Set();
for (const c of failing) {
  if (reports.length >= shrinkLimit) break;
  const small = shrink(c);
  const sig = small.keys;
  if (seen.has(sig)) continue;
  seen.add(sig);
  const e = runEmacs([small])[0];
  let got;
  try {
    got = typeKeys(small);
  } catch (err) {
    got = { error: `crash: ${/** @type {Error} */ (err).message.split('\n')[0]}` };
  }
  reports.push({ case: small, ours: { text: got.text, pos: got.pos, mark: got.mark, kill: got.kill, error: got.error }, emacs: e });
}
for (const r of reports) {
  console.log('\n--- differs from Emacs');
  console.log(`keys  ${r.case.keys}`);
  console.log(`text  ${JSON.stringify(r.case.text)}  caret ${r.case.pos}${r.case.mark === undefined ? '' : `  mark ${r.case.mark}`}  kill ${JSON.stringify(r.case.kill)}`);
  console.log(`ours  ${JSON.stringify({ text: r.ours.text, pos: r.ours.pos, mark: r.ours.mark, kill: r.ours.kill, error: r.ours.error })}`);
  console.log(`emacs ${JSON.stringify({ text: r.emacs.text, pos: r.emacs.pos, mark: r.emacs.mark, kill: r.emacs.kill, error: r.emacs.error })}`);
}
fs.writeFileSync('/tmp/fuzz-failures.json', JSON.stringify(reports, null, 1));
console.log(`\n${failing.length} differing of ${count}; ${reports.length} distinct shrunk cases written to /tmp/fuzz-failures.json`);
process.exit(failing.length ? 1 : 0);
