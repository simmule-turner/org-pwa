import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILTIN_SEXP_NAMES, extensionsOn, hashScript, sexpArgToValue, userSexpKey, userSexpResult, usableSexpName, visibleVariableMap } from '../src/extensions.js';
import { evaluateSexpr, parseGeneralBodyLine, parseSexpr, setUserSexps } from '../src/sexp-eval.js';

afterEach(() => setUserSexps());

test('every function the evaluator handles is protected from being redefined', () => {
  const source = readFileSync(new URL('../src/sexp-eval.js', import.meta.url), 'utf8');
  const start = source.indexOf('function evaluateSexpr');
  const names = [...source.slice(start).matchAll(/case '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 15);
  for (const name of names) assert.ok(BUILTIN_SEXP_NAMES.has(name), `${name} is in BUILTIN_SEXP_NAMES`);
});

test('which names a script may register', () => {
  assert.equal(usableSexpName('my-moon-phase'), true);
  assert.equal(usableSexpName('diary-float'), false);
  assert.equal(usableSexpName('org-weather'), false);
  assert.equal(usableSexpName('9lives'), false);
  assert.equal(usableSexpName('has space'), false);
  assert.equal(usableSexpName(''), false);
  assert.equal(usableSexpName(42), false);
});

test('sexp arguments become plain values', () => {
  assert.deepEqual(sexpArgToValue(parseSexpr('(f "x" 3 t nil foo (1 2))')).slice(1), ['x', 3, true, null, 'foo', [1, 2]]);
});

test('a script answer becomes a diary result', () => {
  assert.equal(userSexpResult(true), true);
  assert.equal(userSexpResult('Full moon'), 'Full moon');
  assert.equal(userSexpResult(''), true);
  assert.equal(userSexpResult(7), '7');
  for (const none of [false, null, undefined, NaN, {}, []]) assert.equal(userSexpResult(none), false);
});

test('the evaluator calls a registered function with plain arguments and the day', () => {
  const calls = [];
  setUserSexps(['my-day'], (name, args, date) => {
    calls.push([name, args, date.getDate()]);
    return date.getDay() === 6 ? 'Saturday' : false;
  });
  const sat = new Date(2026, 9, 10);
  const sun = new Date(2026, 9, 11);
  assert.equal(evaluateSexpr(parseSexpr('(my-day "x" 3)'), { candidateDate: sat, today: sat }), 'Saturday');
  assert.equal(evaluateSexpr(parseSexpr('(my-day "x" 3)'), { candidateDate: sun, today: sat }), false);
  assert.deepEqual(calls[0], ['my-day', ['x', 3], 10]);
  assert.equal(evaluateSexpr(parseSexpr('(and (my-day) t)'), { candidateDate: sat, today: sat }), true);
});

test('registered functions work as agenda lines, and nothing changes without them', () => {
  assert.equal(parseGeneralBodyLine('%%(my-day) Text'), null);
  setUserSexps(['my-day'], () => true);
  const line = parseGeneralBodyLine('%%(my-day 1) Text');
  assert.ok(line);
  assert.equal(line.text, 'Text');
  setUserSexps();
  assert.equal(parseGeneralBodyLine('%%(my-day) Text'), null);
  assert.equal(evaluateSexpr(parseSexpr('(my-day)'), { candidateDate: new Date(), today: new Date() }), false);
});

test('a script cannot take over a standard form', () => {
  setUserSexps(['org-block'], () => 'hijacked'); // even if one were installed, the evaluator's own case comes first
  const day = new Date(2026, 0, 1);
  assert.equal(evaluateSexpr(parseSexpr('(org-block 2026 1 1 2026 1 1)'), { candidateDate: day, today: day }), true);
});

test('keys, variables, approval hash and the switch', async () => {
  assert.equal(userSexpKey('f', [1], '2026-10-10'), '["f",[1],"2026-10-10"]');
  assert.deepEqual(visibleVariableMap({ a: '1', 'github-token': 'x', 'my-Key': 'y', b: 2 }, { c: '3' }), { a: '1', c: '3' });
  const h = await hashScript('org.sexp("a", () => true)');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashScript('org.sexp("a", () => true)'));
  assert.notEqual(h, await hashScript('org.sexp("a", () => false)'));
  assert.equal(extensionsOn({}), false);
  assert.equal(extensionsOn({ 'org-xx-extensions': 'on' }), true);
  assert.equal(extensionsOn({ 'org-xx-extensions': 'off' }), false);
});
