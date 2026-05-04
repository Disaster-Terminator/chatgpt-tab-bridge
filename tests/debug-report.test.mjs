import test from 'node:test';
import assert from 'node:assert/strict';
import { importExtensionModule } from './extension-test-harness.mjs';
const { createInitialState } = await importExtensionModule('core/state-machine');
const { DEFAULT_OVERLAY_SETTINGS } = await importExtensionModule('core/constants');
const { buildDebugReport } = await importExtensionModule('core/debug-report');

test('build debug report',()=>{const st=createInitialState();st.lastStopReason='hop_timeout';const r=buildDebugReport({state:st,overlaySettings:DEFAULT_OVERLAY_SETTINGS,recentRuntimeEvents:[],generatedAt:new Date().toISOString()});assert.equal(r.schemaVersion,1);assert.ok(r.issueAdvice);});
