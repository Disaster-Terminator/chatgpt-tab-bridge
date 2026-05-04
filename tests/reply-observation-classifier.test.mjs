import test from 'node:test';
import assert from 'node:assert/strict';
import { importExtensionModule } from './extension-test-harness.mjs';
const { classifyReplyObservation } = await importExtensionModule('core/reply-observation-classifier');

test('settled on new hash',()=>{ const d=classifyReplyObservation({elapsedMs:10,idleMs:10,baselineHash:'a',currentHash:'b',generating:false,replyPending:false,pageVisibility:'visible',generationObservedAfterDispatch:true,hopTimeoutMs:1000}); assert.equal(d.kind,'settled'); });
