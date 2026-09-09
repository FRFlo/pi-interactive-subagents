import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createNativeSubagent } from "../../pi-extension/subagents/native-session.ts";

describe("native subagent sessions", () => {
  it("creates a persistent in-process session with an enforced tool allowlist", async () => {
    const child = await createNativeSubagent({
      cwd: mkdtempSync(`${tmpdir()}-pi-native-`),
      agentDir: process.env.PI_CODING_AGENT_DIR ?? `${tmpdir()}-pi-agent`,
      tools: ["read"],
      extensionFactories: [],
    });

    try {
      assert.ok(child.sessionFile.endsWith(".jsonl"));
      assert.deepEqual(child.session.getActiveToolNames(), ["read"]);
    } finally {
      child.dispose();
    }
  });
});
