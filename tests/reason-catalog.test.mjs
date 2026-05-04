import test from 'node:test';
import assert from 'node:assert/strict';
import { importExtensionModule } from './extension-test-harness.mjs';
const { STOP_REASONS, ERROR_REASONS } = await importExtensionModule('core/constants');
const { describeStopReason, describeErrorReason, describeRuntimeIssue } = await importExtensionModule('core/reason-catalog');

test('all STOP_REASONS covered',()=>{ for (const v of Object.values(STOP_REASONS)) assert.ok(describeStopReason(v)); });
test('all ERROR_REASONS covered',()=>{ for (const v of Object.values(ERROR_REASONS)) assert.ok(describeErrorReason(v)); });
test('unknown fallback',()=>{ const r=describeStopReason('x_unknown'); assert.equal(r.code,'x_unknown'); });
test('normal stop not marked error',()=>{ const r=describeRuntimeIssue({stopReason:STOP_REASONS.USER_STOP}); assert.equal(r.severity,'info'); });
