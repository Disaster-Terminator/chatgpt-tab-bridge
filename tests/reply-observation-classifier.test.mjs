import test from 'node:test';
import assert from 'node:assert/strict';
import { importExtensionModule } from './extension-test-harness.mjs';
const { classifyReplyObservation } = await importExtensionModule('core/reply-observation-classifier');

test('settled when hash changes',()=>{const d=classifyReplyObservation({elapsedMs:1,idleMs:1,baselineHash:'a',currentHash:'b',generating:false,replyPending:false,pageVisibility:'visible',generationObservedAfterDispatch:false,hopTimeoutMs:1000});assert.equal(d.kind,'settled');});
test('timeout stop',()=>{const d=classifyReplyObservation({elapsedMs:1000,idleMs:1000,baselineHash:'a',currentHash:'a',generating:false,replyPending:false,pageVisibility:'visible',generationObservedAfterDispatch:false,hopTimeoutMs:1000});assert.equal(d.kind,'stop');});
