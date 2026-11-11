import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorShift, buildOffsets, estimateHeight, indexAtOffset, sameRanges, spacerHeights, windowRanges } from '../src/window-math.js';
import { getWindowingThreshold } from '../src/local-variables.js';

const total = (offsets) => offsets[offsets.length - 1];

test('buildOffsets: prefix sums, the last one is the total height', () => {
  const o = buildOffsets([10, 20, 5]);
  assert.deepEqual([...o], [0, 10, 30, 35]);
  assert.equal(total(buildOffsets([])), 0);
});

test('indexAtOffset: variable heights, edges and clamping', () => {
  const o = buildOffsets([10, 20, 5, 100]); // tops 0, 10, 30, 35; total 135
  assert.equal(indexAtOffset(o, 0), 0);
  assert.equal(indexAtOffset(o, 9.9), 0);
  assert.equal(indexAtOffset(o, 10), 1);
  assert.equal(indexAtOffset(o, 29), 1);
  assert.equal(indexAtOffset(o, 30), 2);
  assert.equal(indexAtOffset(o, 35), 3);
  assert.equal(indexAtOffset(o, 134), 3);
  assert.equal(indexAtOffset(o, -50), 0);
  assert.equal(indexAtOffset(o, 9999), 3);
  assert.equal(indexAtOffset(buildOffsets([]), 5), 0);
});

test('indexAtOffset agrees with a linear scan on a long list of uneven rows', () => {
  const heights = Array.from({ length: 5000 }, (_, i) => 20 + ((i * 37) % 90));
  const o = buildOffsets(heights);
  for (const y of [0, 1, 777, 12345, 99999, total(o) - 1]) {
    let want = 0;
    while (want < heights.length - 1 && o[want + 1] <= y) want += 1;
    assert.equal(indexAtOffset(o, y), want, `y=${y}`);
  }
});

test('windowRanges: the viewport plus an overscan, clipped to the list', () => {
  const o = buildOffsets(Array(1000).fill(40)); // 40 px rows
  const r = windowRanges({ offsets: o, top: 20000, bottom: 20800, overscan: 1600 }); // 2 screens each side
  assert.equal(r.length, 1);
  const [s, e] = r[0];
  assert.equal(s, indexAtOffset(o, 18400));
  assert.equal(e, indexAtOffset(o, 22400) + 1);
  assert.ok(e - s < 120, `about 100 rows, not 1000: ${e - s}`);
  // at the top and bottom of the list
  assert.deepEqual(windowRanges({ offsets: o, top: 0, bottom: 800, overscan: 1600 })[0][0], 0);
  assert.equal(windowRanges({ offsets: o, top: 39500, bottom: 40300, overscan: 1600 })[0][1], 1000);
});

test('windowRanges: forced rows are always drawn, merged when they touch the window, kept apart when not', () => {
  const o = buildOffsets(Array(1000).fill(40));
  const near = windowRanges({ offsets: o, top: 0, bottom: 800, overscan: 400, forced: [25] });
  assert.equal(near.length, 1, 'a forced row inside the window adds nothing');
  const far = windowRanges({ offsets: o, top: 0, bottom: 800, overscan: 400, forced: [900, 500, 500, 7] });
  assert.equal(far.length, 3);
  assert.deepEqual(far.slice(1), [[500, 501], [900, 901]]);
  const touching = windowRanges({ offsets: o, top: 0, bottom: 800, overscan: 0, forced: [21, 22] });
  assert.ok(touching.length <= 2 && touching.some(([s, e]) => s <= 21 && e >= 23), 'neighbours merge into one range');
  // out of range and non-integer forced entries are ignored
  assert.equal(windowRanges({ offsets: o, top: 0, bottom: 100, overscan: 0, forced: [-1, 5000, 1.5, NaN] }).length, 1);
  assert.deepEqual(windowRanges({ offsets: buildOffsets([]), top: 0, bottom: 100, overscan: 100, forced: [0] }), []);
});

test('spacerHeights: spacers plus drawn rows add up to the whole list', () => {
  const heights = Array.from({ length: 300 }, (_, i) => 15 + (i % 7) * 11);
  const o = buildOffsets(heights);
  const ranges = [[10, 40], [120, 121], [250, 300]];
  const gaps = spacerHeights(o, ranges);
  assert.equal(gaps.length, ranges.length + 1);
  const drawn = ranges.reduce((sum, [s, e]) => sum + (o[e] - o[s]), 0);
  assert.ok(Math.abs(gaps.reduce((a, b) => a + b, 0) + drawn - total(o)) < 1e-9);
  assert.equal(gaps[0], o[10]);
  assert.equal(gaps[3], 0, 'nothing below a window that reaches the end');
  assert.deepEqual(spacerHeights(buildOffsets([]), []), [0]);
});

test('anchorShift: content above the anchor grows, so the scroll position moves by exactly that much', () => {
  const before = buildOffsets(Array(100).fill(40));
  const heights = Array(100).fill(40);
  heights[3] = 100; // a row above the anchor measured taller than estimated
  heights[80] = 500; // one below it, which must not matter
  const after = buildOffsets(heights);
  assert.equal(anchorShift(before, after, 50), 60);
  assert.equal(anchorShift(before, after, 2), 0);
  assert.equal(anchorShift(before, before, 50), 0);
});

test('estimateHeight: the running average, scaled by line count, with a fallback before anything is measured', () => {
  assert.equal(estimateHeight(0), 44);
  assert.equal(estimateHeight(50), 50);
  assert.equal(estimateHeight(50, 3), 150);
  assert.equal(estimateHeight(50, 0), 50);
  assert.equal(estimateHeight(0, 2, 30), 60);
});

test('sameRanges', () => {
  assert.ok(sameRanges([[0, 5], [9, 10]], [[0, 5], [9, 10]]));
  assert.ok(!sameRanges([[0, 5]], [[0, 6]]));
  assert.ok(!sameRanges([[0, 5]], []));
});

test('org-xx-windowing-threshold: default 400, 0 turns it off, junk is an error', () => {
  assert.equal(getWindowingThreshold({}), 400);
  assert.equal(getWindowingThreshold({ 'org-xx-windowing-threshold': '0' }), 0);
  assert.equal(getWindowingThreshold({ 'org-xx-windowing-threshold': '150' }), 150);
  assert.throws(() => getWindowingThreshold({ 'org-xx-windowing-threshold': 'many' }), /org-xx-windowing-threshold is "many"/);
  assert.equal(getWindowingThreshold({ 'org-xx-windowing-threshold': '-5' }), 0);
});
