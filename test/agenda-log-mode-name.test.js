// @ts-check
// The log mode as an Emacs agenda's mode line names it (` Log`, ` LogAll`, ` ClkCk`), from the variable until one is chosen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logModeName, readLogSettings } from '../src/agenda-log.js';

test('the log mode starts as org-agenda-start-with-log-mode says and a chosen one replaces it', () => {
  assert.equal(logModeName({}), 'off');
  assert.equal(logModeName({ 'org-agenda-start-with-log-mode': 't' }), 'on');
  assert.equal(logModeName({ 'org-agenda-start-with-log-mode': "'clockcheck" }), 'clockcheck');
  assert.equal(logModeName({ 'org-agenda-start-with-log-mode': "'only" }), 'only');
  assert.equal(logModeName({ 'org-agenda-start-with-log-mode': "'(closed clock)" }), 'all');
  assert.equal(logModeName({ 'org-agenda-start-with-log-mode': "'clockcheck" }, false), 'off'); // `l` turns it off, as in Emacs
  assert.equal(logModeName({}, ['closed', 'clock', 'state']), 'all');
  assert.equal(readLogSettings({ 'org-agenda-start-with-log-mode': "'clockcheck" }, false).mode, false);
});
