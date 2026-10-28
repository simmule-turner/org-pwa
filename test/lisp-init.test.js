import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInit } from '../src/lisp-init.js';
import { settingsFromInit, boxText } from '../src-browser/lisp-settings.js';
import { QUICK_SETTINGS_FIELDS } from '../src-browser/settings-fields.js';

const field = (key) => QUICK_SETTINGS_FIELDS.find((f) => f.key === key);

test('the init is Lisp: functions, let, loops and computed values', () => {
  const vars = runInit(`(defun double (n) (* 2 n))
(setq a (double 21))
(setq b (let ((acc nil)) (dolist (x '(1 2 3)) (push (double x) acc)) (nreverse acc)))
(setq c (mapconcat #'identity '("x" "y") "-"))`);
  assert.equal(vars.get('a').v, 42);
  assert.deepEqual(vars.get('b').items.map((x) => x.v), [2, 4, 6]);
  assert.equal(vars.get('c').v, 'x-y');
  assert.deepEqual(vars.errors, []);
});

test('add-to-list and push on a variable never set signal void-variable as Emacs does; the variables the app knows, and add-hook, start empty', () => {
  const vars = runInit(`(add-to-list 'my-list 'a)\n(push "z" my-other)\n(add-to-list 'org-modules 'org-habit)\n(push '("x") org-capture-templates)\n(add-hook 'diary-list-entries-hook 'diary-sort-entries)`);
  assert.deepEqual(vars.errors, ['Symbol’s value as variable is void: my-list', 'Symbol’s value as variable is void: my-other']);
  assert.equal(vars.get('my-list'), undefined);
  assert.deepEqual(vars.get('org-modules').items.map((x) => x.v), ['org-habit']);
  assert.equal(vars.get('org-capture-templates').items.length, 1);
  assert.deepEqual(vars.get('diary-list-entries-hook').items.map((x) => x.v), ['diary-sort-entries']);
  const set = runInit(`(setq my-list nil)\n(add-to-list 'my-list 'a)\n(add-to-list 'my-list 'b t)`);
  assert.deepEqual(set.get('my-list').items.map((x) => x.v), ['a', 'b']);
});

test('a failing form is reported and the forms after it still run', () => {
  const vars = runInit(`(setq a 1)\n(car 5)\n(setq b 2)\n(require 'org)\n(with-eval-after-load 'org (setq c 3))`);
  assert.equal(vars.get('b').v, 2);
  assert.equal(vars.get('c').v, 3);
  assert.deepEqual(vars.errors, ['Wrong type argument: listp, 5']);
});

test('a program that never ends stops with a message', () => {
  const vars = runInit(`(setq a 1)\n(while t (setq a (1+ a)))\n(setq b 2)`);
  assert.equal(vars.has('b'), false);
  assert.match(vars.errors[0], /too many steps/);
});

test('one run leaves nothing behind for the next', () => {
  runInit(`(setq leftover 1)\n(defvar other 2)`);
  assert.equal(runInit(`(setq x 1)`).has('leftover'), false);
  assert.equal(runInit(`(setq y leftover)`).errors.length, 1);
});

test('initial values are what the program starts from', () => {
  const vars = runInit(`(setq org-modules (cons 'org-habit org-modules))`, new Map([['org-modules', { k: 'list', items: [{ k: 'sym', v: 'org-id' }] }]]));
  assert.deepEqual(vars.get('org-modules').items.map((x) => x.v), ['org-habit', 'org-id']);
});

test('org-agenda-files set from Lisp becomes the semicolon list the box holds', () => {
  const { values, errors } = settingsFromInit(`(setq org-agenda-files '("github:home.org"
                         "github:journal.org"
                         "github:calendar.org"))`, {});
  assert.deepEqual(errors, []);
  assert.equal(values['org-agenda-files'], 'github:home.org;github:journal.org;github:calendar.org');
});

test('settings of every kind take their value from Lisp', () => {
  const { values } = settingsFromInit(`(setq org-deadline-warning-days (* 2 7)
      org-agenda-include-diary t
      org-log-done 'time
      calendar-date-style 'european
      org-priority-lowest ?E
      display-time-mode nil
      org-agenda-start-on-weekday 0
      org-modules '(org-habit)
      org-use-sub-superscripts '{}
      org-xx-extra-menu '("cmd:x;Label" "cmd:y;Other"))`, {});
  assert.deepEqual(values, {
    'org-deadline-warning-days': '14',
    'org-agenda-include-diary': 't',
    'org-log-done': "'time",
    'calendar-date-style': 'european',
    'org-priority-lowest': 'E',
    'display-time-mode': '0',
    'org-agenda-start-on-weekday': '0',
    'org-modules': '(org-habit)',
    'org-use-sub-superscripts': '{}',
    'org-xx-extra-menu': '"cmd:x;Label" "cmd:y;Other"',
  });
});

test('a setting whose value is not changed is not taken over, and the switch for scripts cannot be set', () => {
  const { values } = settingsFromInit(`(setq org-deadline-warning-days 14 org-xx-extensions "on" org-xx-lisp-init "x")`, { 'org-deadline-warning-days': '14' });
  assert.deepEqual(values, {});
});

test('a value that does not fit its setting is reported', () => {
  const { values, errors } = settingsFromInit(`(setq org-deadline-warning-days "soon")`, {});
  assert.deepEqual(values, {});
  assert.match(errors[0], /org-deadline-warning-days/);
});

test('boxText for a list setting that is not made of strings', () => {
  assert.equal(boxText(field('org-agenda-files'), { k: 'list', items: [{ k: 'num', v: 1 }] }), null);
});
