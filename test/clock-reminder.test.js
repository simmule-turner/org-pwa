import test from 'node:test';
import assert from 'node:assert/strict';
import { effortReached, idleLimitMinutes, idlePrompt, reminderText, soundKind } from '../src/clock-reminder.js';

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
