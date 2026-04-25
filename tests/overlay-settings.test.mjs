import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { normalizeOverlaySettings, mergeOverlaySettings } = await importExtensionModule("core/overlay-settings");

test("normalizeOverlaySettings keeps ambient overlay disabled by default", () => {
  const settings = normalizeOverlaySettings({});

  assert.equal(settings.enabled, true);
  assert.equal(settings.ambientEnabled, false);
  assert.equal(settings.collapsed, false);
  assert.equal(settings.position, null);
});

test("mergeOverlaySettings can enable ambient overlay without changing page overlay", () => {
  const settings = mergeOverlaySettings(
    {
      enabled: true,
      ambientEnabled: false,
      collapsed: true,
      position: { x: 12, y: 24 }
    },
    {
      ambientEnabled: true
    }
  );

  assert.equal(settings.enabled, true);
  assert.equal(settings.ambientEnabled, true);
  assert.equal(settings.collapsed, true);
  assert.deepEqual(settings.position, { x: 12, y: 24 });
});
