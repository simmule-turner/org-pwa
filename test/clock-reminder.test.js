import test from 'node:test';
import assert from 'node:assert/strict';
import { effortReached, idleLimitMinutes, idlePrompt, reminderText, soundFileName, soundKind } from '../src/clock-reminder.js';

test('the reminder fires when the clocked time reaches the effort, never for an effort of 0', () => {
  assert.equal(effortReached(60, 59), false);
  assert.equal(effortReached(60, 60), true);
  assert.equal(effortReached(60, 90), true);
  assert.equal(effortReached(0, 90), false);
});

test('the message is Org’s, with the effort as written', () => {
  assert.equal(reminderText('Write report', '1:30'), 'Task ‘Write report’ should be finished by now. (1:30)');
});

test('org-clock-idle-time is a number of minutes; nil, unset and anything else is off', () => {
  assert.equal(idleLimitMinutes('15'), 15);
  for (const v of ['nil', '', undefined, '0', '1.5', 'x']) assert.equal(idleLimitMinutes(v), null, String(v));
});

test('org-clock-sound: nil is silent, t beeps, a file name falls back to the beep', () => {
  assert.equal(soundKind(undefined), 'none');
  assert.equal(soundKind('nil'), 'none');
  assert.equal(soundKind('t'), 'beep');
  assert.equal(soundKind('"/sounds/ding.wav"'), 'file');
});

test('the idle question reads like Org’s', () => {
  assert.equal(idlePrompt(12.34), 'Clocked in & idle for 12.3 mins');
});

import { resolveIdleClock } from '../src/clock-reminder.js';

// The cases of org-clock-resolve / org-clock-resolve-clock (org-clock.el, Org 9.6): a clock started at 0, idle from minute 60, now minute 90.
const M = 60000;
const base = { idleStart: 60 * M, now: 90 * M, clockStart: 0 };
test('idle question: ignore, keep all, and the capital letters', () => {
  assert.deepEqual(resolveIdleClock({ ...base, key: 'i' }), { type: 'none' });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'k' }), { type: 'now', clockOut: false });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'K' }), { type: 'now', clockOut: true });
});
test('idle question: keep some of the idle time', () => {
  assert.deepEqual(resolveIdleClock({ ...base, key: 'k', keepMinutes: 10 }), { type: 'at', clockOutAt: 70 * M, clockInAt: 90 * M });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'K', keepMinutes: 10 }), { type: 'at', clockOutAt: 70 * M, clockInAt: null });
});
test('idle question: subtract, and a clock that had barely started', () => {
  assert.deepEqual(resolveIdleClock({ ...base, key: 's' }), { type: 'at', clockOutAt: 60 * M, clockInAt: 90 * M });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'S' }), { type: 'at', clockOutAt: 60 * M, clockInAt: null });
  assert.deepEqual(resolveIdleClock({ ...base, key: 's', clockStart: 60 * M - 30000 }), { type: 'cancel', clockInNow: true });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'S', clockStart: 60 * M - 30000 }), { type: 'cancel', clockInNow: false });
});
test('idle question: got back N minutes ago, cancel and jump', () => {
  assert.deepEqual(resolveIdleClock({ ...base, key: 'g', gotBackMinutes: 5 }), { type: 'at', clockOutAt: 60 * M, clockInAt: 85 * M });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'G', gotBackMinutes: 5 }), { type: 'at', clockOutAt: 60 * M, clockInAt: null });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'g', gotBackMinutes: 0 }), { type: 'at', clockOutAt: 60 * M, clockInAt: 60 * M });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'C' }), { type: 'cancel', clockInNow: false });
  assert.deepEqual(resolveIdleClock({ ...base, key: 'J' }), { type: 'jump', clockOutNow: true });
});

test('org-clock-sound names a file in the org-pwa folder: quotes and the folder part are dropped', () => {
  assert.equal(soundFileName('"ding.wav"'), 'ding.wav');
  assert.equal(soundFileName('"~/sounds/ding.mp3"'), 'ding.mp3');
  assert.equal(soundFileName('/usr/share/sounds/bell.ogg'), 'bell.ogg');
  assert.equal(soundFileName('t'), null);
  assert.equal(soundFileName('nil'), null);
  assert.equal(soundFileName(undefined), null);
  assert.equal(soundFileName('"dir/"'), null);
});
