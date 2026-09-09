import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeSubagent } from "../../pi-extension/subagents/native-session.ts";
import { findLastAssistantMessage, getNewEntries } from "../../pi-extension/subagents/session.ts";

const runRealModel = process.env.PI_E2E_REAL_MODEL === "1";

describe("native subagent real-model smoke", () => {
  it.skipIf(!runRealModel)("completes one prompt through the configured provider", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-interactive-subagents-real-"));
    const child = await createNativeSubagent({
      cwd,
      agentDir: process.env.PI_CODING_AGENT_DIR ?? join(cwd, ".pi", "agent"),
      tools: [],
    });

    try {
      await child.session.prompt("Reply with exactly: real-model-ok");
      const summary = findLastAssistantMessage(getNewEntries(child.sessionFile, 0));
      assert.match(summary ?? "", /real-model-ok/i);
    } finally {
      child.dispose();
    }
  });
});
