import test from 'node:test';
import assert from 'node:assert/strict';
import { securityVerdict, securityReport, bridgeLookingNames, BRIDGE_NAMES } from '../src/security-diagnostics.js';

const clean = () => ({ typeofs: Object.fromEntries(BRIDGE_NAMES.map((n) => [n, 'undefined'])), parentAccess: 'blocked' });

test('PASS when nothing native is reachable in the sandbox page and its worker', () => {
  const v = securityVerdict({ page: clean(), worker: { typeofs: clean().typeofs } });
  assert.equal(v.verdict, 'PASS');
  assert.equal(v.line, 'PASS: no native bridge reachable from sandboxed code');
});

test('FAIL names each reachable bridge and where', () => {
  const page = clean();
  page.typeofs.CapacitorHttpAndroidInterface = 'object';
  const worker = clean();
  worker.typeofs.androidBridge = 'object';
  const v = securityVerdict({ page, worker });
  assert.equal(v.verdict, 'FAIL');
  assert.deepEqual(v.problems, ['CapacitorHttpAndroidInterface is object in the sandbox page', "androidBridge is object in the sandbox's worker"]);
});

test('an unexpected parent access or a bridge-looking global fails', () => {
  const page = { ...clean(), parentAccess: 'object', extra: ['_AndroidFoo'] };
  const v = securityVerdict({ page, worker: clean() });
  assert.equal(v.verdict, 'FAIL');
  assert.equal(v.problems.length, 2);
});

test('UNKNOWN when the sandbox page or its worker did not answer', () => {
  assert.equal(securityVerdict({ page: null, worker: clean() }).line, 'UNKNOWN: the sandbox page did not answer');
  assert.equal(securityVerdict({ page: clean(), worker: null }).line, "UNKNOWN: the sandbox's worker did not answer");
  assert.equal(securityVerdict({}).line, "UNKNOWN: the sandbox page and the sandbox's worker did not answer");
});

test('the main page having the bridge is expected and does not fail', () => {
  const r = securityReport({ version: 'v656', platform: 'android', userAgent: 'UA', main: { typeofs: { Capacitor: 'object', androidBridge: 'object' } }, page: clean(), worker: clean() });
  assert.match(r, /^PASS: /);
  assert.match(r, /main page \(Capacitor and androidBridge are expected here\):\n(.*\n)* {2}Capacitor: object/);
});

test('bridgeLookingNames keeps unknown names that look native', () => {
  assert.deepEqual(bridgeLookingNames(['document', 'Capacitor', 'AndroidFoo', 'nativeThing', 'Capacitor']), ['AndroidFoo', 'nativeThing']);
});
