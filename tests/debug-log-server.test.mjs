import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendRotatingJsonLine } from "../scripts/debug-log-server.mjs";

test("appendRotatingJsonLine rotates oversized debug logs and caps backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-debug-log-"));
  const logPath = join(dir, "events.jsonl");

  try {
    await writeFile(logPath, "current-current\n", "utf8");
    await writeFile(`${logPath}.1`, "older-one\n", "utf8");
    await writeFile(`${logPath}.2`, "older-two\n", "utf8");

    await appendRotatingJsonLine(
      logPath,
      { receivedAt: "2026-04-26T00:00:00.000Z", event: { phaseStep: "probe" } },
      {
        maxBytes: 20,
        maxBackups: 2
      }
    );

    const current = await readFile(logPath, "utf8");
    const rotatedOne = await readFile(`${logPath}.1`, "utf8");
    const rotatedTwo = await readFile(`${logPath}.2`, "utf8");

    assert.match(current, /"phaseStep":"probe"/);
    assert.equal(rotatedOne, "current-current\n");
    assert.equal(rotatedTwo, "older-one\n");
    await assert.rejects(stat(`${logPath}.3`));
  } finally {
    await rm(dir, {
      recursive: true,
      force: true
    });
  }
});
