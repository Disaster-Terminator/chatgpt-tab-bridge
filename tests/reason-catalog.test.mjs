import test from 'node:test';
import assert from 'node:assert/strict';
import { importExtensionModule } from './extension-test-harness.mjs';

const { STOP_REASONS, ERROR_REASONS } = await importExtensionModule('core/constants');
const { describeStopReason, describeErrorReason } = await importExtensionModule('core/reason-catalog');

test('all stop reasons have entries or fallback', () => {
  for (const v of Object.values(STOP_REASONS)) assert.ok(describeStopReason(v));
});

test('all error reasons have entries or fallback', () => {
  for (const v of Object.values(ERROR_REASONS)) assert.ok(describeErrorReason(v));
});

test('unknown reason returns fallback', () => {
  assert.equal(describeStopReason('unknown_x').title, 'Unknown runtime issue');
});

test('normal stop is not error severity', () => {
  assert.notEqual(describeStopReason(STOP_REASONS.USER_STOP).severity, 'error');
});
