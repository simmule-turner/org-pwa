import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chineseYear, chineseDateString, chineseFromAbsolute, chineseToAbsolute } from '../src/calendar-chinese.js';
import { absoluteFromGregorian } from '../src/calendar-conv.js';
import { evaluateSexpr, parseSexpr } from '../src/sexp-eval.js';

// Emacs 29.3's cal-china.el (tools/gen-chinese-oracle.mjs): the months of every Chinese year 1850-2150 and the date string of 1759 days.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/chinese.json', import.meta.url), 'utf8'));

test('the months of each Chinese year, 1850-2150, are the ones Emacs computes', () => {
  const bad = Object.entries(oracle.years).filter(([y, text]) => `(${chineseYear(Number(y)).map(([m, d]) => `(${m} ${d})`).join(' ')})` !== text);
  assert.deepEqual(bad, []);
});

test('calendar-chinese-date-string matches Emacs on 1759 days', () => {
  const bad = Object.entries(oracle.days).filter(([key, text]) => {
    const [y, m, d] = key.split('-').map(Number);
    return chineseDateString([m, d, y]) !== text;
  });
  assert.deepEqual(bad, []);
});

test('a Chinese date converts to the same day and back', () => {
  for (const abs of [739617, 739700, 740000, 740346]) assert.equal(chineseToAbsolute(chineseFromAbsolute(abs)), abs);
});

test('diary-chinese-date shows the day as Emacs words it', () => {
  const node = parseSexpr('(diary-chinese-date)');
  assert.equal(evaluateSexpr(node, { candidateDate: new Date(2026, 1, 17), today: new Date() }), 'Chinese date: Cycle 78, year 43 (Bing-Wu), month 1 (Geng-Yin), day 1 (Ren-Xu)');
  assert.equal(absoluteFromGregorian([2, 17, 2026]), 739664);
});
